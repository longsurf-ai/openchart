import { describe, expect, it, vi } from "vitest";
import { createCartesian2D } from "@openchart/chart-core/coord";
import { Drawing } from "@openchart/chart-core/drawing/types";
import type {
  Point,
  RenderContext,
} from "@openchart/chart-core/drawing/shared";
import { fibChannel } from "./fib-channel";

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

function channel(points: Point[]) {
  const item = Drawing.create(
    "fib_channel",
    points.map(({ x, y }) => ({ time: x, price: 100 - y })),
  );
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  const canvas = {
    beginPath: vi.fn(),
    moveTo,
    lineTo,
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

  return {
    render: () => fibChannel.render(canvas, item, points, context, false, []),
    hit: (mouse: Point) =>
      fibChannel.hitTest(item, points, { ...context, mouse }, canvas),
    moveTo,
    lineTo,
  };
}

describe("Fibonacci channel geometry", () => {
  it("renders all four levels across the area and hits each visible line", () => {
    const drawing = channel([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 50, y: 80 },
    ]);
    drawing.render();

    expect(drawing.moveTo).toHaveBeenCalledTimes(4);
    for (const [index, y] of [20, 42.92, 57.08, 80].entries()) {
      expect(drawing.moveTo).toHaveBeenNthCalledWith(
        index + 1,
        0,
        expect.closeTo(y),
      );
      expect(drawing.lineTo).toHaveBeenNthCalledWith(
        index + 1,
        100,
        expect.closeTo(y),
      );
      expect(drawing.hit({ x: 50, y })?.distance).toBeCloseTo(0);
    }
    expect(drawing.hit({ x: 50, y: 30 })).toBeNull();
  });

  it("keeps the first matching level when hit tolerances overlap", () => {
    const drawing = channel([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 50, y: 30 },
    ]);
    expect(drawing.hit({ x: 50, y: 24 })).toEqual({ distance: 4 });
  });

  it("preserves the offscreen line fallback", () => {
    const drawing = channel([
      { x: 20, y: -20 },
      { x: 80, y: -20 },
      { x: 50, y: -20 },
    ]);
    drawing.render();

    expect(drawing.moveTo).toHaveBeenCalledTimes(4);
    expect(drawing.moveTo).toHaveBeenCalledWith(-180, -20);
    expect(drawing.lineTo).toHaveBeenCalledWith(220, -20);
    expect(drawing.hit({ x: 50, y: -20 })?.distance).toBeCloseTo(0);
    expect(drawing.hit({ x: 50, y: 0 })).toBeNull();
  });

  it("preserves degenerate segments when both base anchors coincide", () => {
    const drawing = channel([
      { x: 20, y: 20 },
      { x: 20, y: 20 },
      { x: 50, y: 80 },
    ]);
    drawing.render();

    expect(drawing.moveTo).toHaveBeenCalledTimes(4);
    expect(drawing.moveTo).toHaveBeenCalledWith(20, 20);
    expect(drawing.lineTo).toHaveBeenCalledWith(20, 20);
    expect(drawing.hit({ x: 23, y: 24 })).toEqual({ distance: 5 });
    expect(drawing.hit({ x: 26, y: 20 })).toBeNull();
  });

  it("does not render or hit an incomplete channel", () => {
    const drawing = channel([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
    ]);
    drawing.render();

    expect(drawing.moveTo).not.toHaveBeenCalled();
    expect(drawing.hit({ x: 50, y: 20 })).toBeNull();
  });
});
