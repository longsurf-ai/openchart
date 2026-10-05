// Purpose: Derive scalar Arrow layout and a refined IPC codec from one declaration.
import {
  Bool,
  Field,
  Float64,
  Schema as ArrowSchema,
  Table,
  TimestampMillisecond,
  Utf8,
  tableFromIPC,
  tableToIPC,
  util,
} from "apache-arrow";
import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import {
  createDataFrame,
  isDataFrame,
  tableFromRows,
  type CreateDataFrameOptions,
  type DataFrame,
  type DataFrameSpec,
  type FieldSchema,
  type Labels,
} from "./dataFrame";
import {
  dataFrameJsonSchema,
  parseJson,
  toJson,
  type DataFrameJson,
} from "./json";

/**
 * Input rows for a declared set of number, string and boolean columns.
 *
 * Each row supplies `time` in epoch milliseconds and every declared column.
 * `null` means a missing cell and is allowed for every observation column;
 * numeric `NaN` is a separate gap value. Neither is allowed for `time`.
 */
export type DataFrameRows<S extends DataFrameSpec> = readonly ({
  readonly time: number;
} & { readonly [K in keyof S]: S[K]["Type"] | null })[];

/**
 * A frame constructor and transport codec derived from one scalar declaration.
 *
 * Use the same kind on the sender and receiver to check both the column layout
 * and value rules, such as a temperature limit. Its wire value is the same
 * base64 Arrow IPC string used by the generic
 * {@link @openchart/timeseries#dataFrameCodec}.
 */
export interface DataFrameKind<S extends DataFrameSpec> {
  /** The supplied observation schemas, excluding the separately declared `time`. */
  readonly spec: S;
  /**
   * An Effect codec that checks this declaration in both directions.
   *
   * Decoding checks the common frame contract, expected columns and value
   * refinements. Encoding checks the declaration before writing IPC. Failures
   * become Effect schema issues; synchronous Effect decode/encode helpers throw.
   * `null` cells and numeric `NaN` gaps are accepted as described by
   * {@link defineDataFrame}, even when an observation schema excludes them.
   *
   * @example
   * ```ts
   * import { Schema } from "effect";
   * import { defineDataFrame } from "@openchart/timeseries";
   *
   * const Temperatures = defineDataFrame({ celsius: Schema.Finite });
   * const Message = Schema.Struct({ data: Temperatures.codec });
   * const frame = Temperatures.create({
   *   labels: { room: "kitchen" },
   *   rows: [{ time: 1_000, celsius: 21 }],
   * });
   * const wire = Schema.encodeSync(Message)({ data: frame });
   * const received = Schema.decodeUnknownSync(Message)(wire);
   * received.data.get(0)?.celsius; // 21
   * typeof wire.data; // "string"
   * ```
   */
  readonly codec: Schema.Codec<DataFrame<S>, DataFrameJson>;
  /**
   * Validate scalar rows and copy them into an independently owned frame.
   *
   * Every row must have exactly the declared columns plus `time`. Empty input
   * retains the declared schema. Later changes to the supplied rows or labels
   * do not change the returned frame.
   *
   * @param input - Labels shared by all rows, and rows in ascending time order.
   * @param options - Timeline options; `input.labels` takes precedence over
   * `options.labels`. Duplicate times require `allowDuplicateTimes: true`.
   * @returns A frame whose row types come from this declaration.
   * @throws When row fields, non-gap values, labels or the timeline are invalid.
   *
   * @example
   * ```ts
   * import { Schema } from "effect";
   * import { defineDataFrame } from "@openchart/timeseries";
   *
   * const Temperatures = defineDataFrame({ celsius: Schema.Finite });
   * const frame = Temperatures.create({
   *   labels: { room: "kitchen" },
   *   rows: [{ time: 1_000, celsius: 21 }],
   * });
   * frame.get(0)?.celsius; // 21
   * frame.labels.room; // "kitchen"
   * ```
   */
  readonly create: (
    input: { readonly labels: Labels; readonly rows: DataFrameRows<S> },
    options?: CreateDataFrameOptions,
  ) => DataFrame<S>;
  /**
   * Decode one base64 IPC value and check it against this declaration.
   *
   * Checks column order, names, Arrow types and nullability, then checks each
   * row's declared value rules. This parses the envelope's data field, not a
   * complete JSON document. The returned frame owns its storage.
   *
   * @param input - The base64 string produced by `toJson`.
   * @param options - Optional label or duplicate-time overrides; by default,
   * both are read from the encoded frame's metadata.
   * @returns A decoded frame with this declaration's typed rows.
   * @throws When the carrier, IPC, common frame contract, columns or non-gap
   * values are invalid.
   *
   * @example
   * ```ts
   * import { Schema } from "effect";
   * import { defineDataFrame } from "@openchart/timeseries";
   *
   * const Temperatures = defineDataFrame({ celsius: Schema.Finite });
   * const frame = Temperatures.create({
   *   labels: {},
   *   rows: [{ time: 1_000, celsius: 21 }],
   * });
   * const received = Temperatures.parseJson(Temperatures.toJson(frame));
   * received.get(0)?.celsius; // 21
   * ```
   */
  readonly parseJson: (
    input: unknown,
    options?: CreateDataFrameOptions,
  ) => DataFrame<S>;
  /**
   * Check this declaration and encode the frame as a base64 IPC string.
   *
   * The string can be placed in a JSON envelope. Arrow stores missing cells,
   * numeric NaN gaps and metadata without converting them to JSON row values.
   * The supplied frame is unchanged.
   *
   * @param frame - A frame with this declaration's columns and value rules.
   * @returns A JSON-safe string, not a complete JSON document.
   * @throws When the columns or non-gap values do not match this declaration,
   * or Arrow cannot serialize the frame.
   *
   * @example
   * ```ts
   * import { Schema } from "effect";
   * import { defineDataFrame } from "@openchart/timeseries";
   *
   * const Temperatures = defineDataFrame({ celsius: Schema.Finite });
   * const frame = Temperatures.create({
   *   labels: {},
   *   rows: [{ time: 1_000, celsius: 21 }],
   * });
   * const wire = Temperatures.toJson(frame);
   * typeof wire; // "string"
   * Temperatures.parseJson(wire).numRows; // 1
   * ```
   */
  readonly toJson: (frame: DataFrame<S>) => DataFrameJson;
}

/** The one scalar-declaration-to-Arrow mapping shared by construction and column checks. */
function arrowType(name: string, schema: FieldSchema) {
  const kind = schema.ast._tag;
  if (kind === "Number") return new Float64();
  if (kind === "String") return new Utf8();
  if (kind === "Boolean") return new Bool();
  throw new Error(`Unsupported DataFrame field "${name}": ${kind}`);
}

/**
 * Whether a frame carries at least the declared columns with their Arrow types.
 *
 * Unlike a {@link DataFrameKind} codec, other columns may exist beside them and
 * column order is free; cell values are not inspected. Use it where a consumer
 * needs a minimum vocabulary from producers that keep their own extra columns.
 *
 * @param frame - Any frame, typically decoded with the generic codec.
 * @param spec - The required scalar columns, excluding `time`.
 * @returns True, narrowing the frame's row type, when every column is present.
 * @throws When `spec` declares a field that is not a number, string or boolean.
 *
 * @example
 * ```ts
 * import { Schema } from "effect";
 * import { fromPoints, hasColumns } from "@openchart/timeseries";
 *
 * const frame = fromPoints({}, [{ time: 0, close: 10, trades: 3 }]);
 * if (hasColumns(frame, { close: Schema.Finite })) frame.get(0)?.close; // 10
 * hasColumns(frame, { volume: Schema.Finite }); // false
 * ```
 */
export function hasColumns<S extends DataFrameSpec>(
  frame: DataFrame,
  spec: S,
): frame is DataFrame<S> {
  return schemaHasColumns(frame.schema, spec);
}

/**
 * Whether an Arrow schema declares at least these columns with their Arrow types,
 * the schema-only form of {@link hasColumns}, for consumers that receive a schema
 * before any rows.
 *
 * @param schema - Any Arrow schema; extra columns and column order are ignored.
 * @param spec - The required scalar columns, excluding `time`.
 * @returns True when every column is present with its declared type.
 * @throws When `spec` declares a field that is not a number, string or boolean.
 *
 * @example
 * ```ts
 * import { Field, Float64, Schema as ArrowSchema } from "apache-arrow";
 * import { Schema } from "effect";
 * import { schemaHasColumns } from "@openchart/timeseries";
 *
 * const schema = new ArrowSchema([new Field("close", new Float64(), true)]);
 * schemaHasColumns(schema, { close: Schema.Finite }); // true
 * schemaHasColumns(schema, { volume: Schema.Finite }); // false
 * ```
 */
export function schemaHasColumns(
  schema: ArrowSchema,
  spec: DataFrameSpec,
): boolean {
  return Object.entries(spec).every(([name, field]) => {
    const expected = arrowType(name, field).typeId;
    return schema.fields.some(
      (column) => column.name === name && column.type.typeId === expected,
    );
  });
}

/**
 * Define scalar columns once for construction, typed access and wire validation.
 *
 * Number, string and boolean schemas become Arrow Float64, Utf8 and Bool columns.
 * Each observation column allows `null`; numeric columns also allow `NaN`.
 * These missing/gap values bypass the observation's value checks. All other
 * values must pass its Effect schema, including refinements such as a minimum
 * temperature. For example, `Schema.Finite` rejects infinity but still permits
 * the explicit NaN gap. `time` has no such exemption and must always be safe
 * integer epoch milliseconds.
 *
 * This declaration supplies an empty frame's columns without inferring them
 * from rows. Producers that already have an Arrow schema, including nested
 * objects or lists, use {@link createDataFrame} instead.
 *
 * @param spec - Observation schemas, excluding the reserved `time` column.
 * Supported declarations have a Number, String or Boolean schema root;
 * refinements of those schemas are retained.
 * @param time - An optional additional time constraint; defaults to `Schema.Int`.
 * @returns A constructor and codecs sharing one column declaration. No DataFrame
 * is allocated until a constructor or decoder is called.
 * @throws When `spec` redeclares `time` or contains an unsupported schema.
 *
 * @example
 * ```ts
 * import { Schema } from "effect";
 * import { defineDataFrame } from "@openchart/timeseries";
 *
 * const Temperatures = defineDataFrame({
 *   celsius: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(-273.15)),
 * });
 * const frame = Temperatures.create({
 *   labels: { room: "kitchen" },
 *   rows: [
 *     { time: 1_000, celsius: 21 },
 *     { time: 2_000, celsius: null }, // Missing reading.
 *     { time: 3_000, celsius: NaN }, // Numeric gap, distinct from null.
 *   ],
 * });
 * const received = Temperatures.parseJson(Temperatures.toJson(frame));
 * received.get(0)?.celsius; // 21
 * received.get(1)?.celsius; // null
 * Number.isNaN(received.get(2)?.celsius); // true
 * // A reading of -300 would fail the declared minimum on creation or decoding.
 * ```
 */
export function defineDataFrame<S extends DataFrameSpec>(
  spec: S,
  time: Schema.Codec<number, number> = Schema.Int,
): DataFrameKind<S> {
  if ("time" in spec) throw new Error("DataFrame spec must not redeclare time");
  const rowFields: Record<string, Schema.Codec<unknown>> = { time };
  const fields: Field[] = [
    new Field("time", new TimestampMillisecond(), false),
  ];
  for (const [name, schema] of Object.entries(spec)) {
    const kind = schema.ast._tag;
    fields.push(new Field(name, arrowType(name, schema), true));
    // Missing cells and numeric gaps are part of the frame contract even when
    // the producer's scalar declaration (for example Schema.Finite) excludes them.
    rowFields[name] =
      kind === "Number"
        ? Schema.Union([
            Schema.Null,
            Schema.Number.check(Schema.makeFilter(Number.isNaN)),
            schema,
          ])
        : Schema.NullOr(schema);
  }
  // IPC decoding reconstructs Float64/TimestampMillisecond as the base Arrow
  // Float/Timestamp classes. Arrow's schema comparator checks constructors, so
  // normalize this expected schema the same way as a published/decoded frame.
  const arrowSchema = tableFromIPC(
    tableToIPC(new Table(new ArrowSchema(fields))),
  ).schema;
  const decodeRows = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct(rowFields).annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
    ),
  );
  const validate = (frame: DataFrame): DataFrame<S> => {
    if (!util.compareSchemas(arrowSchema, frame.schema))
      throw new Error("DataFrame columns do not match the declaration");
    decodeRows(Array.from(frame));
    return frame as DataFrame<S>;
  };
  const decode = (input: unknown, options?: CreateDataFrameOptions) =>
    validate(parseJson(input, options));
  const encode = (frame: DataFrame<S>) => toJson(validate(frame));
  const codec = dataFrameJsonSchema.pipe(
    Schema.decodeTo(
      Schema.declare<DataFrame<S>>((value): value is DataFrame<S> =>
        isDataFrame(value),
      ),
      {
        decode: SchemaGetter.transformOrFail((wire) =>
          Effect.try({
            try: () => decode(wire),
            catch: (cause) =>
              new SchemaIssue.InvalidValue(
                {
                  expected:
                    cause instanceof Error
                      ? cause.message
                      : "valid declared DataFrame",
                },
                wire,
              ),
          }),
        ),
        encode: SchemaGetter.transformOrFail((frame) =>
          Effect.try({
            try: () => encode(frame),
            catch: (cause) =>
              new SchemaIssue.InvalidValue(
                {
                  expected:
                    cause instanceof Error
                      ? cause.message
                      : "valid declared DataFrame",
                },
                frame,
              ),
          }),
        ),
      },
    ),
  );
  return {
    spec,
    codec,
    create: ({ labels, rows }, options) => {
      const checked = decodeRows(rows);
      if (checked.some((row) => !Number.isSafeInteger(row.time)))
        throw new Error(
          "DataFrame time must be safe integer epoch milliseconds",
        );
      return createDataFrame<S>(tableFromRows(arrowSchema, checked), {
        ...options,
        labels,
      });
    },
    parseJson: decode,
    toJson: encode,
  };
}
