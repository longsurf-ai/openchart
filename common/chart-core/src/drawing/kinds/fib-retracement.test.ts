import { describe, expect, it } from "vitest";
import { createCartesian2D } from "@openchart/chart-core/coord";
import { Drawing } from "@openchart/chart-core/drawing/types";
import type { RenderContext } from "@openchart/chart-core/drawing/shared";
import { fibRetracement } from "./fib-retracement";

const area = { x: 0, y: 0, width: 100, height: 100 };
const context: RenderContext = {
  area,
  coord: createCartesian2D(
    area,
    { x: { min: 0, max: 100 }, y: { right: { min: 0, max: 100 } } },
    "right",
  ),
  data: [],
  xPositions: [],
  xFn: (index) => index,
  visibleRange: { from: 0, to: 100 },
};

describe("Fibonacci retracement colors", () => {
  it("strokes each level and fills each band in its ratio's color", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 0 },
    ];
    const item = Drawing.create(
      "fib_retracement",
      points.map(({ x, y }) => ({ time: x, price: 100 - y })),
    );
    const strokes: string[] = [];
    const bands: { color: string; y: number; height: number }[] = [];
    const canvas = {
      strokeStyle: "",
      fillStyle: "",
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      setLineDash() {},
      fillText() {},
      stroke() {
        strokes.push(this.strokeStyle);
      },
      fillRect(_x: number, y: number, _width: number, height: number) {
        bands.push({ color: this.fillStyle, y, height });
      },
    };

    fibRetracement.render(
      canvas as unknown as CanvasRenderingContext2D,
      item,
      points,
      context,
      false,
      [],
    );

    // Seven level lines, then the connector in the canvas's own stroke.
    expect(strokes.slice(0, 7)).toEqual([
      "#787b86",
      "#f23645",
      "#ff9800",
      "#4caf50",
      "#089981",
      "#00bcd4",
      "#787b86",
    ]);
    expect(bands).toHaveLength(6);
    // The 0 → 0.236 band sits at the bottom and takes 0.236's red.
    expect(bands[0]!.color).toMatch(/242, ?54, ?69/);
    expect(bands[0]!.y).toBeCloseTo(76.4);
    expect(bands[0]!.height).toBeCloseTo(23.6);
  });
});
