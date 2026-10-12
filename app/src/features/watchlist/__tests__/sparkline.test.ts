// Purpose: Prove Price History frames the latest session day, splits at the previous close, breaks at gaps, and resolves one shared crosshair time per row.
import type { TradingDay } from "@openchart/market";

import { sparklineAt, sparklineShape } from "../components/sparkline";
import { quoteAt } from "../hooks/use-quote";

const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 6, hour, minute);
const day = (offset: number): TradingDay => ({
  date: at(offset),
  sessions: [
    { type: "pre", start: at(offset + 8), end: at(offset + 13, 30) },
    { type: "regular", start: at(offset + 13, 30), end: at(offset + 20) },
    { type: "post", start: at(offset + 20), end: at(offset + 24) },
  ],
});
const days = [day(-24), day(0), day(24)];
const times = [at(-6), at(8), at(8, 5), at(14)];
const closes = [90, 100, 101, 99];

test("spans the calendar's latest begun day, leaving later time blank", () => {
  expect(sparklineShape(times, closes, days, "extended", 100)).toMatchObject({
    line: "M0.0 8.0L0.5 2.0M37.5 14.0",
    area: "M0.0 8.0L0.0 8.0L0.5 2.0L0.5 8.0M37.5 8.0L37.5 14.0L37.5 8.0",
    separators: "M34.4 0V16M75.0 0V16",
    base: 8,
    reference: 100,
    start: at(8),
    end: at(24),
  });
  const regular = sparklineShape(times, closes, days, "regular", 100);
  expect(regular?.separators).toBe("");
  expect(regular?.points.map((point) => point.x)).toEqual([(0.5 / 6.5) * 100]);
});

test("without a calendar, spans bars since the overnight gap, at most a day", () => {
  const recent = [at(-6), at(13, 30), at(13, 35), at(13, 40)];
  expect(
    sparklineShape(recent, [50, 10, 11, 12], [], "regular", undefined),
  ).toMatchObject({
    line: "M0.0 14.0L33.3 8.0L66.7 2.0",
    base: 14,
    start: at(13, 30),
    end: at(13, 45),
  });
  const step = 300_000;
  const crypto = Array.from({ length: 360 }, (_, index) => index * step);
  const shape = sparklineShape(crypto, crypto, [], "24h", undefined);
  expect(shape?.points.at(-1)?.x).toBeCloseTo(100 - 100 / 288);
});

test("draws nothing without a finite close in the day", () => {
  expect(sparklineShape([], [], [], "regular", 1)).toBeNull();
  expect(sparklineShape([at(14)], [null], [day(0)], "regular", 1)).toBeNull();
});

test("one crosshair time resolves each row's bar, gap, or absence", () => {
  const shape = sparklineShape(times, closes, days, "extended", 100)!;
  // Inside a bar: its close, at the time's own x.
  expect(sparklineAt(shape, at(8, 7))).toMatchObject({
    x: (7 / 960) * 100,
    bar: { close: 101 },
  });
  // A gap or time still to come draws the line with no value.
  expect(sparklineAt(shape, at(10))?.bar).toBeUndefined();
  expect(sparklineAt(shape, at(22))?.bar).toBeUndefined();
  // Another day is outside this row.
  expect(sparklineAt(shape, at(7))).toBeUndefined();
  // The row then shows that close against the previous close; volume stays live.
  expect(quoteAt({ price: 99, volume: 7, previousClose: 100 }, 101)).toEqual({
    price: 101,
    change: 1,
    changePercent: 1,
    volume: 7,
    previousClose: 100,
  });
  expect(quoteAt({ price: 99 }, 101)).toEqual({ price: 99 });
});
