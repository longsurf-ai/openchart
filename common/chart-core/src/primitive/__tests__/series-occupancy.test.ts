import { expect, it } from "vitest";
import { createSeriesOccupancy } from "@openchart/chart-core/primitive/series-occupancy";
const area = { x: 0, y: 0, width: 160, height: 120 };
const point = (x: number, y: number) => ({ x, y, index: x, color: "#228855" });
const box = (x: number, y: number) => ({ x, y, width: 4, height: 4 });

it("blocks line ink while leaving area interiors and gaps available", () => {
  const ink = createSeriesOccupancy(area);
  ink.add(
    "Area",
    [point(10, 20), point(70, 20), point(80, NaN), point(90, 60)],
    { lineWidth: 2 },
    area,
  );
  expect(ink.intersects(box(30, 19))).toBe(true);
  expect(ink.intersects(box(30, 70))).toBe(false);
  expect(ink.intersects(box(80, 40))).toBe(false);
});
it("blocks the real step legs rather than an imaginary diagonal", () => {
  const ink = createSeriesOccupancy(area);
  ink.add(
    "Line",
    [point(10, 20), point(80, 80)],
    { lineType: "step", lineWidth: 2 },
    area,
  );
  expect(ink.intersects(box(40, 19))).toBe(true);
  expect(ink.intersects(box(79, 50))).toBe(true);
  expect(ink.intersects(box(40, 50))).toBe(false);
});
it.each(["circles", "cross"])(
  "protects %s without connecting its samples",
  (lineType) => {
    const ink = createSeriesOccupancy(area);
    ink.add(
      "Line",
      [point(20, 20), point(100, 100)],
      { lineType, lineWidth: 2 },
      area,
    );
    expect(ink.intersects(box(20, 20))).toBe(true);
    expect(ink.intersects(box(60, 60))).toBe(false);
  },
);
it("protects candles and signed histogram columns, including zero-height bars", () => {
  const ink = createSeriesOccupancy(area);
  ink.add(
    "Candlestick",
    [
      {
        x: 20,
        index: 0,
        openY: 30,
        closeY: 60,
        highY: 10,
        lowY: 90,
        width: 12,
        color: "green",
        wickColor: "green",
        borderColor: "green",
      },
    ],
    {},
    area,
  );
  ink.add(
    "Histogram",
    [
      { x: 80, index: 0, y: 40, baseY: 80, width: 12, color: "red" },
      { x: 110, index: 1, y: 80, baseY: 80, width: 6, color: "red" },
    ],
    {},
    area,
  );
  expect(ink.intersects(box(20, 15))).toBe(true);
  expect(ink.intersects(box(15, 45))).toBe(true);
  expect(ink.intersects(box(78, 55))).toBe(true);
  expect(ink.intersects(box(110, 80))).toBe(true);
  expect(ink.intersects(box(48, 55))).toBe(false);
});
it("clips huge offscreen coordinates before rasterizing, with no leakage into another pane", () => {
  const ink = createSeriesOccupancy(area),
    pane = { x: 0, y: 0, width: 160, height: 60 };
  ink.add("Line", [point(-1e12, 30), point(1e12, 30)], {}, pane);
  ink.add(
    "Histogram",
    [{ x: 80, index: 0, y: 10, baseY: 1e12, width: 8, color: "red" }],
    {},
    pane,
  );
  expect(ink.intersects(box(30, 30))).toBe(true);
  expect(ink.intersects(box(80, 40))).toBe(true);
  expect(ink.intersects(box(80, 90))).toBe(false);
});
it("hidden or transparent series and unsupported background types contribute no ink", () => {
  const ink = createSeriesOccupancy(area),
    points = [point(0, 20), point(160, 20)];
  ink.add("Line", points, { visible: false }, area);
  ink.add(
    "Line",
    points.map((p) => ({ ...p, color: "rgba(0, 0, 0, 0)" })),
    {},
    area,
  );
  ink.add("Fill", points, {}, area);
  expect(ink.intersects(box(40, 20))).toBe(false);
});

it("protects the full width of thick horizontal strokes without crossing pane boundaries", () => {
  const ink = createSeriesOccupancy(area),
    upper = { x: 0, y: 0, width: 160, height: 60 },
    lower = { x: 0, y: 60, width: 160, height: 60 };
  ink.add("Line", [point(0, 40), point(160, 40)], { lineWidth: 10 }, upper);
  expect(ink.intersects(box(50, 44), upper)).toBe(true);
  ink.add("Line", [point(0, 60), point(160, 60)], { lineWidth: 10 }, upper);
  expect(ink.intersects(box(50, 70), lower)).toBe(false);
});
it("protects opaque candle borders even when their body fill is transparent", () => {
  const ink = createSeriesOccupancy(area);
  ink.add(
    "Candlestick",
    [
      {
        x: 30,
        index: 0,
        openY: 30,
        closeY: 60,
        highY: 10,
        lowY: 80,
        width: 12,
        color: "rgba(0, 0, 0, 0)",
        wickColor: "rgba(0, 0, 0, 0)",
        borderColor: "#ffffff",
      },
    ],
    {},
    area,
  );
  expect(ink.intersects(box(23, 42))).toBe(true);
});

it("preserves the last visible line segment before a transparent color change", () => {
  const ink = createSeriesOccupancy(area);
  ink.add(
    "Line",
    [
      point(10, 20),
      { ...point(80, 20), color: "rgba(0, 0, 0, 0)" },
      point(140, 20),
    ],
    {},
    area,
  );
  expect(ink.intersects(box(40, 20))).toBe(true);
  expect(ink.intersects(box(115, 20))).toBe(false);
});

it("protects thick stroke fringes whose center lies just outside the pane", () => {
  const ink = createSeriesOccupancy(area);
  ink.add("Line", [point(0, -2), point(160, -2)], { lineWidth: 10 }, area);
  expect(ink.intersects(box(50, 1))).toBe(true);
});
