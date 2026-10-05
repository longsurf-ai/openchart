// Purpose: Lock the single request schema and complete snapshot boundary.
import { Schema } from "effect";
import { BarColumns } from "@openchart/market";
import {
  defineDataFrame,
  fromPoints,
  toJson,
  symbols,
} from "@openchart/timeseries";
import { describe, expect, it } from "vitest";
import {
  BarsRequest,
  BarsSnapshot,
  BarsChannelRequest,
  BarsMessage,
} from "./bars";

const series = {
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "Binance",
    currency: "USDT",
  },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
};
const window = { from: 0, to: 10, countBack: 5 };
// A source's native columns sit beside the required Bar vocabulary.
const NativeBars = defineDataFrame({
  ...BarColumns,
  trades: Schema.Finite,
  final: Schema.Boolean,
  asOf: Schema.Finite,
});
const bar = { open: 1, high: 2, low: 1, close: 2, volume: 3 };
const native = { trades: 1, final: false, asOf: 5 };
const frame = (times: number[], options?: { allowDuplicateTimes: boolean }) =>
  NativeBars.create(
    {
      labels: { symbol: "BTCUSDT" },
      rows: times.map((time) => ({ time, ...bar, ...native })),
    },
    options,
  );

describe("Bars schemas", () => {
  it("requires a complete finite or live window and rejects legacy/unknown fields", () => {
    const parse = Schema.decodeUnknownSync(BarsRequest);
    expect(parse({ ...series, ...window })).toMatchObject(window);
    expect(parse({ ...series, ...window, to: "now" }).to).toBe("now");
    for (const fields of [
      {},
      { ...window, from: NaN },
      { ...window, to: Infinity },
      { ...window, countBack: 0 },
      { ...window, countBack: 1.5 },
      { ...window, from: 10 },
      { ...window, to: -1 },
      { ...window, count: 5 },
      { ...window, start: 0 },
      { ...window, end: 10 },
      { ...window, typo: true },
      { ...window, provider: "" },
    ])
      expect(Schema.is(BarsRequest)({ ...series, ...fields })).toBe(false);
    const open = {
      type: "bars.open",
      request: parse({ ...series, ...window }),
    };
    expect(Schema.is(BarsChannelRequest)(open)).toBe(true);
    expect(Schema.is(BarsChannelRequest)({ ...open, live: true })).toBe(false);
  });

  it("accepts empty inspected ranges and rejects invalid, unordered or duplicate snapshots", () => {
    const snapshot = {
      range: { from: 0, to: 10 },
      data: frame([]),
      hasMoreBefore: false,
    };
    expect(Schema.is(BarsSnapshot)(snapshot)).toBe(true);
    expect(Schema.is(BarsSnapshot)({ ...snapshot, data: frame([0, 9]) })).toBe(
      true,
    );
    const parse = Schema.decodeUnknownSync(BarsSnapshot);
    const wire = Schema.encodeSync(BarsSnapshot)(snapshot);
    for (const time of [[-1], [10]])
      expect(() => parse({ ...wire, data: toJson(frame(time)) })).toThrow();
    for (const time of [
      [2, 1],
      [1, 1],
    ])
      expect(() => frame(time)).toThrow();
    const duplicateEvents = frame([1, 1], { allowDuplicateTimes: true });
    expect(() => parse({ ...wire, data: toJson(duplicateEvents) })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(BarsMessage)({
        type: "updates",
        data: toJson(duplicateEvents),
      }),
    ).toThrow();
    for (const range of [
      { from: 10, to: 10 },
      { from: 10, to: 0 },
      { from: 0, to: "now" },
      { from: 0, to: 10, extra: true },
    ])
      expect(() => parse({ ...wire, range })).toThrow();
  });
});

it("requires the Bar vocabulary while native columns remain", () => {
  const parse = Schema.decodeUnknownSync(BarsMessage);
  const withoutVolume = fromPoints({}, [
    { time: 1, open: 1, high: 2, low: 1, close: 2 },
  ]);
  expect(() => parse({ type: "updates", data: toJson(withoutVolume) })).toThrow(
    /open, high, low, close and volume/,
  );
  const decoded = parse({ type: "updates", data: toJson(frame([1])) });
  if (decoded.type !== "updates") throw new Error("Expected updates");
  const close: number | null | undefined = decoded.data.get(0)?.close;
  expect(close).toBe(2);
  expect(decoded.data.schema.fields.map((field) => field.name)).toContain(
    "trades",
  );
});

it("round-trips source columns, labels and gaps through both Bars message variants", () => {
  const data = NativeBars.create({
    labels: { symbol: "BTCUSDT", interval: "1m" },
    rows: [
      { time: 1, ...bar, ...native, close: NaN, trades: 10, final: true },
      { time: 2, ...bar, ...native, close: null, trades: 0 },
    ],
  });
  const messages: BarsMessage[] = [
    {
      type: "snapshot",
      snapshot: { data, range: { from: 0, to: 3 }, hasMoreBefore: false },
    },
    { type: "updates", data },
  ];
  for (const message of messages) {
    const wire = Schema.encodeSync(BarsMessage)(message);
    const result = Schema.decodeUnknownSync(Schema.fromJsonString(BarsMessage))(
      JSON.stringify(wire),
    );
    const decoded =
      result.type === "snapshot" ? result.snapshot.data : result.data;
    expect([...decoded]).toEqual([...data]);
    expect(decoded.labels).toEqual(data.labels);
    expect(decoded._dataFrame).toBe(symbols.dataFrame);
    expect(Number.isNaN(decoded.get(0)?.close)).toBe(true);
    expect(decoded.get(1)?.close).toBeNull();
  }
});
