// Purpose: Dataset declarations retain addressing and layout invariants in their derived codecs.
import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  bars,
  barsRow,
  echo,
} from "@openchart/server/data/dataset/tests/fixtures";
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import { yfinanceBars } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { fromPoints, toJson, symbols } from "@openchart/timeseries";
import { defineDataset, k, Layout } from "./index";

test("the declaration retains independent keys and observations and derives one shared timeseries codec", () => {
  for (const definition of [bars, binanceBars, yfinanceBars]) {
    expect(definition.layout).toBe(Layout.Timeseries);
    expect(definition.keys.fields.time.keyKind).toBe("range");
    expect(definition.keys.fields.symbol.keyKind).toBe("eq");
    expect(definition.schema.fields).toHaveProperty("close");
    expect(definition.schema.fields).not.toHaveProperty("symbol");
    expect(definition.access.select.output).toBe(
      definition.access.stream.output,
    );
    expect(definition.frame.codec).toBe(definition.access.select.output);
  }
  expect(bars.schema.fields.time).toBe(barsRow.fields.time);
  expect(bars.schema.fields.open).toBe(barsRow.fields.open);
  expect(echo.layout).toBe(Layout.Row);
  expect(Schema.decodeUnknownSync(echo.schema)({ value: "x" })).toEqual({
    value: "x",
  });
  expect(
    Schema.decodeUnknownSync(echo.access.select.output)([{ value: "x" }]),
  ).toEqual([{ value: "x" }]);
  expect(
    Schema.decodeUnknownSync(echo.access.stream.output)({ value: "x" }),
  ).toEqual({ value: "x" });
  expect(() =>
    Schema.decodeUnknownSync(echo.access.stream.output)([{ value: "x" }]),
  ).toThrow();
});

test("equality, range and optional selectors derive from marked native schemas without mutating them", () => {
  const scalar = Schema.Finite;
  const eq = k.eq(scalar);
  const range = k.range(scalar);
  expect(eq).not.toBe(scalar);
  expect(range).not.toBe(eq);
  expect(scalar).not.toHaveProperty("keyKind");
  const definition = defineDataset({
    name: "test.optional-selectors",
    keys: Schema.Struct({
      id: k.eq(Schema.NumberFromString),
      category: k.eq(Schema.optionalKey(Schema.String)),
      time: range,
      price: k.range(Schema.optionalKey(Schema.Finite)),
    }),
    schema: echo.schema,
    layout: Layout.Row,
    access: { select: true, stream: true },
  });
  const select = Schema.decodeUnknownSync(definition.access.select.input);
  expect(select({ id: "1", time: { from: 0 } })).toEqual({
    id: 1,
    time: { from: 0 },
  });
  expect(select({ id: "1", time: {}, price: { to: 5 } })).toEqual({
    id: 1,
    time: {},
    price: { to: 5 },
  });
  expect(
    Schema.encodeSync(definition.access.select.input)({ id: 1, time: {} }),
  ).toEqual({ id: "1", time: {} });
  for (const input of [
    { id: "1" },
    { id: "1", time: 0 },
    { id: "1", time: { from: "0" } },
    { id: "1", time: { typo: 0 } },
  ])
    expect(() => select(input)).toThrow();
  const stream = Schema.decodeUnknownSync(definition.access.stream.input);
  expect(stream({ id: "1" })).toEqual({ id: 1 });
  expect(() => stream({ id: "1", time: {} })).toThrow();
});

test("invalid declaration semantics fail before registration", () => {
  const row = { ...echo, access: { select: true } };
  const series = { ...bars, access: { select: true } };
  for (const [name, invalid] of Object.entries({
    "missing-schema": {
      keys: echo.keys,
      layout: Layout.Row,
      access: { select: true },
    },
    "missing-keys": {
      schema: echo.schema,
      layout: Layout.Row,
      access: { select: true },
    },
    "unknown-layout": { ...row, layout: "other" },
    "unmarked-key": { ...row, keys: Schema.Struct({ id: Schema.Int }) },
    "reserved-count": {
      ...row,
      keys: Schema.Struct({ count: k.eq(Schema.Int) }),
    },
    "reserved-limit": {
      ...row,
      keys: Schema.Struct({ limit: k.eq(Schema.Int) }),
    },
    "reserved-score": {
      ...row,
      schema: Schema.Struct({ score: Schema.Finite }),
      access: { search: true },
    },
    "missing-time": { ...series, schema: echo.schema },
    "string-time": {
      ...series,
      schema: Schema.Struct({ time: Schema.String }),
    },
    "eq-time": { ...series, keys: Schema.Struct({ time: k.eq(Schema.Int) }) },
    "optional-time": {
      ...series,
      keys: Schema.Struct({ time: k.range(Schema.optionalKey(Schema.Int)) }),
    },
    "extra-range": {
      ...series,
      keys: Schema.Struct({ ...bars.keys.fields, other: k.range(Schema.Int) }),
    },
    "object-column": {
      ...series,
      schema: Schema.Struct({ time: Schema.Int, value: Schema.Struct({}) }),
    },
    "optional-column": {
      ...series,
      schema: Schema.Struct({
        time: Schema.Int,
        value: Schema.optionalKey(Schema.Finite),
      }),
    },
    "timeseries-search": { ...series, access: { search: true } },
  })) {
    expect(
      () =>
        defineDataset({ ...invalid, name: `test.invalid.${name}` } as never),
      name,
    ).toThrow();
  }
});

test("search adds only a score and preserves observation checks", () => {
  const definition = defineDataset({
    name: "test.search-observation",
    keys: Schema.Struct({}),
    schema: Schema.Struct({ low: Schema.Finite, high: Schema.Finite }).check(
      Schema.makeFilter((row) => row.low <= row.high),
    ),
    layout: Layout.Row,
    access: { search: true },
  });
  const search = Schema.decodeUnknownSync(definition.access.search.output);
  expect(search([{ low: 1, high: 2, score: 0.5 }])).toEqual([
    { low: 1, high: 2, score: 0.5 },
  ]);
  expect(() => search([{ low: 2, high: 1, score: 0.5 }])).toThrow();
  expect(() => search([{ low: 1, high: 2, extra: true }])).toThrow();
});

test("native operation schemas reject malformed input and preserve distinct access contracts", () => {
  const select = Schema.decodeUnknownSync(echo.access.select.input);
  expect(select({ topic: "x", count: 2 })).toEqual({ topic: "x", count: 2 });
  for (const invalid of [
    {},
    { topic: "x", limit: 2 },
    ...[0, -1, 1.5, Infinity].map((count) => ({ topic: "x", count })),
  ])
    expect(() => select(invalid)).toThrow();
  expect(
    Schema.decodeUnknownSync(echo.access.search.input)({
      query: "x",
      limit: 2,
    }),
  ).toEqual({ query: "x", limit: 2 });
  expect(() =>
    Schema.decodeUnknownSync(echo.access.stream.output)({ value: 1 }),
  ).toThrow();
  expect(() => defineDataset({ ...echo, access: { select: true } })).toThrow(
    "already declared",
  );
  expect(() =>
    defineDataset({ name: "invalid", access: {} } as never),
  ).toThrow();
  expect(() =>
    defineDataset({ name: "invalid-mode", access: { other: {} } } as never),
  ).toThrow();
});

test("operation codecs preserve IPC values and reject undeclared columns and domain violations", () => {
  const frame = bars.frame.create({
    labels: {},
    rows: [
      { time: 1, open: 10, close: 11 },
      { time: 2, open: NaN, close: 12 },
    ],
  });
  const wire = Schema.encodeSync(bars.access.select.output)(frame);
  expect(typeof wire).toBe("string");
  for (const codec of [bars.access.select.output, bars.access.stream.output]) {
    const decoded = Schema.decodeUnknownSync(codec)(wire);
    expect([...decoded]).toEqual([...frame]);
    expect(decoded._dataFrame).toBe(symbols.dataFrame);
    expect(Number.isNaN(decoded.get(1)?.open)).toBe(true);
  }
  for (const rows of [
    [{ time: -1, open: 10, close: 11 }],
    [{ time: 1, open: 0, close: 11 }],
    [{ time: 1, open: 10, close: 11, extra: 1 }],
  ])
    expect(() =>
      Schema.decodeUnknownSync(bars.access.select.output)(
        toJson(fromPoints({}, rows)),
      ),
    ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(bars.access.select.output)("not IPC"),
  ).toThrow();
});
