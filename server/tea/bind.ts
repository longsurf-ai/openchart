// Purpose: Bind: turn one script and its request children into a started Tea Node.
import { Effect, Record, type Scope } from "effect";
import { createNode, type DataStream, type Node } from "tea";
import type { Module } from "tea/runtime";
import type { Resolution } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import type { FeedServices } from "@openchart/server/feed/service";
import { at, invalid } from "./errors";
import {
  isSeries,
  marketContext,
  requestedBars,
  suppliedBars,
  type SeriesInput,
  type Source,
} from "./source";
import { wire, type Wired } from "./wiring";

// Whether `record` names only declared parameters, and every one whose
// default doesn't depend on the chart: Tea resolves those for the bound chart.
const namesParameters = (
  record: object,
  declared: readonly { readonly name: string; readonly chartDefault?: true }[],
) =>
  Object.keys(record).every((name) =>
    declared.some((parameter) => parameter.name === name),
  ) &&
  declared.every(
    ({ name, chartDefault }) => chartDefault || Object.hasOwn(record, name),
  );

// Plug one level's wired streams into the Node at `path`. Named columns go
// first, so each driver after them binds no column and only drives the steps.
const plug = (
  node: Node,
  { columns, drivers }: Wired,
  path: readonly string[],
) =>
  drivers.reduce(
    (node, stream) => node.bind(stream, path),
    Record.isEmptyRecord(columns) ? node : node.bind(columns, path),
  );

/**
 * Turn one script's Module into a started Tea Node. `config` says how it runs;
 * `streams` holds the stream each of its inputs reads: a Source's, or another
 * node's output.
 *
 * Tea sets the order. A level's market context (`syminfo.*`, `timeframe.*`)
 * can only be given to `Module.bind`, before `createNode`; what a request
 * child reads is known only once its parent is bound; and `createNode`
 * creates every child at once. So Bind works in two steps:
 *
 * 1. Top down, for each level of the script's Module tree: check that its
 *    parameters are complete but for those whose default depends on the
 *    chart, which Tea resolves, that `requests` names only its
 *    request.security lines, and that it has an input; `Module.bind` it with
 *    its parameters and the market context of its series and `env.chart`
 *    (see {@link marketContext}); wire the columns
 *    the bound level reads (see {@link wire}); then do the same for each
 *    request child, with the config given for it or else the Bars its line
 *    names (see {@link requestedBars}), or in a run on supplied history the
 *    Samples (see {@link suppliedBars}), over the Sources `env.source` gives.
 * 2. Create the Node over the bound tree, plug each level's streams in at
 *    its path, and start it once while the streams are still empty. Tea's
 *    own checks (a missing binding, a request child's clock) fail now, and
 *    the Node already listens when Run pushes the first row.
 *
 * It returns the started Node and the config it reads: the given one, with
 * every parameter's value, chart defaults included, and every request child
 * filled in. Errors are invalid_request naming `where`,
 * a child as `<where>.requests.<name>`, and the input; a child filled in from
 * its line names its script variable instead. A failed listing lookup is
 * upstream. The caller's Scope owns the Node.
 * @example const { node, config } = yield* bind(script.module, config, { bars: source.stream }, { supplier, chart: "1d", feed, source }, "root");
 */
export const bind = Effect.fn("Tea.bind")(function* (
  module: Module,
  config: Tea.NodeConfig,
  streams: Readonly<Record<string, DataStream>>,
  env: {
    readonly supplier: Parameters<typeof createNode>[1];
    /** The chart's resolution, which every level reads as `chart.timeframe`. */
    readonly chart: Resolution | undefined;
    readonly feed: Effect.Effect<FeedServices>;
    /**
     * Supplied history, in a run that reads nothing from Feed: a left-out
     * request child reads these Samples instead (see {@link suppliedBars}).
     */
    readonly samples: readonly Tea.Samples[] | undefined;
    /** The Source a request child's series input reads, named by `where` in errors. */
    readonly source: (
      input: SeriesInput,
      where: string,
    ) => Effect.Effect<Source, never, Scope.Scope>;
  },
  where: string,
) {
  // Step 1. Each level binds the tree its parent left, so the tree lives
  // here, with each level's wiring.
  let tree = module;
  const levels: {
    readonly path: readonly string[];
    readonly where: string;
    readonly wired: Wired;
  }[] = [];

  // One level: bind and wire it, then its request children. It returns the
  // level's config with each child's filled in.
  const level = Effect.fn("Tea.bindLevel")(function* (
    module: Module,
    config: Tea.NodeConfig,
    streams: Readonly<Record<string, DataStream>>,
    path: readonly string[],
    where: string,
  ): Effect.fn.Return<Tea.NodeConfig, Tea.Error, Scope.Scope> {
    if (!namesParameters(config.parameters, module.parameters))
      return yield* invalid(`Complete parameters are required at ${where}`);
    const unknown = Object.keys(config.requests).find(
      (name) => !module.requests.some((request) => request.name === name),
    );
    if (unknown !== undefined)
      return yield* invalid(
        `requests.${unknown} at ${where} is not a request.security line of the script`,
      );
    if (Record.isEmptyRecord(config.inputs))
      return yield* invalid(`At least one input is required at ${where}`);

    tree = yield* at(where, () =>
      tree.bind(
        config.parameters,
        marketContext(
          module.inputs,
          Object.values(config.inputs).filter(isSeries),
          env.chart,
        ),
        path,
      ),
    );
    // Parameters such as input.source choose the columns the bound level
    // reads, so it is wired for those only.
    const bound = path.reduce(
      (level, name) =>
        level.requests.find((request) => request.name === name)!.module,
      tree,
    );
    // The values it runs with: the given ones and the chart defaults Tea
    // resolved for this chart. Request children inherit them.
    const parameters = Object.fromEntries(
      bound.parameters.flatMap(({ name, value }) =>
        value === undefined || value === null ? [] : [[name, value]],
      ),
    );
    levels.push({
      path,
      where,
      wired: yield* wire(config, streams, bound.inputs.schema, where),
    });

    const requests = yield* Effect.forEach(
      module.requests,
      Effect.fn(function* (request, index) {
        const { name } = request;
        const childWhere = `${where}.requests.${name}`;
        const target = bound.requests[index]!.context;
        const parent = { ...config, parameters };
        const child = Object.hasOwn(config.requests, name)
          ? config.requests[name]!
          : env.samples
            ? yield* suppliedBars(parent, target, env.samples, name)
            : yield* requestedBars(parent, target, env.feed, name);
        // A child reads only series; Graph rejected NodeRef inputs in
        // children.
        const own = yield* Effect.all(
          Record.map(Record.filter(child.inputs, isSeries), (input, key) =>
            env.source(input, `input '${key}' at ${childWhere}`),
          ),
        );
        const filled = yield* level(
          request.module,
          child,
          Record.map(own, ({ stream }) => stream),
          [...path, name],
          childWhere,
        );
        return [name, filled] as const;
      }),
    );
    // Only config fields: a root config may be a whole ObserveRequest.
    return {
      inputs: config.inputs,
      map: config.map,
      parameters,
      requests: Record.fromEntries(requests),
    };
  });
  const filled = yield* level(module, config, streams, [], where);

  // Step 2: one Node over the bound tree, each level plugged in at its path,
  // started while the streams are empty so Tea's own checks fail now.
  const node = yield* Effect.acquireRelease(
    Effect.reduce(
      levels,
      () => createNode(tree, env.supplier),
      (node, { path, where, wired }) =>
        at(where, () => plug(node, wired, path)),
    ),
    (node) => Effect.sync(() => node.dispose()),
  );
  yield* at(where, () => {
    const failures: unknown[] = [];
    node.to({ error: (cause) => failures.push(cause) }).unsubscribe();
    if (failures.length > 0) throw failures[0];
  });
  return { node, config: filled };
});
