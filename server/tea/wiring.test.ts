// Purpose: Wiring fills each column a script reads from one field of one input, and keeps unread inputs as drivers.
import {
  Bool,
  Field,
  Float64,
  Schema as ArrowSchema,
  Struct,
} from "apache-arrow";
import { Effect, Schema } from "effect";
import { Subject } from "rxjs";
import { DataStream, timeframeClock } from "tea";
import { expect, test } from "vitest";
import { BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { columnSchema, wire } from "./wiring";

test("a column reads one number at its field path, anything else becomes NaN, and an unread input still drives", () => {
  const bands = new ArrowSchema([
    new Field("time", new Float64(), false),
    new Field("provisional", new Bool(), false),
    new Field(
      "basis",
      new Struct([new Field("series", new Float64(), true)]),
      true,
    ),
  ]);
  const rows = new Subject<Record<string, unknown>>();
  const bandsStream = new DataStream(bands, rows, timeframeClock("1"));
  const barsStream = new DataStream(
    columnSchema(["close"]),
    new Subject<Record<string, unknown>>(),
    timeframeClock("1"),
  );
  const series = Schema.decodeUnknownSync(BarsSeries)({
    provider: "binance",
    listing: { symbol: "BTCUSDT", currency: "USDT" },
    resolution: "1m",
    session: "24h",
    adjustment: "raw",
  });
  const wired = Effect.runSync(
    wire(
      {
        inputs: {
          bands: { _tag: "NodeRef", node: "bb", schema: bands },
          bars: Tea.barsInputs(series).inputs.bars!,
        },
        map: { "indicator.basis": ["bands", ["basis", "series"]] },
      },
      { bands: bandsStream, bars: barsStream },
      new ArrowSchema([new Field("indicator.basis", new Float64(), true)]),
      "root",
    ),
  );
  expect(wired.drivers).toEqual([barsStream]);
  const basis = wired.columns["indicator.basis"]!;
  expect(basis.clock).toBe(timeframeClock("1"));
  const seen: unknown[] = [];
  basis.subscribe({ next: (row) => seen.push(row) });
  rows.next({ time: 1, provisional: false, basis: { series: 5 } });
  rows.next({ time: 2, provisional: true, basis: { series: null } });
  rows.next({ time: 3, provisional: false, basis: null });
  expect(seen).toEqual([
    { time: 1, provisional: false, "indicator.basis": 5 },
    { time: 2, provisional: true, "indicator.basis": NaN },
    { time: 3, provisional: false, "indicator.basis": NaN },
  ]);
});
