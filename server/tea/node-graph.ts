// Purpose: Graph: connect the root to the nodes it reads, share one Source per series, and bind every script, without opening market data.
import type { Schema as ArrowSchema } from "apache-arrow";
import {
  Array as Arr,
  Clock,
  Effect,
  Equal,
  Graph,
  Option,
  Record,
  Schema,
} from "effect";
import { pineBuiltinSupplier, type Node } from "tea";
import type { Module } from "tea/runtime";
import { barsSeries, type Resolution } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import type { Range } from "@openchart/timeseries";
import type { FeedServices } from "@openchart/server/feed/service";
import { bind } from "./bind";
import { invalid } from "./errors";
import {
  isSeries,
  makeSource,
  runResolution,
  type SeriesInput,
  type Source,
} from "./source";

/** A compiled script as the service keeps it: the Module to bind, and the Definition and declaration compile returned. */
export interface Compiled {
  readonly module: Module;
  readonly definition: Tea.Definition;
  /** Its `indicator()` header; `timeframe: "auto"` runs it on finer bars (see {@link buildGraph}). */
  readonly declaration: Tea.Declaration | null;
}

/** The bound graph of one validate or observe call. The caller's Scope releases it. */
export interface NodeGraph {
  /** The root's Tea Node. Run collects its output with `to()`: the snapshot needs each row's `index`, which `asStream()` leaves out. */
  readonly root: Node;
  /** The root's config as the run reads it: every request child filled in, and the finer Bars of an auto script. */
  readonly config: Tea.NodeConfig;
  /** Every Source: each top-level series once, an auto script's on finer bars ({@link Source.chart}), and each series request children read once. */
  readonly sources: {
    readonly top: readonly Source[];
    readonly children: readonly Source[];
  };
  /** False until Run hands the run to live updates; Pine reads it as `barstate.isrealtime`. */
  live: boolean;
  /**
   * Whether the row Run is pushing is the newest its Source has: its last
   * history row, or any live row. Every Node that steps on that push reads it
   * as Pine's `barstate.islast`, so each request child marks its own newest bar.
   */
  newest: boolean;
}

/** An observe request without its window and warmup: what validate checks and a graph is built from. */
export type GraphRequest = Omit<Tea.ObserveRequest, keyof Range | "warmupBars">;
type GraphScripts = {
  readonly root: Compiled;
  readonly nodes: Readonly<Record<string, Compiled>>;
};

// Two inputs are one series when Feed would return the same rows for both.
const sameSeries = (a: SeriesInput, b: SeriesInput) =>
  Equal.equals(
    [a._tag, barsSeries(a, a), a._tag === "Samples" ? a.rows : null],
    [b._tag, barsSeries(b, b), b._tag === "Samples" ? b.rows : null],
  );

// Schemas are equal when their canonical JSON forms are.
const encodeSchema = Schema.encodeSync(Tea.ArrowSchemaJson);
const sameSchema = (a: ArrowSchema, b: ArrowSchema) =>
  Equal.equals(encodeSchema(a), encodeSchema(b));

// The `nodes` keys, every node after the nodes it reads. Each NodeRef must
// name an existing node, sit in a top-level input and carry that node's
// current outputs schema; the nodes must not read each other in a loop, and
// the root must reach every one of them.
const nodeOrder = Effect.fn("Tea.nodeOrder")(function* (
  request: GraphRequest,
  scripts: GraphScripts,
) {
  const label = (key: string | null) =>
    key === null ? "root" : `nodes.${key}`;
  // Each NodeRef input and the script that reads it; null is the root.
  const refs: {
    readonly reader: string | null;
    readonly name: string;
    readonly input: Tea.NodeRef;
  }[] = [];
  for (const [reader, config] of [
    [null, request] as const,
    ...Object.entries(request.nodes),
  ]) {
    for (const [name, input] of Object.entries(config.inputs)) {
      if (input._tag !== "NodeRef") continue;
      if (!Object.hasOwn(request.nodes, input.node))
        return yield* invalid(
          `input '${name}' at ${label(reader)} reads nodes.${input.node}, which does not exist`,
        );
      refs.push({ reader, name, input });
    }
    // Tea allows request.security only at a script's top level, so a request
    // child has no children of its own to check.
    for (const [request, child] of Object.entries(config.requests))
      for (const [name, input] of Object.entries(child.inputs))
        if (input._tag === "NodeRef")
          return yield* invalid(
            `input '${name}' at ${label(reader)}.requests.${request} is a NodeRef, but request children cannot read nodes`,
          );
  }

  // Edges point from a producer to its reader, so topological order lists
  // producers first and the root, which nothing reads, last.
  const keys = [null, ...Object.keys(request.nodes)];
  const dependencies = Graph.directed<string | null, void>((mutable) => {
    const index = new Map(
      keys.map((key) => [key, Graph.addNode(mutable, key)]),
    );
    for (const { reader, input } of refs)
      Graph.addEdge(
        mutable,
        index.get(input.node)!,
        index.get(reader)!,
        undefined,
      );
  });
  const cycle = Graph.findCycle(dependencies);
  if (Option.isSome(cycle))
    return yield* invalid(
      `${label(Graph.getNode(dependencies, cycle.value.path[0]!).pipe(Option.getOrThrow))} reads itself through a loop`,
    );
  // Walking edges backwards from the root reaches every node it reads.
  const reached = new Set(
    Graph.values(
      Graph.dfs(dependencies, { start: [0], direction: "incoming" }),
    ),
  );
  const unread = keys.find((key) => !reached.has(key));
  if (unread !== undefined)
    return yield* invalid(
      `${label(unread)} is not read by the root or by any node it reads`,
    );
  const stale = refs.find(
    ({ input }) =>
      !sameSchema(input.schema, scripts.nodes[input.node]!.definition.outputs),
  );
  if (stale)
    return yield* invalid(
      `input '${stale.name}' at ${label(stale.reader)} has an out-of-date schema for nodes.${stale.input.node}; use its current definition.outputs`,
    );
  return [...Graph.values(Graph.topo(dependencies))].filter(
    (key) => key !== null,
  );
});

/**
 * Turn one validate or observe request into started Tea Nodes over empty
 * Sources, before any data flows.
 *
 * Example: an alert that reads RSI, both on BTC 1m bars.
 *
 *   {
 *     id: "alert",                        // the root: the script this request runs
 *     inputs: {
 *       bars: { _tag: "Bars", provider: "binance", listing: BTC, resolution: "1m", ... },
 *       rsi: { _tag: "NodeRef", node: "rsi", schema },
 *     },
 *     map: { close: ["bars", ["close"]], "indicator.rsi": ["rsi", ["rsi"]] },
 *     nodes: {
 *       rsi: {                            // another script the root reads
 *         id: "rsi",
 *         inputs: { bars: { _tag: "Bars", provider: "binance", listing: BTC, resolution: "1m", ... } },
 *         map: { close: ["bars", ["close"]] },
 *       },
 *     },
 *   }
 *
 * Connections: the root reads rsi, so rsi comes first. Every NodeRef must
 * name a `nodes` entry and carry its current `definition.outputs`; the nodes
 * must not read each other in a loop; every entry must be read; and request
 * children read no node.
 *
 * Sources: the root and rsi each have a Bars input, and both name the same
 * series: the same provider, listing, resolution, session and adjustment
 * (Samples also need the same rows). They share one Source, which keeps
 * their bars in step and carries every column either declares. Request
 * children open over a window of their own (see {@link run}), so they never
 * share a top-level Source, but children that read the same series with the
 * same schema share one.
 *
 * Auto scripts: with `retime`, each top-level Bars series that a script
 * declared with `indicator(..., timeframe = "auto")` reads, root or node,
 * runs on finer bars of the same listing ({@link runResolution}), and every
 * input that names it reads those instead. If rsi were auto on BTC 1d, the
 * alert and rsi would both read one BTC 1h Source and step together. Every
 * level of a script, request children included, reads the chart's timeframe,
 * that of its first series before the swap, as `chart.timeframe`. Samples
 * run as given. observe builds once more without `retime` when Feed can't
 * serve the finer bars.
 *
 * Nodes: each script is bound in that order (see {@link bind}). rsi reads
 * the BTC Source; the root reads the same Source and rsi's output. All share
 * one Pine builtin supplier, whose realtime flag is {@link NodeGraph.live}
 * and whose newest-bar flag is {@link NodeGraph.newest}.
 *
 * validate calls only this; observe then hands the graph to Run, which
 * pushes the rows. Errors are invalid_request and say where they happened
 * (`root`, `nodes.rsi`, `root.requests.daily`) and which input; a failed
 * listing lookup, or a capabilities lookup for an auto script, is upstream.
 * Every Source and Node belongs to the caller's Scope, so a failed build
 * releases what it started and a built graph lasts until the Scope closes.
 * @example const graph = yield* buildGraph(request, scripts, feed.get());
 */
export const buildGraph = Effect.fn("Tea.buildGraph")(function* (
  request: GraphRequest,
  scripts: GraphScripts,
  feed: Effect.Effect<FeedServices>,
  retime = true,
) {
  const clock = yield* Clock.Clock;
  const order = yield* nodeOrder(request, scripts);
  const configs = [
    { where: "root", config: request, script: scripts.root },
    ...order.map((key) => ({
      where: `nodes.${key}`,
      config: request.nodes[key]!,
      script: scripts.nodes[key]!,
    })),
  ];

  // A run on supplied history reads nothing from Feed.
  if (request.samples)
    for (const { where, config } of configs)
      for (const [key, input] of Object.entries(config.inputs))
        if (input._tag === "Bars")
          return yield* invalid(
            `inputs.${key} at ${where} reads Feed, but this run reads only supplied history; give it Samples.`,
          );

  // An auto script runs on the timeframe its header's `timeframe` parameter
  // chooses, else ("") on the service's pick. Scripts reading one series run
  // on one Source, so they must choose alike.
  const autoReads: {
    readonly bars: Tea.Bars;
    readonly chosen: Resolution | undefined;
    readonly where: string;
  }[] = [];
  for (const { where, config, script } of configs) {
    if (script.declaration?.timeframe !== "auto") continue;
    const value = config.parameters.timeframe;
    const chosen =
      value === undefined || value === ""
        ? undefined
        : Tea.resolutionOf(String(value));
    if (value !== undefined && value !== "" && chosen === undefined)
      return yield* invalid(
        `timeframe '${String(value)}' at ${where} names no bars Feed has`,
      );
    for (const input of Object.values(config.inputs))
      if (input._tag === "Bars") autoReads.push({ bars: input, chosen, where });
  }
  for (const read of autoReads) {
    const other = autoReads.find(
      ({ bars, chosen }) =>
        sameSeries(bars, read.bars) && chosen !== read.chosen,
    );
    if (other)
      return yield* invalid(
        `${read.where} and ${other.where} read the same bars but choose different timeframes`,
      );
  }
  const runs = retime
    ? yield* Effect.forEach(
        Arr.dedupeWith(autoReads, (a, b) => sameSeries(a.bars, b.bars)),
        ({ bars, chosen }) =>
          Effect.map(runResolution(bars, feed, chosen), (resolution) => ({
            bars,
            resolution,
          })),
      )
    : [];
  // The series an input reads: its run series, else itself.
  const reads = (input: SeriesInput): SeriesInput => {
    const run = runs.find(({ bars }) => sameSeries(bars, input));
    return run ? { ...input, resolution: run.resolution } : input;
  };

  // One Source per series that the root and its nodes read, carrying every
  // column any of them declares.
  const declared = configs.flatMap(({ where, config }) =>
    Object.entries(config.inputs).flatMap(([name, input]) =>
      isSeries(input)
        ? [
            {
              input: reads(input),
              chart: input.resolution,
              where: `input '${name}' at ${where}`,
            },
          ]
        : [],
    ),
  );
  const top = yield* Effect.forEach(
    Arr.dedupeWith(declared, (a, b) => sameSeries(a.input, b.input)),
    ({ input, chart, where }) =>
      makeSource(
        input,
        Arr.dedupe(
          declared
            .filter((other) => sameSeries(other.input, input))
            .flatMap(({ input }) =>
              input.schema.fields.map(({ name }) => name),
            ),
        ),
        where,
        chart === input.resolution ? undefined : chart,
      ),
  );

  const graph = { live: false, newest: false };
  const supplier = pineBuiltinSupplier(
    () => clock.currentTimeMillisUnsafe(),
    () => graph.live,
    () => graph.newest,
  );
  // Request children, of any script, share one Source per series and schema.
  const children: Source[] = [];
  const childSource = Effect.fn("Tea.childSource")(function* (
    input: SeriesInput,
    where: string,
  ) {
    const shared = children.find(
      ({ declared }) =>
        sameSeries(declared, input) &&
        sameSchema(declared.schema, input.schema),
    );
    if (shared) return shared;
    const made = yield* makeSource(
      input,
      input.schema.fields.map(({ name }) => name),
      where,
    );
    children.push(made);
    return made;
  });
  // Each script reads the shared Source of each series it reads and the
  // output of each node it reads, which nodeOrder bound before it.
  const nodes = new Map<string, Node>();
  const bindScript = Effect.fn("Tea.bindScript")(function* (
    config: Tea.NodeConfig,
    script: Compiled,
    where: string,
  ) {
    const inputs = Record.map(config.inputs, (input) =>
      isSeries(input) ? reads(input) : input,
    );
    // An auto script binds with the timeframe it runs on, so the config the
    // run reports says which bars were read.
    const own = Object.values(inputs).find(
      (input): input is Tea.Bars => input._tag === "Bars",
    );
    const parameters =
      script.declaration?.timeframe === "auto" && own
        ? { ...config.parameters, timeframe: Tea.timeframeOf(own.resolution) }
        : config.parameters;
    return yield* bind(
      script.module,
      { ...config, inputs, parameters },
      Record.map(inputs, (input) =>
        isSeries(input)
          ? top.find((source) => sameSeries(source.declared, input))!.stream
          : nodes.get(input.node)!.asStream(),
      ),
      {
        supplier,
        chart: Object.values(config.inputs).find(isSeries)?.resolution,
        feed,
        samples: request.samples,
        source: childSource,
      },
      where,
    );
  });
  for (const key of order)
    nodes.set(
      key,
      (yield* bindScript(
        request.nodes[key]!,
        scripts.nodes[key]!,
        `nodes.${key}`,
      )).node,
    );
  const root = yield* bindScript(request, scripts.root, "root");
  return Object.assign(graph, {
    root: root.node,
    config: root.config,
    sources: {
      top,
      children,
    },
  }) satisfies NodeGraph;
});
