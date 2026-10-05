// Purpose: Arrow JSON schemas keep every level of metadata, encode one canonical form and reject malformed JSON as schema issues.
import {
  Field,
  Float64,
  List,
  Map_,
  Schema as ArrowSchema,
  Struct,
  Table,
  TimestampMillisecond,
  Uint8,
  Utf8,
  tableFromIPC,
  tableToIPC,
} from "apache-arrow";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";
import { ArrowSchemaJson } from "./metadata";

const encode = Schema.encodeSync(ArrowSchemaJson);
const decode = Schema.decodeUnknownSync(ArrowSchemaJson);
const metadata = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));

it("round trips schema metadata and metadata on nested struct, list and map fields", () => {
  const schema = new ArrowSchema(
    [
      new Field(
        "basis",
        new Struct([
          new Field("series", new Float64(), false, metadata({ child: "1" })),
        ]),
        true,
        metadata({ "tea:write": "set", "tea:typeId": "visual.Plot" }),
      ),
      new Field(
        "cross",
        new List(
          new Field(
            "item",
            new Struct([new Field("title", new Utf8(), true)]),
            true,
            metadata({ "tea:typeId": "visual.Alert" }),
          ),
        ),
        true,
        metadata({ "tea:write": "append" }),
      ),
      new Field(
        "lookup",
        new Map_(
          new Field(
            "entries",
            new Struct<{ key: Utf8; value: Uint8 }>([
              new Field("key", new Utf8(), false, metadata({ key: "2" })),
              new Field("value", new Uint8(), true, metadata({ value: "3" })),
            ]),
            false,
            metadata({ entries: "4" }),
          ),
        ),
        true,
      ),
    ],
    metadata({ module: "main" }),
  );
  const decoded = decode(JSON.parse(JSON.stringify(encode(schema))));
  const [basis, cross, lookup] = decoded.fields;
  const entries = lookup!.type.children[0]!;
  expect(decoded.metadata.get("module")).toBe("main");
  expect(basis!.metadata.get("tea:typeId")).toBe("visual.Plot");
  expect(basis!.type.children[0]!.metadata.get("child")).toBe("1");
  expect(cross!.metadata.get("tea:write")).toBe("append");
  expect((cross!.type as List).valueField.metadata.get("tea:typeId")).toBe(
    "visual.Alert",
  );
  expect(entries.metadata.get("entries")).toBe("4");
  expect(entries.type.children[0]!.metadata.get("key")).toBe("2");
  expect(entries.type.children[1]!.metadata.get("value")).toBe("3");

  // Decoding builds new Arrow objects.
  basis!.metadata.set("tea:typeId", "changed");
  expect(schema.fields[0]!.metadata.get("tea:typeId")).toBe("visual.Plot");
});

it("encodes one canonical form that decodes and encodes back to itself", () => {
  const double = { name: "floatingpoint", precision: "DOUBLE" };
  const canonical = {
    fields: [
      {
        name: "time",
        nullable: true,
        type: { name: "timestamp", unit: "MILLISECOND" },
        children: [],
      },
      {
        name: "zoned",
        nullable: false,
        type: { name: "timestamp", unit: "SECOND", timezone: "UTC" },
        children: [],
      },
      {
        name: "red",
        nullable: false,
        type: { name: "int", bitWidth: 8, isSigned: false },
        children: [],
        metadata: [{ key: "tea:type", value: "int" }],
      },
      {
        name: "basis",
        nullable: true,
        type: { name: "struct_" },
        children: [
          { name: "series", nullable: false, type: double, children: [] },
          {
            name: "visible",
            nullable: false,
            type: { name: "bool" },
            children: [],
          },
        ],
        metadata: [
          { key: "tea:typeId", value: "visual.Plot" },
          { key: "tea:write", value: "set" },
        ],
      },
      {
        name: "cross",
        nullable: true,
        type: { name: "list" },
        children: [
          {
            name: "item",
            nullable: true,
            type: { name: "utf8" },
            children: [],
            metadata: [{ key: "tea:type", value: "string" }],
          },
        ],
      },
      {
        name: "lookup",
        nullable: true,
        type: { name: "map", keysSorted: false },
        children: [
          {
            name: "entries",
            nullable: false,
            type: { name: "struct_" },
            children: [
              {
                name: "key",
                nullable: false,
                type: { name: "utf8" },
                children: [],
              },
              { name: "value", nullable: true, type: double, children: [] },
            ],
          },
        ],
      },
    ],
    metadata: [{ key: "module", value: "main" }],
  };
  const encoded = encode(decode(canonical));
  expect(encoded).toEqual(canonical);
  // Callers compare encoded JSON as text, so the key order is fixed too.
  expect(JSON.stringify(encoded)).toBe(JSON.stringify(canonical));
});

it("writes the same metadata the same way in whatever order it was added", () => {
  const plot = (entries: [string, string][]) =>
    encode(
      new ArrowSchema([
        new Field("basis", new Float64(), true, new Map(entries)),
      ]),
    );
  expect(
    plot([
      ["tea:write", "set"],
      ["tea:typeId", "visual.Plot"],
    ]),
  ).toEqual(
    plot([
      ["tea:typeId", "visual.Plot"],
      ["tea:write", "set"],
    ]),
  );
});

it("writes a timestamp without a timezone the same way wherever its schema came from", () => {
  const schema = new ArrowSchema([
    new Field("time", new TimestampMillisecond(), true),
  ]);
  // Arrow's IPC reader gives `timezone: null`; a new type has none at all.
  const fromIpc = tableFromIPC(tableToIPC(new Table(schema))).schema;
  expect(encode(fromIpc)).toEqual(encode(schema));
  expect(encode(schema).fields[0]!.type).toEqual({
    name: "timestamp",
    unit: "MILLISECOND",
  });
});

it("rejects malformed Arrow JSON as a schema issue, never a thrown defect", () => {
  const close = {
    name: "close",
    nullable: true,
    type: { name: "floatingpoint", precision: "DOUBLE" },
    children: [],
  };
  const map = (entries: object) => ({
    fields: [
      {
        ...close,
        type: { name: "map", keysSorted: false },
        children: [entries],
      },
    ],
  });
  for (const input of [
    "nope",
    { schema: "nope" }, // Arrow's own reader accepts this without an error
    { fields: "nope" },
    { fields: [{ ...close, type: { name: "bogus" } }] },
    { fields: [{ ...close, type: { name: "struct" } }] }, // Arrow writes struct_
    { fields: [{ ...close, type: { name: "floatingpoint" } }] },
    { fields: [{ ...close, type: { name: "floatingpoint", precision: "x" } }] },
    { fields: [{ ...close, type: { ...close.type, bitWidth: 64 } }] },
    { fields: [{ name: "close", type: close.type, children: [] }] },
    { fields: [{ name: "close", nullable: true, type: close.type }] },
    { fields: [{ ...close, customMetadata: [] }] },
    { fields: [{ ...close, metadata: [{ key: "source" }] }] },
    { fields: [close], extra: true },
    { fields: [{ ...close, type: { name: "list" } }] }, // a list needs its child
    { fields: [{ ...close, children: [close] }] }, // a number has no children
    map({ ...close, type: { name: "utf8" } }), // entries must be a struct_
    map({ ...close, type: { name: "struct_" }, children: [close] }), // a key but no value
    {
      fields: [
        {
          ...close,
          type: { name: "list" },
          children: [{ ...close, nullable: "yes" }],
        },
      ],
    },
  ])
    expect(
      Result.isFailure(Schema.decodeUnknownResult(ArrowSchemaJson)(input)),
    ).toBe(true);
});

it("reports a mistake in a type against that type only", () => {
  const result = Schema.decodeUnknownResult(ArrowSchemaJson)({
    fields: [
      {
        name: "volume",
        nullable: true,
        type: { name: "int", bitWidth: 64 },
        children: [],
      },
    ],
  });
  const message = Result.isFailure(result) ? String(result.failure) : "";
  expect(message).toContain("isSigned");
  expect(message).not.toContain("bitWidth"); // a valid key of int
});

it("shows agents the field structure, under its own name", () => {
  // Agent tools build their JSON Schema from the encoded side.
  const { definitions } = Schema.toJsonSchemaDocument(
    Schema.toEncoded(ArrowSchemaJson),
  );
  expect(definitions).toHaveProperty("ArrowFieldJson.properties.children");
  expect(definitions).toHaveProperty("ArrowFieldJson.properties.type.anyOf");
});
