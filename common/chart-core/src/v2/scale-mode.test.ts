// Purpose: Tests for explicit anchors in percentage/indexed y-axis transforms
// Module:  @openchart/chart-core / v2

import { describe, expect, it } from "vitest";
import type { YAxisConfig } from "@openchart/chart-core/scale/config";
import { createSeriesState } from "./state";
import {
  centerAnchorValueInExtent,
  comparableFrom,
  lastIndexAtOrBefore,
  modeBaseline,
  rawVisibleExtent,
  readComparableValue,
} from "./scale-mode";

describe("modeBaseline", () => {
  it("uses the nearest data point at or before an explicit axis anchor", () => {
    const series = createSeriesState("Line", {
      data: [
        { time: 100, value: 10 },
        { time: 200, value: 20 },
        { time: 300, value: 30 },
      ],
    });
    const axis = {
      id: "right",
      mode: "percentage",
      modeAnchor: { time: 250 },
    } as YAxisConfig.Axis;

    expect(modeBaseline(series, { from: 0, to: 1 }, axis)).toBe(20);
  });

  it("falls back to the first visible value without an explicit anchor", () => {
    const series = createSeriesState("Line", {
      data: [
        { time: 100, value: 10 },
        { time: 200, value: 20 },
        { time: 300, value: 30 },
      ],
    });

    expect(modeBaseline(series, { from: 2, to: 3 })).toBe(30);
  });

  // Regression: comparison aux series are aligned to the main timeline and carry
  // undefined HOLES (leading holes before a later-IPO ticker's first bar;
  // interspersed holes for lower-frequency aux). A plain binary search
  // mis-partitions on a hole, returning a wrong (or no) baseline → wrong y-scale.
  it("resolves the anchor baseline over a holey aligned array", () => {
    const data: unknown[] = new Array(6);
    // Leading holes at 0,1; interspersed hole at 3; values elsewhere.
    data[2] = { time: 300, value: 30 };
    data[4] = { time: 500, value: 50 };
    data[5] = { time: 600, value: 60 };
    const series = createSeriesState("Line", { data: data as never });

    const anchorAt = (time: number) =>
      modeBaseline(series, { from: 0, to: 6 }, {
        id: "right",
        mode: "percentage",
        modeAnchor: { time },
      } as YAxisConfig.Axis);

    // anchor between the leading-hole region's first real point and the next
    expect(anchorAt(400)).toBe(30); // highest-time value at/before 400 is t=300
    expect(anchorAt(550)).toBe(50); // skips the t=300 to land on t=500
    expect(anchorAt(700)).toBe(60); // past the end
    // anchor before any real point → first valid value fallback
    expect(anchorAt(100)).toBe(30);
  });
});

describe("centerAnchorValueInExtent", () => {
  it("expands the shorter side so the anchor value lands at the center", () => {
    expect(centerAnchorValueInExtent({ min: 0, max: 24 }, 0)).toEqual({
      min: -24,
      max: 24,
    });
    expect(centerAnchorValueInExtent({ min: -8, max: 2 }, 0)).toEqual({
      min: -8,
      max: 8,
    });
  });
});

describe("lastIndexAtOrBefore", () => {
  const series = (times: Array<number | undefined>) =>
    times.map((t) => (t === undefined ? undefined : { time: t })) as unknown[];

  it("returns the rightmost index with time <= anchor on dense data", () => {
    const data = series([100, 200, 300, 400]);
    expect(lastIndexAtOrBefore(data, "time", 250)).toBe(1);
    expect(lastIndexAtOrBefore(data, "time", 400)).toBe(3);
    expect(lastIndexAtOrBefore(data, "time", 50)).toBe(-1);
  });

  it("skips interspersed and leading holes", () => {
    // holes at 0,1,3,5
    const data = series([undefined, undefined, 300, undefined, 500, undefined]);
    expect(lastIndexAtOrBefore(data, "time", 400)).toBe(2);
    expect(lastIndexAtOrBefore(data, "time", 600)).toBe(4);
    expect(lastIndexAtOrBefore(data, "time", 250)).toBe(-1);
  });

  it("returns -1 for an all-holes window", () => {
    const data = series([undefined, undefined, undefined]);
    expect(lastIndexAtOrBefore(data, "time", 1000)).toBe(-1);
  });
});

describe("comparableFrom (hot-loop variant of readComparableValue)", () => {
  const cases: Array<Record<string, unknown>> = [
    { close: 10, value: 99 },
    { close: 0, value: 5 }, // finite 0 close -> undefined, does NOT fall to value
    { close: Number.NaN, value: 7 }, // non-finite close -> falls to value
    { value: 12 }, // no close -> value
    { close: -3 }, // negative is valid
    { high: 4, low: 2 }, // neither close nor value -> undefined
    {},
  ];
  it("matches readComparableValue exactly", () => {
    const s = createSeriesState("Line", { data: [] });
    for (const point of cases) {
      expect(comparableFrom(point, "close", "value")).toBe(
        readComparableValue(s, point),
      );
    }
  });
});

describe("rawVisibleExtent", () => {
  it("respects explicit scalar columns on native OHLCV rows and in shared-data caches", () => {
    const data = [
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 2, open: 11, high: 15, low: 8, close: 14, volume: 200 },
    ];
    const price = createSeriesState("Candlestick", { data });
    const volume = createSeriesState("Histogram", {
      data,
      fieldMap: { value: "volume" },
    });
    expect(rawVisibleExtent(price, 0, 2)).toMatchObject({
      minLo: 8,
      maxHi: 15,
    });
    expect(rawVisibleExtent(volume, 0, 2)).toMatchObject({
      minLo: 100,
      maxHi: 200,
    });
    expect(readComparableValue(volume, data[1])).toBe(200);
    expect(readComparableValue(price, data[1])).toBe(14);
  });
  it("returns the high/low extent and caches per (data, range)", () => {
    const series = createSeriesState("Candlestick", {
      data: [
        { time: 1, open: 10, high: 12, low: 9, close: 11 },
        { time: 2, open: 11, high: 15, low: 8, close: 14 },
        { time: 3, open: 14, high: 16, low: 13, close: 15 },
      ],
    });
    const ext = rawVisibleExtent(series, 0, 3);
    expect(ext.valid).toBe(true);
    expect(ext.minLo).toBe(8);
    expect(ext.maxHi).toBe(16);
    // same (data, range) returns the cached instance
    expect(rawVisibleExtent(series, 0, 3)).toBe(ext);
  });
});
