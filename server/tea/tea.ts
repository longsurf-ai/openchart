// Purpose: Keep compiled scripts and manage each observation's lifetime.
// This file loads sources, compiles scripts and coordinates cleanup. A run is
// built from five parts: node-graph.ts (Graph) connects the scripts and binds
// each one (bind.ts), which reads Sources (source.ts) through its Wiring
// (wiring.ts); run.ts (Run) then opens the Sources and pushes their rows.
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { compileToProgram, Errors, generate, loadModule } from "tea/compiler";
import { TeaCompileError } from "tea";
import type { Module } from "tea/runtime";
import * as Tea from "@openchart/tea";
import type { DataFrame } from "@openchart/timeseries";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { Feed } from "@openchart/server/feed/service";
import { WorkspaceId } from "@openchart/server/resources/workspace/entity";
import { invalidRequest, teaError } from "./errors";
import {
  buildGraph,
  type Compiled,
  type GraphRequest,
  type NodeGraph,
} from "./node-graph";
import { run } from "./run";

export * from "@openchart/tea";

/* -------------------------------------------------------------------------- */
/* The service                                                                */
/* -------------------------------------------------------------------------- */

/** What the Tea service can do. */
export interface ITeaService {
  /**
   * Compile a script and keep it until dispose. Compiling doesn't run
   * anything and doesn't open any market data.
   * @example const node = yield* tea.compile({ workspaceId, path, includeSources: true });
   */
  readonly compile: (
    request: Tea.CompileRequest,
  ) => Effect.Effect<Tea.CompileResponse, Tea.Error>;

  /**
   * Check that a request would bind, without opening any market data. It
   * checks that:
   * - every id has been compiled;
   * - every parameter is valid;
   * - every column a node reads is in its map;
   * - every NodeRef points to a node, with no loops;
   * - every request child the request leaves out names one listing by its
   *   ticker id, which it looks up in Feed's symbology, and whose provider
   *   serves its bars;
   * - every binding holds on the finer bars an auto script runs on, which
   *   it picks from Feed's capabilities.
   *
   * Callers use it, for example, before saving an alert rule.
   * @example yield* tea.validate({ id: node.id, ...config, nodes: {} });
   */
  readonly validate: (request: GraphRequest) => Effect.Effect<void, Tea.Error>;

  /**
   * Start a run. It returns:
   * - the run id;
   * - the config the run reads, with omitted request children filled in;
   * - the output for the requested window, never that of the `warmupBars`
   *   bars each input runs before it;
   * - a stream of live updates, when `to` is "now".
   *
   * A script declared with `indicator(..., timeframe = "auto")` runs on
   * finer bars of the listing its Bars name (see `buildGraph`). When Feed
   * can't serve them before the snapshot, the run starts once more on the
   * bars the request names; the config says which bars it read.
   *
   * The caller's Scope owns the run. Closing the Scope stops the run and
   * releases its market data.
   * @example const { snapshot, updates } = yield* tea.observe(request);
   */
  readonly observe: (request: Tea.ObserveRequest) => Effect.Effect<
    {
      /** Nothing reads it yet. Looking up a run by rid comes with NodeOutput. */
      readonly rid: string;
      /**
       * The root's config as the run reads it: the request's, with each
       * request child it left out filled in from the child's ticker id,
       * and Bars an auto script reads on the finer bars it runs on.
       */
      readonly config: Tea.NodeConfig;
      readonly snapshot: Tea.Snapshot;
      readonly updates?: Stream.Stream<DataFrame, Tea.Error>;
    },
    Tea.Error,
    Scope.Scope
  >;

  /**
   * Release a compiled script and stop every run started from it. Disposing
   * an unknown id still succeeds.
   * @example yield* tea.dispose({ id: node.id });
   */
  readonly dispose: (
    request: Tea.DisposeRequest,
  ) => Effect.Effect<void, Tea.Error>;
}

/** The Effect service tag for {@link ITeaService}. */
export class Service extends Context.Service<Service, ITeaService>()(
  "@openchart/server/tea/Service",
) {}

function metadata(module: Module): Tea.Definition {
  return {
    parameters: structuredClone(module.parameters),
    inputs: module.inputs.schema,
    outputs: module.outputs.schema,
    requests: Object.fromEntries(
      module.requests.map(({ name, module, context }) => [
        name,
        {
          ...metadata(module),
          target: context
            ? { symbol: context.symbol, timeframe: context.timeframe }
            : null,
        },
      ]),
    ),
  };
}

const compileFailed = (message: string) => (cause: unknown) =>
  new Tea.Error({ code: "compile_failed", message }, { cause });

/** Create the application's Tea service and its in-memory script registry.
 * A compiled script is a reusable definition: its bound Module, its Definition
 * and a Scope. An observation builds its own node graph from such scripts
 * over a historical window, optionally continuing with live updates.
 * Each script and run has a Scope, an Effect cleanup group owned by its parent.
 * Closing the service releases every script and run.
 * @example const app = layer.pipe(Layer.provide(dependencies));
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workspaces = yield* Workspaces;
    const feed = yield* Feed;
    const owner = yield* Effect.scope;
    // Serialize registry changes so starting a run cannot race with deleting its ID.
    // Data fetching and execution happen outside this lock.
    const gate = yield* Semaphore.make(1);
    const retained = new Map<
      string,
      Compiled & { readonly scope: Scope.Closeable }
    >();
    yield* Effect.addFinalizer(() => Effect.sync(() => retained.clear()));

    // The retained scripts a request names: its root and every `nodes` entry.
    // Run it under the gate.
    const scripts = (request: GraphRequest) =>
      Effect.try({
        try: () => {
          const find = (id: string) => {
            const script = retained.get(id);
            if (script) return script;
            throw new Tea.Error({
              code: "node_unavailable",
              message: "Tea node is unavailable",
            });
          };
          return {
            root: find(request.id),
            nodes: Object.fromEntries(
              Object.entries(request.nodes).map(([key, node]) => [
                key,
                find(node.id),
              ]),
            ),
          };
        },
        catch: invalidRequest,
      });

    const compile = Effect.fn("Tea.compile")(function* (
      request: Tea.CompileRequest,
    ) {
      const fromWorkspace = "workspaceId" in request;
      const root = fromWorkspace
        ? (yield* Schema.decodeUnknownEffect(WorkspaceId)(
            request.workspaceId,
          ).pipe(
            Effect.flatMap((id) => workspaces.open(id)),
            Effect.mapError(compileFailed("Tea workspace is unavailable")),
          )).root
        : undefined;
      const compiled = yield* Effect.try({
        try: () => {
          const errors = new Errors();
          const result = compileToProgram(
            [
              fromWorkspace
                ? join(root!, request.path)
                : {
                    filename: request.entry,
                    source: request.sources[request.entry]!,
                    imports: request.sources,
                  },
            ],
            errors,
            { includeSources: true },
          );
          if (!result) throw new TeaCompileError(errors.flushErrors());
          // Fill declared parameter defaults. Streams bind per observation.
          return {
            ...result,
            module: loadModule(generate(result.program)).bind(),
          };
        },
        catch: teaError("compile_failed", "Tea compilation failed"),
      });
      const includedSources =
        fromWorkspace && request.includeSources
          ? yield* Schema.decodeUnknownEffect(
              Tea.SnapshotSources.fields.sources,
            )(
              Object.fromEntries(
                Object.entries(compiled.sources).map(([path, text]) => [
                  relative(root!, path),
                  text,
                ]),
              ),
            ).pipe(
              Effect.mapError(
                compileFailed(
                  "Tea script and its imports exceed the snapshot limits: at most 32 files of 65,536 characters",
                ),
              ),
            )
          : undefined;
      const id = randomUUID();
      const definition = metadata(compiled.module);
      const response = yield* Effect.try({
        // Return a detached copy so callers cannot modify the retained
        // definition by changing its parameter records or Arrow schemas.
        try: () =>
          Schema.decodeUnknownSync(Tea.CompileResponse)(
            Schema.encodeSync(Tea.CompileResponse)({
              id,
              definition,
              declaration: compiled.program.declaration,
              ...(includedSources === undefined
                ? {}
                : { sources: includedSources }),
            }),
          ),
        catch: compileFailed("Tea metadata could not be encoded"),
      });

      // Publish the ID with its Scope. Finish both steps even if the
      // requesting caller is cancelled partway through registration.
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const scope = yield* Scope.fork(owner);
          yield* gate.withPermits(1)(
            Effect.sync(() =>
              retained.set(id, {
                module: compiled.module,
                definition,
                declaration: response.declaration,
                scope,
              }),
            ),
          );
        }),
      );
      return response;
    });

    // Build the request's graph over input streams that never receive a row,
    // then release it; validation never opens market data.
    const validate = Effect.fn("Tea.validate")(function* (
      request: GraphRequest,
    ) {
      const compiled = yield* gate.withPermits(1)(scripts(request));
      // Feed only when a request child needs its listing looked up.
      yield* Effect.scoped(
        buildGraph(
          request,
          compiled,
          Effect.suspend(() => feed.get()),
        ),
      );
    });

    // Start one independent calculation and return its initial output plus any
    // live updates. This operation owns everything needed to stop that run.
    const observe = Effect.fn("Tea.observe")(function* (
      request: Tea.ObserveRequest,
    ) {
      const caller = yield* Effect.scope;

      // Look up the scripts and register the run while holding the same lock
      // as dispose(). Disposal either wins first, or can find and stop this run.
      const admitted = yield* Effect.uninterruptible(
        gate.withPermits(1)(
          Effect.gen(function* () {
            const compiled = yield* scripts(request);
            // Tie cleanup to the root script and the caller. Either disposing
            // the root ID or cancelling the caller stops this run. The run owns
            // the nodes it builds from `nodes`, so their IDs are only checked.
            const scope = yield* Scope.fork(compiled.root.scope);
            yield* Scope.addFinalizerExit(caller, (exit) =>
              Scope.close(scope, exit),
            );
            return { compiled, observation: scope };
          }),
        ),
      );

      // Bind private copies and start the calculation in this run's resource
      // scope. Other observations keep their own parameters, data and state.
      const prepare = Effect.gen(function* () {
        // One set of Feed services for the whole run.
        const services = yield* Effect.cached(feed.get());
        const start = (graph: NodeGraph) =>
          Effect.map(run(graph, request, services), (started) => ({
            config: graph.config,
            ...started,
          }));
        // The first attempt gets a scope of its own: when Feed can't serve
        // the finer bars an auto script runs on before the snapshot, it is
        // released and the run starts once more on the chart's bars.
        const attempt = yield* Scope.fork(admitted.observation);
        const graph = yield* buildGraph(
          request,
          admitted.compiled,
          services,
        ).pipe(Scope.provide(attempt));
        const started = yield* start(graph).pipe(
          Scope.provide(attempt),
          Effect.catchIf(
            (error) =>
              error.code === "upstream" &&
              graph.sources.top.some(({ chart }) => chart !== undefined),
            () =>
              Scope.close(attempt, Exit.void).pipe(
                Effect.andThen(
                  buildGraph(request, admitted.compiled, services, false),
                ),
                Effect.flatMap(start),
              ),
          ),
        );
        return { rid: randomUUID(), ...started };
      }).pipe(Scope.provide(admitted.observation));

      // Run preparation as a cancellable task owned by this run's scope. This
      // lets dispose() interrupt a pending data fetch, not just clean up afterward.
      // On failure, release resources acquired before the failing step.
      const result = yield* prepare.pipe(
        Effect.forkIn(admitted.observation),
        Effect.flatMap(Fiber.join),
        Effect.onError((cause) =>
          Scope.close(admitted.observation, Exit.failCause(cause)),
        ),
      );

      // A finite result no longer needs its input sessions or execution state;
      // a live run stays open until its updates end, fail or are cancelled.
      const close = Scope.close(admitted.observation, Exit.void);
      if (!result.updates) {
        yield* close;
        return result;
      }
      return {
        ...result,
        updates: result.updates.pipe(Stream.ensuring(close)),
      };
    });

    // Remove the ID first so no new run can start, then stop its existing runs
    // and release the definition. Repeating disposal is harmless; cleanup itself
    // cannot be cancelled halfway through.
    const dispose = Effect.fn("Tea.dispose")(function* ({
      id,
    }: Tea.DisposeRequest) {
      const script = yield* gate.withPermits(1)(
        Effect.sync(() => {
          const script = retained.get(id);
          retained.delete(id);
          return script;
        }),
      );
      if (script) yield* Scope.close(script.scope, Exit.void);
    }, Effect.uninterruptible);
    return Service.of({ compile, validate, observe, dispose });
  }),
);
