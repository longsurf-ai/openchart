// Purpose: Keep scalar declarations authoritative for Arrow layouts and refinements.
import { Schema } from "effect";
import { expect, test } from "vitest";
import { defineDataFrame, hasColumns } from "./defineDataFrame";
import { fromPoints } from "./fromPoints";
import { parseJson, toJson } from "./json";

const prices = defineDataFrame({
  close: Schema.Finite.check(Schema.isGreaterThan(0)),
  note: Schema.String.check(Schema.isMinLength(1)),
  final: Schema.Boolean,
});
const rows = [
  { time: 1, close: 2, note: "a", final: false },
  { time: 2, close: NaN, note: null, final: true },
  { time: 3, close: null, note: "b", final: null },
];

test("typed scalar factory and codec preserve null separately from NaN", () => {
  const frame = prices.create({ labels: { symbol: "AAPL" }, rows });
  const decoded = prices.parseJson(prices.toJson(frame));
  expect(Array.from(decoded)).toEqual(rows);
  const finalized: boolean | null | undefined = decoded.get(0)?.final;
  expect(finalized).toBe(false);
  // @ts-expect-error declared fields retain their type
  const number: number = decoded.get(0)!.final;
  void number;
  // @ts-expect-error unknown names are not part of this declaration
  void decoded.get(0)!.clse;
  expect(
    Array.from(Schema.decodeUnknownSync(prices.codec)(toJson(frame))),
  ).toEqual(rows);
});

test("construction and IPC parsing both enforce refinements and exact columns", () => {
  for (const row of [
    { ...rows[0]!, close: 0 },
    { ...rows[0]!, note: "" },
    { ...rows[0]!, unexpected: true },
  ]) {
    expect(() => prices.create({ labels: {}, rows: [row] })).toThrow();
    expect(() => prices.parseJson(toJson(fromPoints({}, [row])))).toThrow();
  }
  expect(() =>
    prices.parseJson(toJson(fromPoints({}, [{ time: 1, close: 2 }]))),
  ).toThrow("columns");
  const positiveTime = defineDataFrame(
    { close: Schema.Finite },
    Schema.Int.check(Schema.isGreaterThan(0)),
  );
  expect(() =>
    positiveTime.parseJson(toJson(fromPoints({}, [{ time: -1, close: 1 }]))),
  ).toThrow();
  expect(() =>
    positiveTime.create({ labels: {}, rows: [{ time: -1, close: 1 }] }),
  ).toThrow();
});

test("empty and all-null declarations remain constructible without inference", () => {
  const kind = defineDataFrame({ close: Schema.Finite });
  for (const rows of [[], [{ time: 1, close: null }]]) {
    const frame = kind.create({ labels: {}, rows });
    expect(Array.from(kind.parseJson(kind.toJson(frame)))).toEqual(rows);
  }
});

test("hasColumns requires a minimum vocabulary while other columns remain", () => {
  const frame = prices.create({ labels: {}, rows });
  // IPC reconstructs base Arrow classes; the check must survive transport.
  for (const candidate of [frame, parseJson(toJson(frame))]) {
    expect(hasColumns(candidate, { close: Schema.Finite })).toBe(true);
    expect(hasColumns(candidate, { volume: Schema.Finite })).toBe(false);
    // A column of the wrong Arrow type is not the declared column.
    expect(hasColumns(candidate, { note: Schema.Finite })).toBe(false);
  }
  const generic = parseJson(toJson(frame));
  if (hasColumns(generic, { close: Schema.Finite })) {
    const close: number | null | undefined = generic.get(0)?.close;
    expect(close).toBe(2);
  }
});
