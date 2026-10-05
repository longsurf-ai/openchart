// Purpose: Infer scalar Arrow fields for convenient construction of point fixtures.
import {
  Bool,
  Field,
  Float64,
  Schema,
  TimestampMillisecond,
  Utf8,
} from "apache-arrow";
import {
  createDataFrame,
  tableFromRows,
  type CreateDataFrameOptions,
  type DataFrame,
  type Labels,
} from "./dataFrame";

/**
 * A value accepted by {@link fromPoints}: a number, text, boolean or explicit null.
 * Numbers may include NaN, which remains distinct from null in storage and transport.
 * Nested objects and lists require an explicit Arrow schema through {@link @openchart/timeseries#fromRows}.
 */
export type PointValue = number | string | boolean | null;
/**
 * One reading for {@link fromPoints}, with epoch-millisecond `time` and named values.
 * Different readings may omit different columns; the constructor fills those gaps.
 */
export type Point = { readonly time: number } & Readonly<
  Record<string, PointValue>
>;

/**
 * Build a frame of simple readings by inferring each column's type from its values.
 *
 * Numbers become Float64 columns, strings become Utf8, and booleans become Bool;
 * all inferred observation columns allow null. Each column needs at least one
 * non-null value to determine its type. An omitted numeric property becomes NaN;
 * other omitted properties become null. Explicit null stays null, rather than
 * becoming a numeric gap. NaN is itself a number and can establish a column's type.
 *
 * Input order is retained and validated, never sorted. Empty input produces a
 * frame with only its `time` column. Use {@link @openchart/timeseries#defineDataFrame} when empty or
 * all-null scalar columns need a declared type; use {@link @openchart/timeseries#fromRows} for an
 * existing Arrow schema with nested objects or lists.
 *
 * @param labels - Constant identity for all rows, such as a sensor name; copied into metadata.
 * @param points - Readings with safe-integer epoch-millisecond timestamps in ascending order.
 * @param options - Set `allowDuplicateTimes` for distinct events sharing a timestamp; `labels` above takes precedence.
 * @returns An independently owned frame; later changes to input rows cannot change it.
 * @throws If a column mixes types, has only null/missing values, or contains unsupported values.
 * @throws If labels or timestamps are invalid, or time order violates the selected policy.
 *
 * @example
 * ```ts
 * import { fromPoints } from "@openchart/timeseries";
 *
 * const readings = fromPoints({ sensor: "room" }, [
 *   { time: 1_000, temperature: 20, note: "window open" },
 *   { time: 2_000 },
 *   { time: 3_000, temperature: null },
 * ]);
 * Array.from(readings, (row) => row.temperature); // [20, NaN, null]
 * Array.from(readings, (row) => row.note); // ["window open", null, null]
 * readings.labels; // { sensor: "room" }
 * ```
 */
export function fromPoints(
  labels: Labels,
  points: readonly Point[],
  options?: CreateDataFrameOptions,
): DataFrame {
  if (points.some((point) => !Number.isSafeInteger(point.time)))
    throw new Error("DataFrame time must be safe integer epoch milliseconds");
  const names = new Set(
    points.flatMap((point) =>
      Object.keys(point).filter((name) => name !== "time"),
    ),
  );
  const fields: Field[] = [
    new Field("time", new TimestampMillisecond(), false),
  ];
  for (const name of names) {
    const kinds = new Set(
      points.flatMap((point) =>
        point[name] == null ? [] : [typeof point[name]],
      ),
    );
    if (kinds.size !== 1)
      throw new Error(
        `fromPoints: field "${name}" ${kinds.size ? "mixes scalar kinds" : "has no non-null values"}`,
      );
    const kind = [...kinds][0];
    const type =
      kind === "number"
        ? new Float64()
        : kind === "string"
          ? new Utf8()
          : kind === "boolean"
            ? new Bool()
            : undefined;
    if (!type) throw new Error(`fromPoints: unsupported field "${name}"`);
    fields.push(new Field(name, type, true));
  }
  const rows = points.map((point) =>
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        point[field.name] === undefined
          ? field.type instanceof Float64
            ? NaN
            : null
          : point[field.name],
      ]),
    ),
  );
  return createDataFrame(tableFromRows(new Schema(fields), rows), {
    ...options,
    labels,
  });
}
