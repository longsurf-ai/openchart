// Purpose: Transform rows while retaining Arrow schemas, nested values and metadata.
import { util, type Field, type Schema } from "apache-arrow";
import {
  createDataFrame,
  tableFromRows,
  type DataFrame,
  type DataFrameSpec,
} from "./dataFrame";

/** Compare metadata entries without treating Map insertion order as meaningful. */
function sameMetadata(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  return (
    left.size === right.size &&
    Array.from(left).every(([key, value]) => right.get(key) === value)
  );
}

/** Supplement Arrow's schema comparison with metadata on every nested field. */
function sameFields(left: readonly Field[], right: readonly Field[]): boolean {
  return (
    left.length === right.length &&
    left.every((field, index) => {
      const other = right[index]!;
      return (
        field.type.toString() === other.type.toString() &&
        sameMetadata(field.metadata, other.metadata) &&
        sameFields(field.type.children ?? [], other.type.children ?? [])
      );
    })
  );
}

/**
 * Require matching column layouts, labels and schema/field metadata.
 *
 * Metadata can change the meaning of a column even when its values and Arrow
 * type match. For example, a list of newly emitted events must not be combined
 * with a list representing all events so far.
 *
 * @param first - Frame whose schema and identity define the expected shape.
 * @param second - Frame to compare with the first.
 * @throws If labels, column layouts or metadata differ, including nested fields.
 * @internal
 */
export function assertCompatible(first: DataFrame, second: DataFrame): void {
  const leftLabels = first.labels;
  const rightLabels = second.labels;
  if (
    Object.keys(leftLabels).length !== Object.keys(rightLabels).length ||
    Object.entries(leftLabels).some(
      ([name, value]) => rightLabels[name] !== value,
    )
  )
    throw new Error("Cannot combine DataFrames with different labels");
  const left = first.schema;
  const right = second.schema;
  if (
    !util.compareSchemas(left, right) ||
    !sameMetadata(left.metadata, right.metadata) ||
    !sameFields(left.fields, right.fields)
  )
    throw new Error(
      "Cannot combine DataFrames with different columns or metadata",
    );
}

/**
 * Copy operation results into Arrow storage using the supplied full schema.
 *
 * Keeping the schema, rather than inferring types from the rows, preserves
 * empty columns, nested values, labels and field metadata.
 *
 * @param schema - Source schema, or a copy intentionally adjusted by the operation.
 * @param rows - Rows that already satisfy the declared value types.
 * @returns An independently owned frame with the supplied schema and rows.
 * @throws If Arrow construction or DataFrame validation fails.
 * @internal
 */
export function rebuild<S extends DataFrameSpec>(
  schema: Schema,
  rows: readonly Readonly<Record<string, unknown>>[],
): DataFrame<S> {
  return createDataFrame<S>(tableFromRows(schema, rows));
}

/**
 * Select rows by their zero-based positions, preserving their original order.
 *
 * The result keeps labels, column types, nested values and all schema metadata.
 * Selecting no rows still retains the schema. Selecting every row returns the
 * original immutable frame; other selections create independent storage.
 * Duplicate event timestamps remain separate rows when their indices differ.
 *
 * @param frame - Frame to select from; it is never modified.
 * @param indices - Strictly increasing integer positions within the frame.
 * @returns A frame containing exactly the selected rows.
 * @throws If any index is negative, fractional, repeated, out of order or out of bounds.
 *
 * @example
 * ```ts
 * import { fromPoints, takeRows } from "@openchart/timeseries";
 *
 * const readings = fromPoints({ sensor: "room" }, [
 *   { time: 1_000, temperature: 20 },
 *   { time: 2_000, temperature: 21 },
 *   { time: 3_000, temperature: 22 },
 * ]);
 * const selected = takeRows(readings, [0, 2]);
 * Array.from(selected, (row) => row.temperature); // [20, 22]
 * readings.numRows; // 3: selection does not remove rows from the input.
 * ```
 */
export function takeRows<S extends DataFrameSpec>(
  frame: DataFrame<S>,
  indices: readonly number[],
): DataFrame<S> {
  let previous = -1;
  for (const index of indices) {
    if (!Number.isInteger(index) || index <= previous || index >= frame.numRows)
      throw new Error(
        "DataFrame row indices must increase and remain in bounds",
      );
    previous = index;
  }
  if (indices.length === frame.numRows) return frame;
  return rebuild(
    frame.schema,
    indices.map((index) => frame.get(index)!),
  );
}

/**
 * Append every row of a later frame after every row of an earlier frame.
 *
 * Both frames must have matching labels, column layouts and metadata. No rows
 * are sorted, replaced or dropped; use {@link @openchart/timeseries#mergeByTime} to replace readings
 * at matching timestamps. Ordinary sampled frames require the first later
 * timestamp to exceed the last earlier one. Frames explicitly allowing duplicate
 * event timestamps permit equality at that boundary, but still reject reversal.
 *
 * @param earlier - First part of the timeline; it is never modified.
 * @param later - Continuation with a compatible schema and identity.
 * @returns A combined frame, or the nonempty input when the other is empty.
 * @throws If schemas or labels differ, or the combined timeline is invalid.
 *
 * @example
 * ```ts
 * import { concatFrames, fromPoints } from "@openchart/timeseries";
 *
 * const earlier = fromPoints({ sensor: "room" }, [
 *   { time: 1_000, temperature: 20 },
 * ]);
 * const later = fromPoints({ sensor: "room" }, [
 *   { time: 2_000, temperature: 21 },
 * ]);
 * const combined = concatFrames(earlier, later);
 * Array.from(combined, (row) => row.temperature); // [20, 21]
 * ```
 */
export function concatFrames<S extends DataFrameSpec>(
  earlier: DataFrame<S>,
  later: DataFrame<S>,
): DataFrame<S> {
  assertCompatible(earlier, later);
  if (earlier.numRows === 0) return later;
  if (later.numRows === 0) return earlier;
  return createDataFrame<S>(earlier.toArrow().concat(later.toArrow()));
}
