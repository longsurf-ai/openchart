// Purpose: Run one Workspace Dataset collection: admit its Agent prompt, or start its approved script.

/**
 * Collection runs a Workspace Dataset's declared collection without awaiting it.
 * @packageDocumentation
 */
export * as Collection from "./collection";

import { AgentPromptTarget } from "@openchart/server/agent/contracts/agent-prompt-target";
import { admitPromptTarget } from "@openchart/server/agent/session/admit-prompt-target";
import { Database } from "@openchart/server/db/database";
import { Home } from "@openchart/server/home";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import { Monitoring } from "@openchart/server/monitoring";
import { workspaceDatasetResource } from "@openchart/server/resources/workspace-dataset";
import type {
  WorkspaceDatasetEntity,
  WorkspaceDatasetId,
} from "@openchart/server/resources/workspace-dataset/entity";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { Context, Effect, FiberMap, Layer, Schema, Scope } from "effect";
import path from "node:path";
import { config } from "./config";
import { installUv, runScript } from "./uv";

const invalid = (reason: string) =>
  new ResourceStateInvalid({
    resource: workspaceDatasetResource.name,
    reason,
    issues: [],
  });

/** Services a collection reads; captured when the layer is built. */
type Needs =
  | Effect.Services<ReturnType<typeof admitPromptTarget>>
  | Database.Service
  | Home
  | Workspaces
  | Monitoring.Service;

const make = Effect.gen(function* () {
  const services = yield* Effect.context<Needs>();
  const fibers = yield* FiberMap.make<WorkspaceDatasetId>();
  const scope = yield* Effect.scope;
  // One check per Dataset outlives its runs, so the last outcome stays visible.
  const checks = new Map<WorkspaceDatasetId, Monitoring.CheckHandle>();
  const checkFor = Effect.fnUntraced(function* (
    dataset: WorkspaceDatasetEntity,
  ) {
    const existing = checks.get(dataset.id);
    if (existing) return existing;
    const monitoring = yield* Monitoring.Service;
    const check = yield* monitoring
      .reporter(`collection/${dataset.id}`, dataset.name)
      .register("Collection")
      .pipe(Scope.provide(scope));
    checks.set(dataset.id, check);
    return check;
  });

  /**
   * Starts one collection and returns without awaiting it.
   * - An Agent prompt is admitted once per `intent`, with the Dataset attached
   *   and its file named; the Run reports the outcome.
   * - A script runs only when its current content matches the approved hash,
   *   at most one run per Dataset at a time; a second request while one runs
   *   starts nothing. Its Monitoring check `collection/<id>` reports
   *   each outcome, so scheduled failures reach the user.
   * Fails `ResourceNotFound` for a missing Dataset, and `ResourceStateInvalid`
   * when it has no collection or its script changed since approval.
   * @example yield* collection.collect(datasetId, `manual:${datasetId}:${Date.now()}`);
   */
  const run = Effect.fn("Collection.collect")(function* (
    id: WorkspaceDatasetId,
    intent: string,
  ) {
    const dataset = yield* Transactor.run(
      workspaceDatasetResource.transitions.get(id),
    );
    const collection = dataset.collection;
    if (!collection) return yield* invalid("it has no collection");
    if (collection.kind === "agent_prompt") {
      // The Resource types its prompt opaquely; its schema already validated it.
      const target = yield* Schema.decodeUnknownEffect(AgentPromptTarget)(
        collection,
      ).pipe(Effect.orDie);
      const run = yield* admitPromptTarget({
        intent,
        title: `Collect ${dataset.name}`,
        binding: target.binding,
        input: {
          ...target.prompt,
          parts: [
            ...target.prompt.parts,
            {
              type: "context" as const,
              context: {
                kind: "resource" as const,
                resource: workspaceDatasetResource.name,
                id: dataset.id,
                scope: "attached" as const,
              },
            },
            {
              type: "text" as const,
              text: `Update the Workspace Dataset "${dataset.name}": rewrite ${dataset.source.path} as CSV with a "${dataset.time.column}" column and ${dataset.columns.map((column) => `"${column.name}"`).join(", ")}, keeping existing rows unless the source revised them.`,
            },
          ],
        },
      });
      return {
        kind: "agent_prompt" as const,
        runId: run.id,
        sessionId: run.sessionID,
      };
    }
    const check = yield* checkFor(dataset);
    const fail = (code: string, message: string) =>
      check.report({ state: "failed", reason: { code, message } });
    const workspace = yield* (yield* Workspaces).open(
      dataset.source.workspaceId,
    );
    const script = yield* workspace
      .read(collection.path)
      .pipe(
        Effect.tapError(() =>
          fail(
            "collection.script_missing",
            `${collection.path} could not be read.`,
          ),
        ),
      );
    if (script.entry.hash !== dataset.approvedScriptHash) {
      yield* fail(
        "collection.not_approved",
        `${collection.path} changed since it was approved; collect ${dataset.name} in OpenChart to review it.`,
      );
      return yield* invalid(
        "its collection script changed since it was approved",
      );
    }
    const runtimes = path.join((yield* Home).root, "runtimes");
    const { scriptTimeoutSeconds } = yield* config;
    yield* FiberMap.run(
      fibers,
      dataset.id,
      installUv(runtimes).pipe(
        Effect.flatMap((uv) =>
          runScript({
            uv,
            runtimes,
            root: workspace.root,
            script: collection.path,
            args: collection.args ?? [],
            output: dataset.source.path,
            timeoutSeconds: scriptTimeoutSeconds,
          }),
        ),
        Effect.matchEffect({
          onFailure: (error) => fail("collection.script_failed", error.message),
          onSuccess: () => check.report({ state: "healthy" }),
        }),
      ),
      // A run already in progress keeps going; this request starts nothing.
      { onlyIfMissing: true },
    );
    return { kind: "script" as const };
  });

  return {
    collect: (id: WorkspaceDatasetId, intent: string) =>
      run(id, intent).pipe(Effect.provideContext(services)),
  };
});

/** Collection operations; see `collect`. */
export type Interface = Effect.Success<typeof make>;

/**
 * Collection capability, built above the application services it reads, so
 * `collect` has no requirements. Its scope owns running scripts and their
 * checks; closing it stops every script run.
 * @example const collection = yield* Collection.Service;
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Collection",
) {}

/** Constructing the layer starts no work. */
export const layer = Layer.effect(Service, make);
