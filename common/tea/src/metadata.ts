// Purpose: Preserve Tea parameter declarations and Arrow schemas on JSON transports.
import {
  Field,
  RecordBatchJSONWriter,
  RecordBatchReader,
  Schema as ArrowSchema,
  Table,
} from "apache-arrow";
import { Effect, Order, Schema, SchemaGetter, SchemaIssue } from "effect";

const scalar = Schema.NullOr(
  Schema.Union([Schema.Finite, Schema.Boolean, Schema.String]),
);
const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/** Tea-owned parameter metadata projected without executable runtime objects. */
export const Parameter = Schema.Struct({
  name: Schema.String,
  title: Schema.NullOr(Schema.String),
  type: Schema.Literals([
    "int",
    "float",
    "bool",
    "string",
    "color",
    "source",
    "enum",
  ]),
  control: Schema.String,
  defaultValue: scalar,
  /**
   * Present when the default depends on the chart the script runs on, such
   * as a range that follows the chart's interval, or the `timeframe` of an
   * `indicator(timeframe = "auto")` header, whose `""` lets the host pick the
   * bars. `defaultValue` is then the default without a chart, and a run binds
   * its own; leave such a parameter out to keep following the chart.
   */
  chartDefault: Schema.optionalKey(Schema.Literal(true)),
  value: Schema.optionalKey(scalar),
  active: Schema.NullOr(Schema.Boolean),
  constraints: Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("range"),
        minval: Schema.NullOr(Schema.Finite),
        maxval: Schema.NullOr(Schema.Finite),
        step: Schema.NullOr(Schema.Finite),
      }),
      Schema.Struct({
        kind: Schema.Literal("options"),
        options: Schema.Array(scalar),
      }),
    ]),
  ),
  enumType: Schema.NullOr(
    Schema.Struct({
      typeId: Schema.optionalKey(Schema.String),
      name: Schema.String,
      members: Schema.Array(
        Schema.Struct({ name: Schema.String, title: Schema.String }),
      ),
    }),
  ),
  group: Schema.NullOr(Schema.String),
  inline: Schema.NullOr(Schema.String),
  tooltip: Schema.NullOr(Schema.String),
  confirm: Schema.Boolean,
  display: Schema.Literals(["all", "none", "data_window", "status_line"]),
  seriesSid: Schema.NullOr(Schema.Int),
}).annotate(strict);
export type Parameter = typeof Parameter.Type;

/** What the entry script says it is, from its `indicator()` header. Tea owns
 * this projection; the header never changes how Tea runs the script.
 * `timeframe` names the bars it runs on: `""` the chart's, `"auto"` finer
 * bars of the same listing that the Tea service picks. */
export const Declaration = Schema.Struct({
  kind: Schema.Literal("indicator"),
  title: Schema.NonEmptyString,
  overlay: Schema.Boolean,
  timeframe: Schema.Literals(["", "auto"]),
}).annotate(strict);
export type Declaration = typeof Declaration.Type;

// Schema and field metadata as Arrow's JSON writes it: a list of key/value pairs.
const ArrowMetadataJson = Schema.Array(
  Schema.Struct({ key: Schema.String, value: Schema.String }).annotate(strict),
);

// The Arrow types that Tea and Feed schemas use, spelled as Arrow's JSON spells
// them. Arrow names a struct `struct_`. Every member has a single `name`, so a
// mistake in one type is reported against that type only.
const ArrowTypeJson = Schema.Union([
  ...(["bool", "utf8", "list", "struct_"] as const).map((name) =>
    Schema.Struct({ name: Schema.Literal(name) }).annotate(strict),
  ),
  Schema.Struct({
    name: Schema.Literal("int"),
    bitWidth: Schema.Literals([8, 16, 32, 64]),
    isSigned: Schema.Boolean,
  }).annotate(strict),
  Schema.Struct({
    name: Schema.Literal("floatingpoint"),
    precision: Schema.Literals(["HALF", "SINGLE", "DOUBLE"]),
  }).annotate(strict),
  Schema.Struct({
    name: Schema.Literal("timestamp"),
    unit: Schema.Literals([
      "SECOND",
      "MILLISECOND",
      "MICROSECOND",
      "NANOSECOND",
    ]),
    timezone: Schema.optionalKey(Schema.String),
  }).annotate(strict),
  Schema.Struct({
    name: Schema.Literal("map"),
    keysSorted: Schema.Boolean,
  }).annotate(strict),
]);

// One Arrow field as JSON, written out by hand because a field contains fields
// (through `children`). The JSON shapes here are `type`s, not `interface`s, so
// they pass where `Schema.Json` is expected, such as a stored Resource.
type ArrowFieldJson = {
  readonly name: string;
  readonly nullable: boolean;
  readonly type: typeof ArrowTypeJson.Type;
  readonly children: readonly ArrowFieldJson[];
  readonly metadata?: typeof ArrowMetadataJson.Type;
};

// Arrow's reader doesn't check children, and a wrong count decodes into a
// schema that breaks later: Arrow's own writer, `toString` and map getters
// throw on it.
const hasValidChildren = ({ type, children }: ArrowFieldJson) => {
  switch (type.name) {
    case "struct_":
      return true;
    case "list":
      return children.length === 1;
    case "map": // one `entries` struct with a key and a value
      return (
        children.length === 1 &&
        children[0]!.type.name === "struct_" &&
        children[0]!.children.length === 2
      );
    default:
      return children.length === 0;
  }
};

const ArrowFieldJson: Schema.Codec<ArrowFieldJson> = Schema.Struct({
  name: Schema.String,
  nullable: Schema.Boolean,
  type: ArrowTypeJson,
  children: Schema.Array(
    Schema.suspend((): Schema.Codec<ArrowFieldJson> => ArrowFieldJson),
  ),
  metadata: Schema.optionalKey(ArrowMetadataJson),
})
  // Annotated before the check: `Schema.toEncoded`, which agent tools use for
  // their JSON Schema, drops checks on a recursive struct, and with them any
  // annotations added after the check.
  .annotate({ ...strict, identifier: "ArrowFieldJson" })
  .check(
    Schema.makeFilter(hasValidChildren, {
      message:
        "A list field has one child, a map field has one struct_ child with a key and a value, a struct_ field has one child per member, and other fields have none",
    }),
  );

// Arrow's JSON writer drops all metadata. These put it back on the schema and
// every nested field, leaving it out when empty. Arrow ignores entry order, so
// entries are sorted by key: the same entries always encode the same way.
const metadataJson = (metadata: ReadonlyMap<string, string>) =>
  metadata.size === 0
    ? {}
    : {
        metadata: [...metadata]
          .sort(([a], [b]) => Order.String(a, b))
          .map(([key, value]) => ({ key, value })),
      };
const withMetadata = (field: Field, json: ArrowFieldJson): ArrowFieldJson => ({
  ...json,
  // The writer builds `children` from `field.type.children`, in the same order.
  children: json.children.map((child, index) =>
    withMetadata(field.type.children[index]!, child),
  ),
  ...metadataJson(field.metadata),
});

/**
 * An Arrow schema as Arrow's own JSON form, so schemas travel and are stored
 * as readable JSON instead of binary.
 *
 * Decoding checks the JSON strictly first, because Arrow's reader checks almost
 * nothing (given `{schema: "nope"}` it returns no schema and no error). An
 * unknown type, a missing or extra key, or a wrong number of children (a list
 * without its child, a map without its key and value) fails as a schema issue.
 * Only `floatingpoint`, `int`, `bool`, `utf8`, `timestamp`, `list`, `struct_`
 * and `map` are accepted. `Schema.toEncoded` keeps every rule except the
 * number of children. Decoding builds new Arrow objects.
 *
 * Encoding writes one canonical form: equal schemas encode to equal JSON, keys
 * in the same order, so compare schemas by their encoded JSON, never as Arrow
 * objects. It adds back the metadata Arrow's writer drops, on the schema and
 * every field, sorted by key and only when not empty.
 *
 * @example
 * Schema.encodeSync(ArrowSchemaJson)(new ArrowSchema([new Field("close", new Float64(), true)]));
 * // { fields: [{ name: "close", nullable: true, type: { name: "floatingpoint", precision: "DOUBLE" }, children: [] }] }
 */
export const ArrowSchemaJson = Schema.Struct({
  fields: Schema.Array(ArrowFieldJson),
  metadata: Schema.optionalKey(ArrowMetadataJson),
})
  .annotate(strict)
  .pipe(
    Schema.decodeTo(Schema.instanceOf(ArrowSchema), {
      decode: SchemaGetter.transformOrFail((json) =>
        Effect.try({
          try: () => RecordBatchReader.from({ schema: json }).open().schema,
          catch: () =>
            new SchemaIssue.InvalidValue(
              { expected: "Arrow JSON schema" },
              json,
            ),
        }),
      ),
      encode: SchemaGetter.transform((schema) => {
        const json = JSON.parse(
          RecordBatchJSONWriter.writeAll(new Table(schema)).toString(true),
          // A timestamp without a timezone has `timezone: null` or no
          // timezone at all, depending on where the schema came from.
          // Write both the same way: no key.
          (key, value: unknown) =>
            key === "timezone" && value === null ? undefined : value,
        ) as { readonly schema: { readonly fields: ArrowFieldJson[] } };
        return {
          fields: json.schema.fields.map((field, index) =>
            withMetadata(schema.fields[index]!, field),
          ),
          ...metadataJson(schema.metadata),
        };
      }),
    }),
  );

/** An Arrow schema in Arrow's JSON form, which {@link ArrowSchemaJson} reads and writes. */
export type ArrowSchemaJsonEncoded = typeof ArrowSchemaJson.Encoded;

/**
 * What a compiled script needs and what it produces. Nothing else.
 *
 * - `parameters`: the knobs a user can turn, such as `length = input.int(14)`.
 * - `inputs`: the columns the script reads on every bar, such as `close`.
 *   These are read with default parameters. An `input.source` parameter can
 *   add a column once the user picks another source.
 * - `outputs`: the columns the script writes with `emit` or `plot`.
 * - `requests`: one child script per `request.security(...)` line, keyed by
 *   the variable name on the left. Each child has its own Definition, plus
 *   the `target` the line asks for with default parameters: a ticker id such
 *   as `binance:ETHUSDT` and a timeframe such as `"D"` (`""` is the script's
 *   own). It is null when the target depends on the market the script runs
 *   on, as `syminfo.tickerid` does.
 *
 * A Definition says nothing about where the input data comes from, who reads
 * the outputs, or how scripts connect to each other. That is `NodeConfig`'s
 * job.
 */
export interface Definition {
  readonly parameters: readonly Parameter[];
  readonly inputs: ArrowSchema;
  readonly outputs: ArrowSchema;
  readonly requests: Readonly<
    Record<string, Definition & typeof RequestTarget.Type>
  >;
}

/** {@link Definition} as JSON: the Arrow schemas use Arrow's JSON form. */
export type DefinitionEncoded = {
  readonly parameters: readonly Parameter[];
  readonly inputs: ArrowSchemaJsonEncoded;
  readonly outputs: ArrowSchemaJsonEncoded;
  readonly requests: Readonly<
    Record<string, DefinitionEncoded & typeof RequestTarget.Type>
  >;
};

// What a request.security line asks for, as Tea reads it from the script.
const RequestTarget = Schema.Struct({
  target: Schema.NullOr(
    Schema.Struct({ symbol: Schema.String, timeframe: Schema.String }),
  ),
});

/** Converts a {@link Definition} to JSON and back. */
export const Definition = Schema.Struct({
  parameters: Schema.Array(Parameter),
  inputs: ArrowSchemaJson,
  outputs: ArrowSchemaJson,
  requests: Schema.Record(
    Schema.String,
    Schema.suspend(
      (): Schema.Codec<
        Definition & typeof RequestTarget.Type,
        DefinitionEncoded & typeof RequestTarget.Type
      > => RequestDefinition,
    ),
  ),
}).annotate(strict);

// A request child: its own Definition and what its request.security line asks for.
const RequestDefinition = Schema.Struct({
  ...Definition.fields,
  ...RequestTarget.fields,
}).annotate(strict);
