// Purpose: Rendering, hit testing, and attributes for fib extension drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
  type Point,
} from "@openchart/chart-core/drawing/shared";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

const LEVELS = [0, 0.618, 1, 1.618, 2.618];

function drawFibExtension(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length < 3) return;
  const p1 = points[0]!;
  const p2 = points[1]!;
  const p3 = points[2]!;
  const minX = Math.min(p1.x, p2.x, p3.x);
  const maxX = Math.max(p1.x, p2.x, p3.x);
  const deltaY = p2.y - p1.y;
  for (const level of LEVELS) {
    const y = p3.y + deltaY * level;
    drawLine(ctx, { x: minX, y }, { x: maxX, y });
  }
}

/** Attributes and canvas behavior for fib extension drawings. */
export const fibExtension: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context) {
    drawFibExtension(ctx, points);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    if (points.length < 3) return null;
    const p1 = points[0]!;
    const p2 = points[1]!;
    const p3 = points[2]!;
    const minX = Math.min(p1.x, p2.x, p3.x);
    const maxX = Math.max(p1.x, p2.x, p3.x);
    const deltaY = p2.y - p1.y;
    for (const level of LEVELS) {
      const y = p3.y + deltaY * level;
      const hit = HitTest.horizontal(
        context.mouse.x,
        context.mouse.y,
        y,
        minX,
        maxX,
      );
      if (hit) return { distance: Math.abs(context.mouse.y - y) };
    }
    return null;
  },
};
