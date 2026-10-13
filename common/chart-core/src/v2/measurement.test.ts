// Purpose: Verify ruler math uses raw values, actual times, intervals and available volume.
import { describe, it, expect } from "vitest";
import { createState } from "./state/defaults";
import { ChartStateModel } from "./state/model";
import { measurementStats, measurementDuration } from "./measurement";

function series() {
  return ChartStateModel.resolvedSeries(
    createState({
      series: {
        price: {
          type: "Line",
          fieldMap: { x: "timestamp", volume: "size" },
          options: { valueFormat: { precision: 3, minMove: 0.25 } },
          data: [
            { timestamp: 100, value: 10, size: 10 },
            { timestamp: 200, value: 15, size: 20 },
            { timestamp: 500, value: 20, size: 30 },
          ],
        },
      },
    }),
    "price",
  )!;
}

describe("measurement statistics", () => {
  it("counts intervals and real elapsed time, with inclusive volume in either direction", () => {
    const start = { time: 100, price: 10 };
    const end = { time: 500, price: 25 };
    const forward = measurementStats(
      { seriesId: "price", phase: "complete", start, end },
      series(),
    );
    expect(forward).toMatchObject({
      delta: 15,
      percent: 150,
      ticks: 60,
      precision: 3,
      bars: 2,
      seconds: 400,
      volume: 60,
      partialVolume: false,
    });
    const backward = measurementStats(
      { seriesId: "price", phase: "complete", start: end, end: start },
      series(),
    );
    expect(backward).toMatchObject({
      delta: -15,
      percent: -60,
      ticks: -60,
      bars: 2,
      seconds: 400,
      volume: 60,
    });
  });
  it("reports zero-base percentages and missing volume without Infinity or invented zeroes", () => {
    const s = series();
    s.data = [
      { timestamp: 100, value: 0 },
      { timestamp: 200, value: 20, size: NaN },
    ];
    const range = {
      seriesId: "price",
      phase: "complete" as const,
      start: { time: 100, price: 0 },
      end: { time: 200, price: 20 },
    };
    expect(measurementStats(range, s)).toMatchObject({
      percent: undefined,
      volume: undefined,
      partialVolume: true,
    });
    s.data.push({ timestamp: 300, value: 20, size: 0 });
    range.end.time = 300;
    expect(measurementStats(range, s)).toMatchObject({
      volume: 0,
      partialVolume: true,
    });
  });
  it("marks a projected margin's volume partial and reanchors after history is prepended", () => {
    const s = series();
    const range = {
      seriesId: "price",
      phase: "complete" as const,
      start: { time: 0, price: 10 },
      end: { time: 500, price: 20 },
    };
    expect(measurementStats(range, s)).toMatchObject({
      from: -1,
      to: 2,
      bars: 3,
      volume: 60,
      partialVolume: true,
    });
    s.data.unshift({ timestamp: 0, value: 10, size: 40 });
    expect(measurementStats(range, s)).toMatchObject({
      from: 0,
      to: 3,
      bars: 3,
      volume: 100,
      partialVolume: false,
    });
  });
  it("formats intraday and multi-day durations", () => {
    expect(measurementDuration(0)).toBe("0s");
    expect(measurementDuration(90061)).toBe("1d 1h 1m 1s");
    expect(measurementDuration(952 * 86400)).toBe("952d");
    expect(measurementDuration(NaN)).toBe("—");
  });
});

describe("CAGR measurement statistics", () => {
  const year = 365.25 * 86400;
  function performance(
    prices: Array<number | undefined>,
    seconds = year,
    reverse = false,
  ) {
    const s = ChartStateModel.resolvedSeries(
      createState({
        series: {
          price: {
            type: "Line",
            fieldMap: { x: "timestamp", value: "adjustedClose" },
            data: prices.map((price, index) => ({
              timestamp:
                1700000000 + (index * seconds) / Math.max(1, prices.length - 1),
              adjustedClose: price,
            })),
          },
        },
      }),
      "price",
    )!;
    const start = { time: 1700000000, price: 999 };
    const end = { time: 1700000000 + seconds, price: -20 };
    if (prices.length === 1) end.time = start.time;
    const range = {
      kind: "cagr" as const,
      seriesId: "price",
      phase: "complete" as const,
      start: reverse ? end : start,
      end: reverse ? start : end,
    };
    return { s, range, result: measurementStats(range, s)?.performance };
  }

  it.each([false, true])(
    "uses chronological mapped closes in either drag direction (%s), not pointer prices",
    (reverse) => {
      const result = performance([100, 120, 108], year, reverse).result!;
      // Returns are +20%, -10%: mean 5%, sample SD sqrt(0.045), two observations/year.
      expect(result.returnPercent).toBeCloseTo(8, 12);
      expect(result.cagrPercent).toBeCloseTo(8, 12);
      expect(result.volatilityPercent).toBeCloseTo(30, 12);
      expect(result.sharpe).toBeCloseTo(1 / 3, 12);
    },
  );

  it("annualizes from actual elapsed dates and observed bar frequency", () => {
    const result = performance([100, 120, 108], year / 2).result!;
    expect(result.cagrPercent).toBeCloseTo(16.64, 12);
    expect(result.volatilityPercent).toBeCloseTo(30 * Math.sqrt(2), 12);
    expect(result.sharpe).toBeCloseTo(Math.sqrt(2) / 3, 12);
  });

  it("separates insufficient samples and zero volatility from valid endpoint returns", () => {
    expect(performance([100]).result).toEqual({
      returnPercent: 0,
      cagrPercent: undefined,
      volatilityPercent: undefined,
      sharpe: undefined,
    });
    expect(performance([100, 120]).result).toMatchObject({
      returnPercent: expect.closeTo(20),
      cagrPercent: expect.closeTo(20),
      volatilityPercent: undefined,
      sharpe: undefined,
    });
    expect(performance([100, 100, 100]).result).toEqual({
      returnPercent: 0,
      cagrPercent: 0,
      volatilityPercent: 0,
      sharpe: undefined,
    });
    expect(performance([100, 110, 121]).result).toMatchObject({
      returnPercent: expect.closeTo(21),
      cagrPercent: expect.closeTo(21),
      volatilityPercent: 0,
      sharpe: undefined,
    });
  });

  it.each([undefined, NaN, Infinity, 0, -1])(
    "does not bridge missing or invalid closes (%s)",
    (price) => {
      expect(performance([100, price, 108]).result).toBeUndefined();
    },
  );

  it("does not invent prices in blank margins or at interpolated timestamps", () => {
    const { s, range } = performance([100, 120, 108]);
    range.start.time -= year;
    expect(measurementStats(range, s)?.performance).toBeUndefined();
    range.start.time = 1700000000 + year / 4;
    expect(measurementStats(range, s)?.performance).toBeUndefined();
  });

  it("recomputes held selections against updated closes and prepended history", () => {
    const { s, range } = performance([100, 120, 108]);
    s.data = [
      { timestamp: 1700000000 - year / 2, adjustedClose: 80 },
      ...s.data,
    ];
    expect(measurementStats(range, s)?.performance?.returnPercent).toBeCloseTo(
      8,
      12,
    );
    s.data = [
      ...s.data.slice(0, -1),
      { timestamp: range.end.time, adjustedClose: 120 },
    ];
    expect(measurementStats(range, s)?.performance?.returnPercent).toBeCloseTo(
      20,
      12,
    );
  });
});
