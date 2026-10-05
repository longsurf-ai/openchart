// Purpose: Wiring: which stream and field fill each column a bound script reads.
import {
  Bool,
  DataType,
  Field,
  Float64,
  Schema as ArrowSchema,
  TimestampMillisecond,
} from "apache-arrow";
import { Effect, Option, Predicate, Record } from "effect";
import { map } from "rxjs";
import { DataStream } from "tea";
import * as Tea from "@openchart/tea";
import { invalid } from "./errors";

const time = new Field("time", new TimestampMillisecond(), false);
const provisional = new Field("provisional", new Bool(), false);

/**
 * The schema of a stream that fills `columns` of a Tea Node: `time`,
 * `provisional`, and each column as a non-null Float64.
 * @example new DataStream(columnSchema(["close"]), rows, clock);
 */
export const columnSchema = (columns: readonly string[]) =>
  new ArrowSchema([
    time,
    provisional,
    ...columns.map((name) => new Field(name, new Float64(), false)),
  ]);

// Output coordinates of a node, which a map cannot read as values.
const coordinates = new Set(["index", "time", "timed", "provisional"]);

// Whether `schema` declares a field at `path`, descending through structs.
function declares(schema: ArrowSchema, path: Tea.FieldPath): boolean {
  let fields: readonly Field[] = schema.fields;
  for (const name of path) {
    const field = fields.find((field) => field.name === name);
    if (field === undefined) return false;
    fields = DataType.isStruct(field.type) ? field.type.children : [];
  }
  return true;
}

// The input and field path that fill `column`, checked against the schema
// that input declares.
const mapEntry = Effect.fn("Tea.mapEntry")(function* (
  config: Pick<Tea.NodeConfig, "inputs" | "map">,
  column: string,
  where: string,
) {
  const entry = Record.get(config.map, column);
  if (Option.isNone(entry))
    return yield* invalid(
      `Column '${column}' has no map entry at ${where}; the map has ${Object.keys(config.map).join(", ") || "no entries"}`,
    );
  const [name, path] = entry.value;
  const input = Record.get(config.inputs, name);
  if (Option.isNone(input))
    return yield* invalid(
      `Column '${column}' reads input '${name}', which is not an input at ${where}`,
    );
  if (coordinates.has(path[0]))
    return yield* invalid(
      `Column '${column}' cannot read '${path[0]}' of input '${name}' at ${where}`,
    );
  if (!declares(input.value.schema, path))
    return yield* invalid(
      `Column '${column}' reads '${path.join(".")}', which input '${name}' at ${where} does not declare`,
    );
  return { input: name, path };
});

// One number from each row of `source`, as a stream that fills `column`:
// the value at `path` in the row, or NaN for anything that is not a number
// (na, a missing field). It keeps the source's clock and subscribes the
// source once per subscription.
const projectColumn = (
  source: DataStream,
  column: string,
  path: Tea.FieldPath,
): DataStream =>
  new DataStream(
    columnSchema([column]),
    source.asObservable().pipe(
      map((row) => {
        const value = path.reduce<unknown>(
          (value, key) => (Predicate.isObject(value) ? value[key] : undefined),
          row,
        );
        return {
          time: row.time,
          provisional: row.provisional,
          [column]: typeof value === "number" ? value : NaN,
        };
      }),
    ),
    source.clock,
  );

/** The streams one level of a Tea Node reads, as {@link wire} connects them. */
export interface Wired {
  /** One stream per column the level reads, keyed by the column. */
  readonly columns: Readonly<Record<string, DataStream>>;
  /** The streams of inputs that fill no column. They still drive the level's steps. */
  readonly drivers: readonly DataStream[];
}

/**
 * Connect a level's input streams to the columns it reads: each column in
 * `reads` (the bound level's input schema) gets the field its map entry
 * names, such as
 * `close: ["bars", ["close"]]` or `basis: ["bb", ["basis", "series"]]`.
 * Only those columns need an entry: parameters such as `input.source`
 * choose them, so the map may list more.
 *
 * Fails with invalid_request naming `where` when a column has no map entry,
 * the entry names no input, reads a coordinate (`index`, `time`, `timed`,
 * `provisional`), or reads a field the input's declared schema lacks. An
 * input that fills no column is returned as a driver: it still moves the
 * script forward one bar at a time. Nothing subscribes here.
 * @example const { columns, drivers } = yield* wire(config, { bars: source.stream }, bound.inputs.schema, "root");
 */
export const wire = Effect.fn("Tea.wire")(function* (
  config: Pick<Tea.NodeConfig, "inputs" | "map">,
  streams: Readonly<Record<string, DataStream>>,
  reads: ArrowSchema,
  where: string,
) {
  const filled = yield* Effect.forEach(reads.fields, ({ name: column }) =>
    Effect.map(mapEntry(config, column, where), ({ input, path }) => ({
      input,
      column,
      stream: projectColumn(streams[input]!, column, path),
    })),
  );
  const used = new Set(filled.map(({ input }) => input));
  return {
    columns: Record.fromEntries(
      filled.map(({ column, stream }) => [column, stream]),
    ),
    drivers: Object.entries(streams).flatMap(([name, stream]) =>
      used.has(name) ? [] : [stream],
    ),
  } satisfies Wired;
});
