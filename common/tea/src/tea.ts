// Purpose: The Tea contracts the browser and the server share: compile, node configs and observations.
import {
  DataType,
  Field,
  Float64,
  Precision,
  Schema as ArrowSchema,
} from "apache-arrow";
import { Schema, Struct } from "effect";
import { barsSeries, BarsSeries } from "@openchart/feed";
import { BarColumns } from "@openchart/market";
import { dataFrameCodec, Range, TimeRange } from "@openchart/timeseries";
import {
  ArrowSchemaJson,
  Declaration,
  Definition,
  type ArrowSchemaJsonEncoded,
} from "./metadata";

// Reject unknown keys instead of silently dropping them.
const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/* -------------------------------------------------------------------------- */
/* Compile                                                                    */
/* -------------------------------------------------------------------------- */

/** A Workspace entry; the service resolves its ID to a filesystem directory. */
export const WorkspaceSources = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
  includeSources: Schema.optionalKey(Schema.Boolean),
}).annotate(strict);
export type WorkspaceSources = typeof WorkspaceSources.Type;

/** A complete source snapshot. Missing imports never fall back to the filesystem. */
export const SnapshotSources = Schema.Struct({
  entry: Schema.NonEmptyString, // "main.tea"
  sources: Schema.Record(
    // {"main.tea": "actual content", "lib.tea": "imported content"}
    Schema.NonEmptyString,
    Schema.String.check(Schema.isMaxLength(65536)),
  ).check(Schema.isPropertiesLengthBetween(1, 32)),
})
  .check(
    Schema.makeFilter(({ entry, sources }) => Object.hasOwn(sources, entry), {
      message: "The snapshot must contain its entry file",
    }),
  )
  .annotate(strict);
export type SnapshotSources = typeof SnapshotSources.Type;

/**
 * Compile a script. It is either a file in a Workspace, whose imports are
 * read from disk, or source text sent with the request, which must include
 * every file it imports.
 */
export const CompileRequest = Schema.Union([WorkspaceSources, SnapshotSources]);
export type CompileRequest = typeof CompileRequest.Type;

/**
 * What compile returns. The service keeps the compiled script until dispose
 * is called with `id`.
 *
 * - `id`: the compiled script that observe, validate and dispose refer to.
 * - `definition`: what the script needs and produces. See {@link Definition}.
 * - `declaration`: what the script's `indicator("Title", overlay = ...)`
 *   header says, or null if there is no header.
 * - `sources`: the exact text of the file and of every file it imports.
 *   Only returned when the request asks for it (`includeSources`). Saving
 *   an Indicator stores these texts, so it keeps working after the files
 *   change.
 */
export const CompileResponse = Schema.Struct({
  id: Schema.NonEmptyString,
  definition: Definition,
  declaration: Schema.NullOr(Declaration),
  sources: Schema.optionalKey(SnapshotSources.fields.sources),
}).annotate(strict);
export type CompileResponse = typeof CompileResponse.Type;

/* -------------------------------------------------------------------------- */
/* What a node reads                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The Bars columns: open, high, low, close and volume come from Feed, and the
 * service computes hl2, hlc3, ohlc4 and hlcc4 from them. Each is a nullable
 * Float64. A {@link Bars} or {@link Samples} input may list only these
 * columns. There is no `time` column: every input row has its own time.
 */
export const barsSchema = new ArrowSchema(
  [...Object.keys(BarColumns), "hl2", "hlc3", "ohlc4", "hlcc4"].map(
    (name) => new Field(name, new Float64(), true),
  ),
);

const barsColumns = barsSchema.fields.map(({ name }) => name);

// What is wrong with a Bars or Samples schema, naming the field at fault and
// spelling types the way the JSON form does. Columns are matched by name only,
// so a column with the wrong type is never reported as missing.
const barsSchemaProblem = (schema: ArrowSchema) => {
  for (const { name, type } of schema.fields) {
    if (!barsColumns.includes(name))
      return `Field '${name}' is not a Bars column (${barsColumns.join(", ")})`;
    if (!DataType.isFloat(type) || type.precision !== Precision.DOUBLE)
      return `Field '${name}' must have type {"name":"floatingpoint","precision":"DOUBLE"}`;
  }
  const missing = Object.keys(BarColumns).filter(
    (name) => !schema.names.includes(name),
  );
  if (missing.length > 0)
    return `Schema is missing required Bars columns: ${missing.join(", ")}`;
};

/**
 * A bar series from Feed: which listing, provider, resolution, session and
 * adjustment, plus the columns it carries. The columns must include open,
 * high, low, close and volume, and may add hl2, hlc3, ohlc4 and hlcc4, which
 * the service computes from OHLC. See {@link barsSchema}.
 *
 * @example
 * { _tag: "Bars", provider, listing, resolution: "1d", session, adjustment, schema: barsSchema }
 */
export const Bars = Schema.TaggedStruct("Bars", {
  ...BarsSeries.fields,
  schema: ArrowSchemaJson.check(Schema.makeFilter(barsSchemaProblem)),
}).annotate(strict);
export type Bars = typeof Bars.Type;

// One completed bar of a Samples input. A missing value is null.
const SampleRow = Schema.Struct({
  time: Schema.Int,
  ...Struct.map(BarColumns, Schema.NullOr),
}).annotate(strict);

/**
 * Bars that the caller supplies instead of Feed, for a run over made-up or
 * saved history. It names a series and lists columns exactly like
 * {@link Bars}, so the script still gets its clock, `syminfo` and
 * `timeframe`. `rows` are completed bars with strictly ascending times.
 * Observe rejects Samples when `to` is "now", because they never update.
 *
 * @example
 * { _tag: "Samples", ...series, schema: barsSchema,
 *   rows: [{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] }
 */
export const Samples = Schema.TaggedStruct("Samples", {
  ...BarsSeries.fields,
  schema: Bars.fields.schema,
  rows: Schema.Array(SampleRow).check(
    Schema.makeFilter(
      (rows) => rows.every((row, i) => i === 0 || row.time > rows[i - 1]!.time),
      {
        message:
          "Sample times must strictly ascend; only completed historical bars are supported",
      },
    ),
  ),
}).annotate(strict);
export type Samples = typeof Samples.Type;

// Not yet: read the output of a node that another observe call is running,
// using the rid that call returned. Add it back once runs can replay history.
// Today it can't work. That run's history is already gone, so there is no
// warmup. Its updates also don't arrive in step with this run's inputs, so
// binding it next to Bars fails on the first bar.
//
// export const NodeOutput = Schema.TaggedStruct("NodeOutput", {
//   schema: ArrowSchemaJson,
//   rid: Schema.NonEmptyString,
// }).annotate(strict);

/**
 * The output of another node in the same observe request, named by its key
 * in {@link ObserveRequest} `nodes`. This is how an alert reads an Indicator:
 * the Indicator goes into `nodes`, and the alert gets a NodeRef to it.
 * `schema` must equal that node's `definition.outputs`; the service rejects a
 * NodeRef whose copy is out of date.
 *
 * @example
 * { _tag: "NodeRef", node: "rsi", schema: rsiDefinition.outputs }
 */
export const NodeRef = Schema.TaggedStruct("NodeRef", {
  schema: ArrowSchemaJson,
  node: Schema.NonEmptyString,
}).annotate(strict);
export type NodeRef = typeof NodeRef.Type;

/**
 * Everything a node can read from. Every kind says which columns it carries
 * in `schema`, as an Arrow schema. The service checks the map against these
 * schemas, so it never has to ask Feed (or anyone else) what a data source
 * looks like. More kinds (quotes, trades, ...) get added to this union.
 * `satisfies` makes the compiler reject a kind that has no `schema`.
 */
export const NodeInput = Schema.Union([
  Bars,
  Samples,
  NodeRef,
]) satisfies Schema.Codec<
  { readonly schema: ArrowSchema },
  { readonly schema: ArrowSchemaJsonEncoded }
>;
export type NodeInput = typeof NodeInput.Type;

/**
 * Parameter values by parameter name, such as `{ length: 14, src: "close" }`.
 * Only numbers, booleans and strings. Colors, enums and sources are strings.
 */
export const NodeParameters = Schema.Record(
  Schema.String,
  Schema.Union([Schema.Finite, Schema.Boolean, Schema.String]),
);
export type NodeParameters = typeof NodeParameters.Type;

/**
 * Where a value sits inside one row of an input. Usually it is just a column
 * name, such as `["close"]`. It is longer when the value is inside a struct.
 * For example, a plot output `basis` is a struct, and its number is at
 * `["basis", "series"]`.
 */
export const FieldPath = Schema.NonEmptyArray(Schema.NonEmptyString);
export type FieldPath = typeof FieldPath.Type;

/**
 * For each column a node reads, which of its inputs supplies it and where.
 * The key is the column name. The value is `[input name, FieldPath]`.
 *
 * @example
 * {
 *   close: ["bars", ["close"]],
 *   rsi:   ["rsi",  ["rsi"]],             // a NodeRef input named "rsi"
 *   basis: ["bb",   ["basis", "series"]], // a number inside a struct
 * }
 *
 * The map may list more columns than the node reads. Listing every Bars
 * column is normal. That way the map stays the same when the user picks a
 * different `input.source`.
 *
 * The service binds only the columns the node reads with its current
 * parameters, and fails if any of those is missing from the map. It never
 * checks the map against `Definition.inputs`, which reflects the default
 * parameters.
 */
export const InputMap = Schema.Record(
  Schema.String,
  Schema.Tuple([Schema.NonEmptyString, FieldPath]),
);
export type InputMap = typeof InputMap.Type;

/* -------------------------------------------------------------------------- */
/* How a node runs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How to run one script: what it reads, which input fills each column, and
 * which parameter values it uses.
 *
 * - `inputs`: the data sources, keyed by a name you choose, such as `bars`
 *   or `rsi`.
 * - `map`: which input fills each column. See {@link InputMap}.
 * - `parameters`: parameter values. See {@link NodeParameters}.
 * - `requests`: one config per `request.security(...)` line, using the same
 *   names as `Definition.requests`. A child has its own inputs, usually for
 *   another symbol or resolution.
 *
 * All inputs of one node must move together: they need the same clock, and
 * they must send the same updates, in the same order. Tea checks the clock
 * when binding. The service keeps the updates in step: within one observe
 * call it opens each distinct input once and shares it, so two nodes that
 * read the same Bars see exactly the same rows.
 *
 * A stored config, such as an alert rule, is a NodeConfig. The compiled `id`
 * and the time window only appear when it runs, in {@link ObserveRequest}.
 */
export interface NodeConfig {
  readonly inputs: Readonly<Record<string, NodeInput>>;
  readonly map: InputMap;
  readonly parameters: NodeParameters;
  readonly requests: Readonly<Record<string, NodeConfig>>;
}

/**
 * {@link NodeConfig} as JSON: input schemas use Arrow's JSON form. A `type`,
 * not an `interface`, so a stored config can be passed as `Schema.Json`.
 */
export type NodeConfigEncoded = {
  readonly inputs: Readonly<Record<string, typeof NodeInput.Encoded>>;
  readonly map: typeof InputMap.Encoded;
  readonly parameters: typeof NodeParameters.Encoded;
  readonly requests: Readonly<Record<string, NodeConfigEncoded>>;
};

// NodeConfig contains itself (through `requests`), so TypeScript can't infer
// its type; that is why the types above are written out by hand.
/** Converts a {@link NodeConfig} to JSON and back. */
export const NodeConfig = Schema.Struct({
  inputs: Schema.Record(Schema.String, NodeInput),
  map: InputMap,
  parameters: NodeParameters,
  requests: Schema.Record(
    Schema.String,
    Schema.suspend(
      (): Schema.Codec<NodeConfig, NodeConfigEncoded> => NodeConfig,
    ),
  ),
}).annotate({
  ...strict,
  identifier: "NodeConfig", // names the recursive JSON Schema definition
});

/**
 * The inputs and map of a node that reads one Bars series: an input named
 * `bars` that lists every Bars column, and a map that reads each column from
 * it. Only the five series fields are copied, so a caller's extra keys never
 * reach the strict Bars input.
 *
 * @example
 * const config: NodeConfig = { ...barsInputs(series), parameters: {}, requests: {} };
 * config.map.close; // ["bars", ["close"]]
 */
export function barsInputs(
  series: BarsSeries,
): Pick<NodeConfig, "inputs" | "map"> {
  return {
    inputs: {
      bars: { _tag: "Bars", ...barsSeries(series, series), schema: barsSchema },
    },
    map: Object.fromEntries(
      barsColumns.map((name) => [name, ["bars", [name]] as const]),
    ),
  };
}

/**
 * The market each request child of a run reads, by request name. Read from a
 * run's filled-in config, it is the data a script actually reads beyond its
 * own inputs, such as a lower timeframe. Samples stand for the series they
 * name; NodeRefs read no market. Children of children are not included.
 *
 * @example
 * requestSeries(message.config);
 * // [{ name: "lower", series: { provider: "binance", ..., resolution: "1m" } }]
 */
export function requestSeries(
  config: NodeConfig,
): { readonly name: string; readonly series: BarsSeries }[] {
  return Object.entries(config.requests).flatMap(([name, child]) =>
    Object.values(child.inputs).flatMap((input) =>
      input._tag === "NodeRef"
        ? []
        : [{ name, series: barsSeries(input, input) }],
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Observe                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Warmup for a script that states no need of its own, enough for indicators
 * such as EMA to settle. Chart Indicators, alerts and Agent runs share it, so
 * one script gives the same values everywhere.
 */
export const standardWarmupBars = 1000;

/**
 * Run a compiled script over a time window and return its output.
 *
 * - `from`, `to`: the window to return. With `to: "now"`, the run keeps
 *   going and sends live updates. With a number, the run stops there.
 * - `countBack`: return at least this many bars when that much history
 *   exists. The window starts before `from` if needed.
 * - `warmupBars`: how many bars each input, request children included, runs
 *   before the window when that history exists. Their outputs are never
 *   returned. With 0 nothing warms before the window, so a higher-timeframe
 *   `request.security` has no value until its next bar opens, unless none
 *   opens inside the window and `countBack` returns the one before it. See
 *   {@link standardWarmupBars}.
 * - `id`: the compiled script to run, from {@link CompileResponse}.
 * - `inputs`, `map`, `parameters`, `requests`: how to run it. See
 *   {@link NodeConfig}.
 * - `nodes`: other scripts that run in the same call, keyed by a name you
 *   choose. NodeRef inputs use that name to read them. Every NodeRef must
 *   name a key in `nodes`, every node must be read by a NodeRef, nodes must
 *   not read each other in a loop, and request children cannot read nodes.
 * - `samples`, optional: supplied history. With it, the run reads only
 *   supplied rows and never Feed: a Bars input fails `invalid_request`, and a
 *   request child that `requests` leaves out reads the Samples here, or one
 *   its parent reads, holding the listing and timeframe its line names at the
 *   parent's session and adjustment, else fails `invalid_request`. A study
 *   preview passes its example's other captured timeframes.
 *
 * The service checks each node's `id` when the run starts; after that the run
 * owns the nodes it built, and only disposing the root `id` stops it.
 *
 * @example
 * An alert that compares RSI with a level:
 * {
 *   id: alertId, from, to: "now", countBack: 1, warmupBars: standardWarmupBars,
 *   inputs: {
 *     bars: { _tag: "Bars", ...series, schema: barsSchema },
 *     rsi: { _tag: "NodeRef", node: "rsi", schema: rsiDefinition.outputs },
 *   },
 *   map: { close: ["bars", ["close"]], rsi: ["rsi", ["rsi"]] },
 *   parameters: { level: 70 },
 *   requests: {},
 *   nodes: {
 *     rsi: {
 *       id: rsiId,
 *       inputs: { bars: { _tag: "Bars", ...series, schema: barsSchema } },
 *       map: { close: ["bars", ["close"]] },
 *       parameters: { length: 14 },
 *       requests: {},
 *     },
 *   },
 * }
 */
export const ObserveRequest = Range.mapFields(
  (fields) => ({
    ...fields,
    warmupBars: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    ...NodeConfig.fields,
    id: Schema.NonEmptyString,
    nodes: Schema.Record(
      Schema.String,
      Schema.Struct({
        id: Schema.NonEmptyString,
        ...NodeConfig.fields,
      }).annotate(strict),
    ),
    samples: Schema.optionalKey(Schema.Array(Samples)),
  }),
  { unsafePreserveChecks: true }, // keeps the from < to check
).annotate(strict);
export type ObserveRequest = typeof ObserveRequest.Type;

/** Release a compiled script and stop every run started from it. Disposing
 * an unknown id still succeeds. */
export const DisposeRequest = Schema.Struct({
  id: Schema.NonEmptyString,
}).annotate(strict);
export type DisposeRequest = typeof DisposeRequest.Type;

/**
 * The output for the requested window, sent once when observe starts. Live
 * updates, if there are any, come after it as separate frames.
 *
 * `range` is the window that was actually returned. `to` is always a number
 * here, because "now" has been turned into the real cutoff time. `from` can
 * be earlier than the requested `from` because of `countBack`. Every row
 * falls inside `range`, and warmup rows are left out.
 */
export const Snapshot = Schema.Struct({
  range: TimeRange.mapFields((fields) => ({ ...fields, to: Schema.Int }), {
    unsafePreserveChecks: true,
  }).annotate(strict),
  data: dataFrameCodec,
})
  .check(
    Schema.makeFilter(
      ({ range, data }) =>
        [...data].every(({ time }) => time >= range.from && time < range.to),
      { message: "Tea snapshot times must be inside its range" },
    ),
  )
  .annotate(strict);
export type Snapshot = typeof Snapshot.Type;

/**
 * What one observation sends: a `snapshot` first, then, for a live run,
 * `updates` with the attempts computed after it. `rid` is the run id that
 * observe returns; nothing reads it yet. `config` is the config the run reads,
 * with every request child the request left out filled in from its line, so a
 * client can show the data a script actually reads.
 */
export const Message = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    rid: Schema.NonEmptyString,
    config: NodeConfig,
    snapshot: Snapshot,
  }).annotate(strict),
  Schema.Struct({
    type: Schema.Literal("updates"),
    data: dataFrameCodec,
  }).annotate(strict),
]);
export type Message = typeof Message.Type;

/** Open one observation over Hose. It lasts as long as the channel. */
export const ChannelRequest = Schema.Struct({
  type: Schema.Literal("tea.open"),
  request: ObserveRequest,
}).annotate(strict);
export type ChannelRequest = typeof ChannelRequest.Type;
