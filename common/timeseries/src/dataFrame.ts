// Purpose: Own one Arrow table and publish immutable, checked timeseries values.
import {
  DataType,
  MapRow,
  Schema as ArrowSchema,
  StructRow,
  Table,
  TimeUnit,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
  type Field,
} from "apache-arrow";
import { Schema } from "effect";

const ms: unique symbol = Symbol("@openchart/timeseries.ms");
const dataFrame: unique symbol = Symbol("@openchart/timeseries.dataFrame");

/**
 * Shared TypeScript identity markers for validated timestamps and frames.
 *
 * These markers do not store data or appear in the transport payload. Use the
 * frame constructors to obtain checked values; copying a marker does not
 * validate an object.
 */
export const symbols = { ms, dataFrame } as const;
/**
 * A checked timestamp: an integer count of milliseconds since 1970-01-01 UTC.
 *
 * For example, `0` is the start of that day and `1000` is one second later.
 * Constructors accept ordinary numbers; frame rows expose this marked type
 * after checking that the numbers are safe integers in the required order.
 * The mark exists only in TypeScript, so a timestamp remains a JavaScript number.
 */
export type Ms = number & { readonly _ms: typeof symbols.ms };
/**
 * String descriptions shared by every row, such as `{ sensor: "kitchen" }`.
 *
 * Labels identify the measurements. Requested start/end times belong in the
 * request or response envelope, since they do not describe the measurements
 * themselves. Labels are stored in the Arrow schema and survive transport.
 */
export type Labels = Readonly<Record<string, string>>;
/**
 * An Effect schema describing one number, string or boolean observation field.
 *
 * For example, `Schema.Finite` describes a numeric reading. A schema can also
 * constrain values, such as requiring a count to be nonnegative. See
 * {@link @openchart/timeseries#defineDataFrame} for how missing cells are handled.
 */
export type FieldSchema =
  | Schema.Codec<number, number>
  | Schema.Codec<string, string>
  | Schema.Codec<boolean, boolean>;
/**
 * Observation field names mapped to their Effect schemas, excluding `time`.
 *
 * A declaration such as `{ temperature: Schema.Finite }` supplies both the
 * field's TypeScript type and its value checks. Producers with an existing
 * Arrow schema use {@link fromRows} or {@link createDataFrame} instead.
 */
export type DataFrameSpec = Readonly<Record<string, FieldSchema>>;
/**
 * One row returned by {@link DataFrame.get}, with time expressed in milliseconds.
 *
 * A declared scalar frame exposes the names and types from its declaration;
 * observation cells may also be null. An undeclared frame exposes other fields
 * as `unknown`, since Arrow also supports nested objects, lists and other types.
 * Returned values do not share writable storage with the frame.
 *
 * @typeParam S - The observation field declarations, without `time`.
 */
export type DataFrameRow<S extends DataFrameSpec = DataFrameSpec> = {
  readonly time: Ms;
} & (string extends keyof S
  ? Readonly<Record<string, unknown>>
  : { readonly [K in keyof S]: S[K]["Type"] | null });
/** Options shared by frame construction and decoding. */
export interface CreateDataFrameOptions {
  /**
   * Replace the table's labels with these descriptions for all rows.
   * If omitted, keep labels already stored in the schema, or use an empty object.
   */
  readonly labels?: Labels;
  /**
   * Allow separate events to share a timestamp, such as two clicks in one millisecond.
   * Time must still move forward or stay equal; it may never move backward.
   *
   * If omitted, inherit the table's explicit event setting, or default to false.
   * Passing false requires strictly increasing times even for an event table.
   * This setting travels with the schema through the shared codec.
   */
  readonly allowDuplicateTimes?: boolean;
}

const labelsKey = "openchart:labels";
const duplicatesKey = "openchart:allowDuplicateTimes";
const labelsSchema = Schema.Record(Schema.String, Schema.String);
const parseLabels = Schema.decodeUnknownSync(
  Schema.fromJsonString(labelsSchema),
);

/**
 * A table of measurements that share one ordered time column.
 *
 * For example, a row can contain a timestamp and a room temperature. Arrow
 * stores the columns internally; callers read ordinary rows through `get()`
 * or iteration. This package keeps one private Arrow table, with no second
 * stored copy of the rows.
 *
 * @remarks
 * Reading a row, schema or table returns an independent value. Plain row
 * objects and arrays are frozen. Mutable values such as byte arrays, Dates and
 * Maps are copied, so editing those copies cannot change a later frame read.
 * Frames need no explicit cleanup; their storage is released by garbage collection.
 *
 * @typeParam S - Scalar observation declarations, or the default for arbitrary Arrow columns.
 *
 * @example
 * ```ts
 * import { fromPoints } from "@openchart/timeseries";
 *
 * const readings = fromPoints({ sensor: "kitchen" }, [
 *   { time: 0, temperature: 21 },
 *   { time: 1000, temperature: 22 },
 * ]);
 * readings.numRows; // 2
 * readings.get(1)?.temperature; // 22
 * Array.from(readings, (row) => row.time); // [0, 1000]
 * ```
 */
export interface DataFrame<
  S extends DataFrameSpec = DataFrameSpec,
> extends Iterable<DataFrameRow<S>> {
  /** Constructor-owned marker; it is omitted from the encoded data. */
  readonly _dataFrame: typeof symbols.dataFrame;
  /** Number of rows, including rows whose observation cells are missing. */
  readonly numRows: number;
  /** An independent frozen object describing the identity shared by all rows. */
  readonly labels: Labels;
  /**
   * A copy of the column names, Arrow types and descriptive metadata.
   *
   * Nested field metadata is copied too. Editing the returned schema does not
   * change how this frame is read or encoded.
   */
  readonly schema: ArrowSchema;
  /**
   * Read a row by its zero-based position, rather than by its timestamp.
   *
   * Each call returns an independent row. Plain objects and arrays are frozen;
   * other mutable values are copied. Use iteration to read rows in time order.
   *
   * @param index - Row position; the first row is 0.
   * @returns A row copy, or null if the position is fractional, negative or past the end.
   *
   * @example
   * ```ts
   * import { fromPoints } from "@openchart/timeseries";
   *
   * const readings = fromPoints({}, [{ time: 1000, temperature: 21 }]);
   * readings.get(0); // { time: 1000, temperature: 21 }
   * readings.get(1); // null
   * ```
   */
  get(index: number): DataFrameRow<S> | null;
  /**
   * Read one column's values in row order, without reading the other columns.
   *
   * Values follow the same rules as {@link DataFrame.get}: missing cells stay
   * null, NaN stays NaN, plain objects and arrays are frozen, and other mutable
   * values are copied. The returned array is frozen too.
   *
   * @param name - A top-level column name, such as `time`.
   * @returns One value per row, in time order.
   * @throws If the frame has no column with that name.
   *
   * @example
   * ```ts
   * import { fromPoints } from "@openchart/timeseries";
   *
   * const readings = fromPoints({}, [
   *   { time: 0, temperature: 21 },
   *   { time: 1000, temperature: null },
   * ]);
   * readings.column("temperature"); // [21, null]
   * readings.column("time"); // [0, 1000]
   * readings.column("humidity"); // Throws: no such column.
   * ```
   */
  column<K extends keyof DataFrameRow<S> & string>(
    name: K,
  ): readonly DataFrameRow<S>[K][];
  /**
   * Export a writable Arrow table with independent data buffers and metadata.
   *
   * Use this when another library expects Arrow rather than ordinary rows.
   * To send the frame in a JSON message, use
   * {@link @openchart/timeseries#toJson} instead.
   *
   * @returns A complete table copy. Changing it cannot change this frame.
   *
   * @example
   * ```ts
   * import { fromPoints } from "@openchart/timeseries";
   *
   * const readings = fromPoints({}, [{ time: 0, temperature: 21 }]);
   * const exported = readings.toArrow();
   * exported.getChild("temperature")!.set(0, 99);
   * readings.get(0)?.temperature; // Still 21.
   * ```
   */
  toArrow(): Table;
}

/**
 * Copy Arrow's actual storage and schema through its binary stream format.
 * A shallow object copy would still share column bytes and metadata Maps.
 */
function copyTable(table: Table): Table {
  return tableFromIPC(tableToIPC(table));
}

/**
 * Turn Arrow row/column views into values that cannot write back into the table.
 *
 * Struct fields keep their names, lists keep their order, and Map keys keep
 * their original types. Ordinary objects and arrays are frozen; mutable binary,
 * Date and Map values receive independent storage. JSON is unsuitable for this
 * copy because it would change NaN to null and cannot represent bigint values.
 */
function detach(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) return structuredClone(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof StructRow)
    return Object.freeze(
      Object.fromEntries(
        Array.from(value as Iterable<[string, unknown]>, ([key, item]) => [
          key,
          detach(item),
        ]),
      ),
    );
  if (value instanceof MapRow)
    return new Map(
      Array.from(value as Iterable<[unknown, unknown]>, ([key, item]) => [
        detach(key),
        detach(item),
      ]),
    );
  if ("toJSON" in value && typeof value.toJSON === "function")
    return detach(value.toJSON());
  if (Symbol.iterator in value && typeof value[Symbol.iterator] === "function")
    return Object.freeze(Array.from(value as Iterable<unknown>, detach));
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, detach(item)]),
    ),
  );
}

/**
 * Reads a frame's private table for this module's storage sharing.
 * Assigned in {@link ArrowDataFrame}'s static block and never exported.
 */
let tableOf: (frame: DataFrame) => Table;

/**
 * Holds a checked table that nothing writes. Frames from {@link replaceTail}
 * share batches with the frame they came from; validation happens before
 * this private class is created.
 */
class ArrowDataFrame<S extends DataFrameSpec> implements DataFrame<S> {
  readonly _dataFrame: typeof symbols.dataFrame = symbols.dataFrame;
  readonly #table: Table;

  static {
    tableOf = (frame) => (frame as ArrowDataFrame<DataFrameSpec>).#table;
  }

  /** Take a table checked by createDataFrame, or assembled from checked frames by replaceTail. */
  constructor(table: Table) {
    this.#table = table;
    Object.freeze(this);
  }

  /** {@inheritDoc DataFrame.numRows} */
  get numRows(): number {
    return this.#table.numRows;
  }
  /** {@inheritDoc DataFrame.labels} */
  get labels(): Labels {
    return Object.freeze(
      parseLabels(this.#table.schema.metadata.get(labelsKey) ?? "{}"),
    );
  }
  /** {@inheritDoc DataFrame.schema} */
  get schema(): ArrowSchema {
    return copyTable(new Table(this.#table.schema)).schema;
  }
  /** {@inheritDoc DataFrame.get} */
  get(index: number): DataFrameRow<S> | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.numRows)
      return null;
    return detach(this.#table.get(index)) as DataFrameRow<S>;
  }
  /** {@inheritDoc DataFrame.column} */
  column<K extends keyof DataFrameRow<S> & string>(
    name: K,
  ): readonly DataFrameRow<S>[K][] {
    const vector = this.#table.getChild(name);
    if (!vector) throw new Error(`DataFrame has no column "${name}"`);
    return Object.freeze(Array.from(vector, detach)) as DataFrameRow<S>[K][];
  }
  /** Yield independent rows in time order, using the same copying rules as get(). */
  *[Symbol.iterator](): IterableIterator<DataFrameRow<S>> {
    for (let index = 0; index < this.numRows; index++) yield this.get(index)!;
  }
  /** {@inheritDoc DataFrame.toArrow} */
  toArrow(): Table {
    return copyTable(this.#table);
  }
}

/** Require unique names at each nesting level, so looking up a field is unambiguous. */
function checkFields(fields: readonly Field[]): void {
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name))
      throw new Error(`Duplicate Arrow field "${field.name}"`);
    names.add(field.name);
    if (field.type.children) checkFields(field.type.children);
  }
}

/**
 * Reject missing cells where an Arrow field says a value is required.
 * A present struct or list also checks its children. A permitted null parent
 * has no present children to check.
 */
function checkNullability(field: Field, value: unknown): void {
  if (value === null || value === undefined) {
    if (!field.nullable)
      throw new Error(`Non-nullable Arrow field "${field.name}" contains null`);
    return;
  }
  if (DataType.isStruct(field.type)) {
    const children = new Map(value as Iterable<[string, unknown]>);
    for (const child of field.type.children)
      checkNullability(child, children.get(child.name));
  } else if (
    DataType.isList(field.type) ||
    DataType.isFixedSizeList(field.type)
  ) {
    for (const item of value as Iterable<unknown>)
      checkNullability(field.type.children[0]!, item);
  }
}

/**
 * Copy an Arrow table into a frame with a checked time column.
 *
 * The table must declare `time` as an Arrow millisecond timestamp. Every row
 * needs a non-null, safe integer time, even if the Arrow field permits null.
 * Times must strictly increase unless duplicate event times are enabled.
 * Field names must be unique at each nesting level. Required cells are checked
 * at the top level and inside objects (Arrow Struct) and lists.
 *
 * @remarks
 * Data buffers and schema metadata are copied before publication. The caller
 * keeps ownership of the supplied table and may continue editing it.
 * `openchart:labels` stores labels as JSON in schema metadata;
 * `openchart:allowDuplicateTimes` stores the explicit event setting as `"true"`.
 * Other schema and field metadata is preserved.
 *
 * This constructor checks frame structure, not producer-specific value rules
 * such as a temperature limit. For those rules, use
 * {@link @openchart/timeseries#defineDataFrame}.
 *
 * @typeParam S - Scalar declarations used by typed producers; this type argument adds no runtime checks.
 * @param table - An Arrow table whose columns already describe the intended values.
 * @param options - Label overrides and the duplicate-event-time setting.
 * @returns A frame with independently owned storage.
 * @throws If time, field names, labels or required cells are invalid, or Arrow cannot copy the table.
 *
 * @example
 * ```ts
 * import { Table, TimestampMillisecond, vectorFromArray } from "apache-arrow";
 * import { createDataFrame } from "@openchart/timeseries";
 *
 * const table = new Table({
 *   time: vectorFromArray([0, 1000], new TimestampMillisecond()),
 *   temperature: vectorFromArray([21, 22]),
 * });
 * const readings = createDataFrame(table, { labels: { sensor: "kitchen" } });
 * readings.get(1); // { time: 1000, temperature: 22 }
 * table.getChild("temperature")!.set(1, 99);
 * readings.get(1)?.temperature; // Still 22.
 * ```
 */
export function createDataFrame<S extends DataFrameSpec = DataFrameSpec>(
  table: Table,
  options: CreateDataFrameOptions = {},
): DataFrame<S> {
  checkFields(table.schema.fields);
  const timeField = table.schema.fields.find((field) => field.name === "time");
  if (
    !timeField ||
    !DataType.isTimestamp(timeField.type) ||
    timeField.type.unit !== TimeUnit.MILLISECOND
  )
    throw new Error("DataFrame requires a TimestampMillisecond time column");
  const owned = copyTable(table);
  const labels =
    options.labels ?? parseLabels(owned.schema.metadata.get(labelsKey) ?? "{}");
  Schema.decodeUnknownSync(labelsSchema)(labels);
  owned.schema.metadata.set(
    labelsKey,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
  const duplicateValue = owned.schema.metadata.get(duplicatesKey);
  if (duplicateValue !== undefined && duplicateValue !== "true")
    throw new Error("Invalid DataFrame duplicate-time metadata");
  const duplicates = options.allowDuplicateTimes ?? duplicateValue === "true";
  if (duplicates) owned.schema.metadata.set(duplicatesKey, "true");
  else owned.schema.metadata.delete(duplicatesKey);
  const time = owned.getChild("time")!;
  let previous: number | undefined;
  for (let index = 0; index < owned.numRows; index++) {
    const value: unknown = time.get(index);
    if (
      !owned.isValid(index) ||
      typeof value !== "number" ||
      !Number.isSafeInteger(value)
    )
      throw new Error(
        `Invalid time[${index}]: expected safe integer epoch milliseconds`,
      );
    if (
      previous !== undefined &&
      (duplicates ? value < previous : value <= previous)
    )
      throw new Error(
        `DataFrame time must be ${duplicates ? "non-decreasing" : "strictly ascending"}`,
      );
    previous = value;
    for (const [column, field] of owned.schema.fields.entries())
      checkNullability(field, owned.getChildAt(column)!.get(index));
  }
  return new ArrowDataFrame<S>(owned);
}

/**
 * Build a mutable Arrow table from already-validated rows and an existing schema.
 *
 * Columns follow the supplied schema rather than being inferred from the data.
 * The empty case keeps that schema without asking Arrow to infer empty vectors.
 * Callers still need createDataFrame to check time and copy the resulting storage.
 *
 * @param schema - Column names, types, nullability and metadata supplied by the producer.
 * @param rows - Values matching the schema; extra properties are ignored.
 * @returns An Arrow table that has not yet passed the frame's structural checks.
 * @internal
 */
export function tableFromRows(
  schema: ArrowSchema,
  rows: readonly Readonly<Record<string, unknown>>[],
): Table {
  if (rows.length === 0) return new Table(schema);
  return new Table(
    schema,
    Object.fromEntries(
      schema.fields.map((field) => [
        field.name,
        vectorFromArray(
          rows.map((row) => row[field.name]),
          field.type,
        ),
      ]),
    ),
  );
}

/**
 * Create a frame from rows whose Arrow schema is already known.
 *
 * Use this for nested objects or lists, or when a producer such as Tea already
 * supplies the column schema. Empty rows keep the declared columns. Unlike
 * {@link @openchart/timeseries#fromPoints}, this function does not infer types.
 *
 * @remarks
 * Rows must already satisfy the producer's value rules. Arrow builds the columns
 * and may convert values to their declared types; this is not a general parser
 * for untrusted row objects. Raw timestamps are checked before conversion so
 * fractional values cannot silently become whole milliseconds.
 * The resulting frame owns its buffers and metadata independently of the inputs.
 *
 * @param schema - The existing Arrow column schema; it must include a millisecond `time` field.
 * @param rows - Validated row values. Only properties named by the schema are stored.
 * @param options - Label overrides and the duplicate-event-time setting.
 * @returns A frame retaining the supplied column types and metadata.
 * @throws If timestamps, ordering, names, labels or required cells are invalid, or Arrow cannot build the table.
 *
 * @example
 * ```ts
 * import { Field, Float64, Schema, TimestampMillisecond } from "apache-arrow";
 * import { fromRows } from "@openchart/timeseries";
 *
 * const schema = new Schema([
 *   new Field("time", new TimestampMillisecond(), false),
 *   new Field("temperature", new Float64(), true),
 * ]);
 * const readings = fromRows(schema, [
 *   { time: 0, temperature: 21 },
 *   { time: 1000, temperature: null },
 * ]);
 * readings.get(1)?.temperature; // null, not NaN.
 * fromRows(schema, []).numRows; // 0; the columns still exist.
 * ```
 */
export function fromRows(
  schema: ArrowSchema,
  rows: readonly Readonly<Record<string, unknown>>[],
  options?: CreateDataFrameOptions,
): DataFrame {
  if (rows.some((row) => !Number.isSafeInteger(row.time)))
    throw new Error("DataFrame time must be safe integer epoch milliseconds");
  return createDataFrame(tableFromRows(schema, rows), options);
}

/**
 * Recognize frames created by this module without inspecting every row again.
 *
 * Codecs use this for the decoded side of their contract. A plain object with
 * the public marker is insufficient; unknown wire data must go through decoding.
 *
 * @param value - A value whose origin is not yet known.
 * @returns Whether the value is an instance of the private frame implementation.
 * @internal
 */
export function isDataFrame(value: unknown): value is DataFrame {
  return value instanceof ArrowDataFrame;
}

/**
 * Whether a frame explicitly allows separate events to share a timestamp.
 * Without that setting, construction already guaranteed strictly ascending time.
 *
 * @param frame - A frame created by this module.
 * @returns True when the frame's schema carries the event setting.
 * @internal
 */
export function allowsDuplicateTimes(frame: DataFrame): boolean {
  return tableOf(frame).schema.metadata.get(duplicatesKey) === "true";
}

/** Kept rows ending in a shorter batch are rebuilt with the tail, so batches stay at least this long. */
const minBatchRows = 64;

/**
 * Choose the first row to rebuild when a frame's rows change from `start` on.
 *
 * Rows before the returned position keep sharing the frame's storage. If they
 * would end in a batch fragment shorter than 64 rows, that fragment is rebuilt
 * too, so frequent small updates grow a frame by about one Arrow batch per 64
 * rows instead of one per update.
 *
 * @param frame - The frame being updated.
 * @param start - The first changing row, from 0 to `frame.numRows`.
 * @returns A row position at or before `start`.
 * @internal
 */
export function tailStart(frame: DataFrame, start: number): number {
  let first = 0;
  for (const batch of tableOf(frame).batches) {
    const end = first + batch.numRows;
    if (start <= end) return start - first < minBatchRows ? first : start;
    first = end;
  }
  return start;
}

/**
 * Keep a frame's rows before `start`, sharing their storage, then append every row of `tail`.
 *
 * Nothing is copied or checked again: the kept rows were checked when `frame`
 * was built, and the caller supplies a checked `tail` with the frame's schema
 * whose first time follows the kept rows. Both inputs stay valid, since nothing
 * writes a frame's table.
 *
 * @param frame - The frame whose earlier rows are kept.
 * @param start - Number of rows to keep, from 0 to `frame.numRows`.
 * @param tail - The replacement for every row from `start` on.
 * @returns A frame with the kept rows followed by the tail's rows.
 * @internal
 */
export function replaceTail<S extends DataFrameSpec>(
  frame: DataFrame<S>,
  start: number,
  tail: DataFrame<S>,
): DataFrame<S> {
  if (start === 0) return tail;
  return new ArrowDataFrame<S>(
    tableOf(frame).slice(0, start).concat(tableOf(tail)),
  );
}
