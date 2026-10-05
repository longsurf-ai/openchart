// Purpose: Canonical Arrow-backed timeseries representation and shared codecs.
/**
 * Store and transport measurements that share an ordered millisecond time column.
 *
 * A {@link DataFrame} owns one private Apache Arrow table. Read ordinary row
 * copies with `get()` or iteration. Nested objects, lists, nulls and NaN values
 * keep their meaning when a frame is encoded and decoded.
 *
 * Choose the constructor that matches what you have:
 *
 * - {@link fromPoints} infers simple number/string/boolean columns from example rows.
 * - {@link defineDataFrame} checks scalar rows against an Effect schema declaration.
 * - {@link fromRows} uses a producer's existing Arrow schema, including nested columns.
 * - {@link createDataFrame} copies an existing Arrow table into a checked frame.
 *
 * The shared transport path is `DataFrame -> Arrow IPC bytes -> base64 string`.
 * IPC is Arrow's binary format for carrying column types, metadata and values.
 * {@link toJson} returns that string for use in a JSON message; {@link parseJson}
 * decodes it. Neither function serializes or parses the surrounding message.
 * {@link dataFrameCodec} embeds the same conversion in Effect schemas.
 *
 * @example
 * ```ts
 * import { fromPoints, parseJson, toJson } from "@openchart/timeseries";
 *
 * const readings = fromPoints({ sensor: "kitchen" }, [
 *   { time: 0, temperature: 21 },
 *   { time: 1000, temperature: 22 },
 * ]);
 * const wire = toJson(readings); // A base64 string suitable for a JSON field.
 * const received = parseJson(wire);
 * received.labels.sensor; // "kitchen"
 * received.get(1)?.temperature; // 22
 * ```
 *
 * @packageDocumentation
 */
export { createDataFrame, fromRows, symbols } from "./dataFrame";
export { CountRange, Range, TimeRange } from "./timeRange";
export type {
  CreateDataFrameOptions,
  FieldSchema,
  DataFrame,
  DataFrameRow,
  DataFrameSpec,
  Labels,
  Ms,
} from "./dataFrame";
export {
  defineDataFrame,
  hasColumns,
  schemaHasColumns,
} from "./defineDataFrame";
export type { DataFrameKind, DataFrameRows } from "./defineDataFrame";
export { dataFrameJsonSchema, dataFrameCodec, parseJson, toJson } from "./json";
export type { DataFrameJson } from "./json";
export { takeRows, concatFrames } from "./rows";
export { mergeByTime, joinByTime } from "./join";
export { fromPoints } from "./fromPoints";
export type { Point, PointValue } from "./fromPoints";
