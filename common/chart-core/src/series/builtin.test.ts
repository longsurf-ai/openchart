// Purpose: Tests for built-in series rendering invariants
// Module:  @openchart/chart-core / series

import { describe, expect, it, vi } from "vitest";
import { DataView } from "@openchart/chart-core/data";
import { createCartesian2D } from "@openchart/chart-core/coord";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "./builtin";

it.each([
  LineSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  BarSeries,
  CandlestickSeries,
])(
  "$type preserves missing samples without drawing zeros or invalid coordinates",
  (series) => {
    const values = [null, 0, 1, null, 3, 4, null];
    const data = values.map((value, index) => ({
      time: index,
      value,
      open: value,
      high: value,
      low: value,
      close: value,
    }));
    const coord = createCartesian2D(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: { min: 0, max: 6 }, y: { right: { min: -5, max: 5 } } },
      "right",
    );
    const view = DataView.create(
      series.type,
      data,
      { from: 0, to: data.length },
      (index) => index,
    );
    const items = series.transform(view, coord, 1, series.defaultOptions);
    const coordinates = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
    };
    const context = {
      ...coordinates,
      canvas: { height: 100 },
      beginPath: vi.fn(),
      closePath: vi.fn(),
      setLineDash: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
    } as unknown as CanvasRenderingContext2D;
    series.render(
      context,
      items,
      { from: 0, to: items.length },
      series.defaultOptions,
    );
    const samples = items as { y?: number; closeY?: number }[];
    expect(Number.isNaN(samples[0]!.y ?? samples[0]!.closeY)).toBe(true);
    expect(Number.isFinite(samples[1]!.y ?? samples[1]!.closeY)).toBe(true);
    expect(Number.isNaN(samples[3]!.y ?? samples[3]!.closeY)).toBe(true);
    for (const fn of Object.values(coordinates)) {
      expect(fn.mock.calls.flat().every(Number.isFinite)).toBe(true);
    }
    if (series.type === "Line") {
      expect(coordinates.moveTo.mock.calls.map(([x]) => x)).toEqual([1, 4]);
      expect(coordinates.lineTo.mock.calls.map(([x]) => x)).toEqual([2, 5]);
    }
    if (series.type === "Area") expect(context.fill).toHaveBeenCalledTimes(2);
    if (series.type === "Baseline")
      expect(context.fill).toHaveBeenCalledTimes(4);
  },
);

describe("HistogramSeries", () => {
  it("includes zero in its visible extent for positive and negative values", () => {
    expect(
      HistogramSeries.visibleExtent(
        [
          { time: 1, value: 2 },
          { time: 2, value: 3 },
        ],
        0,
        2,
      ),
    ).toEqual({ min: 0, max: 3 });

    expect(
      HistogramSeries.visibleExtent(
        [
          { time: 1, value: -2 },
          { time: 2, value: -3 },
        ],
        0,
        2,
      ),
    ).toEqual({ min: -3, max: 0 });
  });

  it("renders bars from the configured base instead of the pane floor", () => {
    const data = [
      { time: 1, value: 1 },
      { time: 2, value: -1 },
    ];
    const coord = createCartesian2D(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: { min: 0, max: 1 }, y: { right: { min: -2, max: 2 } } },
      "right",
    );
    const view = DataView.create(
      "Histogram",
      data,
      { from: 0, to: 2 },
      (index) => (index === 0 ? 25 : 75),
    );

    const items = HistogramSeries.transform(
      view,
      coord,
      8,
      HistogramSeries.defaultOptions,
    ) as Array<{ baseY: number; y: number }>;

    expect(items).toHaveLength(2);
    expect(items[0]!.baseY).toBe(50);
    expect(items[1]!.baseY).toBe(50);
    expect(items[0]!.y).toBeLessThan(50);
    expect(items[1]!.y).toBeGreaterThan(50);
  });
});

it("area uses an explicit numerical base rather than the pane floor", () => {
  const coord = createCartesian2D(
    { x: 0, y: 0, width: 100, height: 100 },
    { x: { min: 0, max: 2 }, y: { right: { min: 0, max: 100 } } },
    "right",
  );
  const options = { ...AreaSeries.defaultOptions, base: 50 };
  const view = DataView.create(
    "Area",
    [
      { time: 1, value: 70 },
      { time: 2, value: 30 },
    ],
    { from: 0, to: 2 },
    (index) => index * 20,
  );
  const points = AreaSeries.transform(view, coord, 10, options) as {
    paneBaseY: number;
  }[];
  expect(points.map((point) => point.paneBaseY)).toEqual([50, 50]);
});

it("step lines create horizontal then vertical edges and keep gaps", () => {
  const options = { ...LineSeries.defaultOptions, lineType: "step" as const };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const points = [
    { x: 10, y: 70, index: 0, color: "red" },
    { x: 30, y: 30, index: 1, color: "red" },
    { x: 50, y: NaN, index: 2, color: "red" },
    { x: 70, y: 50, index: 3, color: "red" },
  ];
  LineSeries.render(ctx, points, { from: 0, to: 4 }, options);
  expect(ctx.lineTo).toHaveBeenCalledWith(30, 70);
  expect(ctx.lineTo).toHaveBeenCalledWith(30, 30);
  expect(ctx.lineTo).not.toHaveBeenCalledWith(70, 50);
});
