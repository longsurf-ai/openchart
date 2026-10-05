// Purpose: One browser-safe Arrow IPC codec for Dataset, Feed, and Tea envelopes.
import { tableFromIPC, tableToIPC } from "apache-arrow";
import {
  Effect,
  Encoding,
  Result,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import {
  createDataFrame,
  isDataFrame,
  type CreateDataFrameOptions,
  type DataFrame,
} from "./dataFrame";

/**
 * The JSON carrier's shape: a string, rather than an array of row objects.
 *
 * This schema checks only that the value is a string. It does not check base64,
 * Arrow IPC or the frame's columns and timeline; use {@link dataFrameCodec} or
 * {@link parseJson} when accepting an untrusted frame.
 */
export const dataFrameJsonSchema = Schema.String;
/**
 * One frame serialized as Arrow IPC bytes and encoded as a base64 string.
 *
 * Transport code can carry this string in a JSON field without understanding
 * Arrow. It is not JSON text containing rows, nor proof that a string is valid
 * IPC. Decode it with {@link parseJson} or {@link dataFrameCodec}.
 */
export type DataFrameJson = string;

/**
 * Serialize a frame into a string suitable for a JSON envelope.
 *
 * The path is `DataFrame -> Arrow IPC bytes -> base64 string`. IPC is Arrow's
 * binary format for column definitions and values; base64 lets those bytes
 * travel in JSON. This preserves nested objects/lists, labels and field
 * metadata, and keeps `null` distinct from numeric `NaN`. Serializing rows
 * directly with `JSON.stringify` would instead turn NaN into null.
 *
 * This generic encoder trusts an existing frame and does not enforce a
 * producer's additional value rules. For those checks, use the codec returned
 * by `defineDataFrame`. The frame and its storage remain unchanged.
 *
 * @param frame - The frame to serialize.
 * @returns A base64 string to put in an envelope's data field.
 * @throws When Arrow cannot serialize the frame.
 *
 * @example
 * ```ts
 * import { fromPoints, parseJson, toJson } from "@openchart/timeseries";
 *
 * const frame = fromPoints({ room: "kitchen" }, [
 *   { time: 1_000, celsius: 21 },
 *   { time: 2_000, celsius: NaN },
 *   { time: 3_000, celsius: null },
 * ]);
 * const body = JSON.stringify({ data: toJson(frame) });
 * const envelope = JSON.parse(body);
 * const received = parseJson(envelope.data);
 * received.get(0)?.celsius; // 21
 * Number.isNaN(received.get(1)?.celsius); // true
 * received.get(2)?.celsius; // null
 * ```
 */
export function toJson(frame: DataFrame): DataFrameJson {
  return Encoding.encodeBase64(tableToIPC(frame.toArrow()));
}

/**
 * Decode one envelope field from base64 IPC into an independently owned frame.
 *
 * The path is `base64 string -> Arrow IPC bytes -> DataFrame`. Despite the name,
 * this function does not call `JSON.parse` on an HTTP body or a complete
 * envelope. Parse that JSON first and pass its frame field here.
 *
 * The decoder checks Arrow structure, labels and the common millisecond time
 * contract. Column schemas travel inside IPC, so nested columns are retained.
 * Producer-specific rules, such as a permitted temperature range, require the
 * codec returned by `defineDataFrame` instead. No cleanup is needed for the
 * returned in-memory frame.
 *
 * @param input - A base64 string produced by {@link toJson}.
 * @param options - Optional label or duplicate-time overrides; absent overrides
 * preserve the policy encoded in the frame's metadata.
 * @returns A checked frame with independently owned Arrow storage.
 * @throws When the input is not a string, base64/IPC is malformed, or the frame's
 * schema, labels, nullability or timeline violates the common frame contract.
 *
 * @example
 * ```ts
 * import { fromPoints, parseJson, toJson } from "@openchart/timeseries";
 *
 * const frame = fromPoints({ room: "kitchen" }, [
 *   { time: 1_000, celsius: 21 },
 * ]);
 * const body = JSON.stringify({ data: toJson(frame) });
 * const envelope = JSON.parse(body); // Parse the surrounding JSON first.
 * const received = parseJson(envelope.data); // Decode only the frame field.
 * received.labels.room; // "kitchen"
 * received.get(0)?.celsius; // 21
 * ```
 */
export function parseJson(
  input: unknown,
  options?: CreateDataFrameOptions,
): DataFrame {
  const encoded = Schema.decodeUnknownSync(dataFrameJsonSchema)(input);
  return createDataFrame(
    tableFromIPC(Result.getOrThrow(Encoding.decodeBase64(encoded))),
    options,
  );
}

/**
 * The shared Effect codec between an in-memory frame and its base64 IPC carrier.
 *
 * Embed this codec in an Effect envelope schema to use {@link parseJson} and
 * {@link toJson} automatically. Decoding enforces the common frame contract and
 * reports malformed input as a schema issue. Synchronous Effect helpers throw
 * for those issues. The codec accepts the column schema carried by IPC; it does
 * not add a producer's domain refinements. Use `defineDataFrame(...).codec` when
 * the receiver must enforce a declared set of scalar columns and value rules.
 *
 * @example
 * ```ts
 * import { Schema } from "effect";
 * import { dataFrameCodec, fromPoints } from "@openchart/timeseries";
 *
 * const Message = Schema.Struct({ data: dataFrameCodec });
 * const frame = fromPoints({ room: "kitchen" }, [
 *   { time: 1_000, celsius: 21 },
 * ]);
 * const wire = Schema.encodeSync(Message)({ data: frame });
 * const body = JSON.stringify(wire);
 * const received = Schema.decodeUnknownSync(Message)(JSON.parse(body));
 * typeof wire.data; // "string"
 * received.data.get(0)?.celsius; // 21
 * ```
 */
export const dataFrameCodec: Schema.Codec<DataFrame, DataFrameJson> =
  dataFrameJsonSchema.pipe(
    Schema.decodeTo(Schema.declare<DataFrame>(isDataFrame), {
      decode: SchemaGetter.transformOrFail((wire) =>
        Effect.try({
          try: () => parseJson(wire),
          catch: (cause) =>
            new SchemaIssue.InvalidValue(
              {
                expected:
                  cause instanceof Error
                    ? cause.message
                    : "valid Arrow DataFrame",
              },
              wire,
            ),
        }),
      ),
      encode: SchemaGetter.transform(toJson),
    }),
  );
