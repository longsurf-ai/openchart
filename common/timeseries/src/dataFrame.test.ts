// Purpose: Validate timelines and isolate every published Arrow-backed value.
import {
  Binary,
  Field,
  Float64,
  Schema as ArrowSchema,
  Struct,
  Table,
  TimestampMillisecond,
  vectorFromArray,
} from "apache-arrow";
import { expect, test } from "vitest";
import { createDataFrame, fromRows, symbols, tableFromRows } from "./dataFrame";
import { fromPoints } from "./fromPoints";
import { structuredRows, structuredTable } from "./testFrames";

test("Arrow is the only backing store; nested rows and metadata retain their meaning", () => {
  const frame = createDataFrame(structuredTable(), {
    labels: { symbol: "AAPL" },
  });
  expect(frame._dataFrame).toBe(symbols.dataFrame);
  expect(frame.numRows).toBe(3);
  expect(Array.from(frame)).toEqual(structuredRows);
  expect(frame.schema.fields[2]!.metadata.get("tea:write")).toBe("append");
  expect(
    frame.schema.fields[2]!.type.children[0]!.type.children[1]!.metadata.get(
      "style",
    ),
  ).toBe("caption");
  expect(frame.schema.metadata.get("source")).toBe("tea");
  expect(frame.labels).toEqual({ symbol: "AAPL" });
  expect(frame.get(-1)).toBeNull();
  expect(frame.get(3)).toBeNull();
});

test("input and exported table, schema, buffers, labels and nested rows cannot mutate publication", () => {
  const source = structuredTable();
  const labels = { symbol: "AAPL" };
  const frame = createDataFrame(source, { labels });
  source.getChild("value")!.set(2, 99);
  source.schema.fields[2]!.metadata.set("tea:write", "changed");
  labels.symbol = "OTHER";
  const output = frame.toArrow();
  output.getChild("value")!.set(2, 123);
  output.getChild("events")!.get(0).get(0).text = "changed";
  output.schema.metadata.set("source", "changed");
  frame.schema.fields[2]!.metadata.set("tea:write", "changed");
  expect(Reflect.set(frame.labels, "symbol", "changed")).toBe(false);
  const row = frame.get(0)!;
  expect(Reflect.set(row, "value", 42)).toBe(false);
  const events = row.events as readonly {
    readonly time: number;
    readonly text: string;
  }[];
  expect(Reflect.set(events[0]!, "text", "changed")).toBe(false);
  expect(Reflect.set(events, "length", 0)).toBe(false);
  expect(Array.from(frame)).toEqual(structuredRows);
  expect(frame.labels).toEqual({ symbol: "AAPL" });
  expect(frame.schema.metadata.get("source")).toBe("tea");
  expect(frame.schema.fields[2]!.metadata.get("tea:write")).toBe("append");
});

test("column reads one column's frozen values in row order", () => {
  const frame = createDataFrame(structuredTable());
  expect(frame.column("time")).toEqual([10, 20, 30]);
  expect(frame.column("value")).toEqual([null, NaN, 3]);
  const events = frame.column("events");
  expect(events).toEqual(structuredRows.map((row) => row.events));
  expect(Reflect.set(events, 0, null)).toBe(false);
  const first = events[0] as readonly { readonly text: string }[];
  expect(Reflect.set(first[0]!, "text", "changed")).toBe(false);
  expect(Reflect.set(first, "length", 0)).toBe(false);
  expect(Array.from(frame)).toEqual(structuredRows);
  expect(createDataFrame(structuredTable([])).column("value")).toEqual([]);
  expect(() => frame.column("missing")).toThrow('no column "missing"');
});

test("empty frames retain declared schema", () => {
  const frame = createDataFrame(structuredTable([]));
  expect(frame.numRows).toBe(0);
  expect(frame.schema.fields.map((field) => field.name)).toEqual([
    "time",
    "value",
    "events",
  ]);
  expect(fromPoints({}, []).numRows).toBe(0);
});

test("time rejects missing, wrong units, null, duplicates and disorder", () => {
  expect(() =>
    createDataFrame(new Table({ value: vectorFromArray([1]) })),
  ).toThrow("TimestampMillisecond");
  expect(() =>
    createDataFrame(new Table({ time: vectorFromArray([1], new Float64()) })),
  ).toThrow("TimestampMillisecond");
  for (const time of [
    [2, 1],
    [1, 1],
    [1, NaN],
    [1, Infinity],
    [1, 1.5],
  ])
    expect(() =>
      fromPoints(
        {},
        time.map((value) => ({ time: value })),
      ),
    ).toThrow();
  const schema = new ArrowSchema([
    new Field("time", new TimestampMillisecond(), true),
  ]);
  expect(() =>
    createDataFrame(tableFromRows(schema, [{ time: null }])),
  ).toThrow("Invalid time");
  expect(() =>
    createDataFrame(
      new Table(
        new ArrowSchema([
          new Field("time", new TimestampMillisecond()),
          new Field("time", new TimestampMillisecond()),
        ]),
      ),
    ),
  ).toThrow("Duplicate Arrow field");
});

test("events explicitly opt into non-decreasing time", () => {
  expect(
    Array.from(
      fromPoints({}, [{ time: 1 }, { time: 1 }], { allowDuplicateTimes: true }),
    ),
  ).toHaveLength(2);
  expect(() =>
    fromPoints({}, [{ time: 2 }, { time: 1 }], { allowDuplicateTimes: true }),
  ).toThrow("non-decreasing");
});

test("Arrow field nullability is enforced for nested structs and list items", () => {
  const topLevel = new ArrowSchema([
    new Field("time", new TimestampMillisecond(), true),
    new Field("value", new Float64(), false),
  ]);
  expect(() =>
    createDataFrame(tableFromRows(topLevel, [{ time: 1, value: null }])),
  ).toThrow('Non-nullable Arrow field "value"');
  expect(() =>
    createDataFrame(structuredTable([{ time: 1, value: 2, events: [null] }])),
  ).toThrow('Non-nullable Arrow field "item"');
  expect(() =>
    createDataFrame(
      structuredTable([
        { time: 1, value: 2, events: [{ time: 1, text: null }] },
      ]),
    ),
  ).toThrow('Non-nullable Arrow field "text"');
  const nullableParent = new ArrowSchema([
    new Field("time", new TimestampMillisecond(), true),
    new Field(
      "value",
      new Struct([new Field("child", new Float64(), false)]),
      true,
    ),
  ]);
  expect(
    createDataFrame(
      tableFromRows(nullableParent, [{ time: 1, value: null }]),
    ).get(0)!.value,
  ).toBeNull();
});

test("binary getters copy writable buffers without exposing the stored column", () => {
  const schema = new ArrowSchema([
    new Field("time", new TimestampMillisecond()),
    new Field("value", new Binary()),
  ]);
  const frame = createDataFrame(
    tableFromRows(schema, [{ time: 1, value: Uint8Array.of(1, 2) }]),
  );
  const value = frame.get(0)!.value as Uint8Array;
  value[0] = 99;
  (frame.column("value")[0] as Uint8Array)[0] = 99;
  expect(frame.get(0)!.value).toEqual(Uint8Array.of(1, 2));
});

test("schema-owned row construction validates exact time before Arrow can coerce it", () => {
  const schema = structuredTable().schema;
  for (const time of [
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    "1",
    1n,
    null,
    undefined,
  ])
    expect(() => fromRows(schema, [{ time, value: 1, events: [] }])).toThrow(
      "safe integer",
    );
  expect(() => fromRows(schema, [{ value: 1, events: [] }])).toThrow(
    "safe integer",
  );
  expect(Array.from(fromRows(schema, structuredRows))).toEqual(structuredRows);
  expect(fromRows(schema, []).schema.fields[2]!.metadata.get("tea:write")).toBe(
    "append",
  );
});
