// Purpose: Rendering, hit testing, and attributes for rectangle drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import type { DrawingDefinition } from "@openchart/chart-core/drawing/shared";
import { projectDrawingBoundary } from "@openchart/chart-core/drawing/boundary";
import { drawBoundary } from "@openchart/chart-core/drawing/canvas";

/** Attributes and canvas behavior for rectangle drawings. */
export const rectangle: DrawingDefinition = {
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
  hitTest(_item, points, context) {
    if (points.length < 2) return null;
    const p1 = points[0]!;
    const p2 = points[1]!;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p1.x - p2.x);
    const h = Math.abs(p1.y - p2.y);
    const inside = HitTest.rect(context.mouse.x, context.mouse.y, x, y, w, h);
    return inside ? { distance: 0 } : null;
  },
};
