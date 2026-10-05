// Purpose: Rendering, hit testing, and attributes for triangle drawings
// Module:  @openchart/chart-core / drawing

import type { DrawingDefinition } from "@openchart/chart-core/drawing/shared";
import { projectDrawingBoundary } from "@openchart/chart-core/drawing/boundary";
import { drawBoundary } from "@openchart/chart-core/drawing/canvas";

/** Attributes and canvas behavior for triangle drawings. */
export const triangle: DrawingDefinition = {
  attributes: {
    toolbar: ["stroke", "fill", "width", "lineStyle"],
    modal: { Style: ["stroke", "fill", "width", "lineStyle"], Text: [] },
  },
  render(ctx, item, points) {
    drawBoundary(
      ctx,
      projectDrawingBoundary(item, points),
      item.style.fillColor,
    );
  },
  hitTest(item, points, context) {
    const boundary = projectDrawingBoundary(item, points);
    if (!boundary) return null;
    const [first, second, third] = boundary.primitives;
    if (!first || !second || !third) return null;
    const a = first.start;
    const b = second.start;
    const c = third.start;
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (denominator === 0) return null;
    const alpha =
      ((b.y - c.y) * (context.mouse.x - c.x) +
        (c.x - b.x) * (context.mouse.y - c.y)) /
      denominator;
    const beta =
      ((c.y - a.y) * (context.mouse.x - c.x) +
        (a.x - c.x) * (context.mouse.y - c.y)) /
      denominator;
    const gamma = 1 - alpha - beta;
    const inside = alpha >= 0 && beta >= 0 && gamma >= 0;
    return inside ? { distance: 0 } : null;
  },
};
