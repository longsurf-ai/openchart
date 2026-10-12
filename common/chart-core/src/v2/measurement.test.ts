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
