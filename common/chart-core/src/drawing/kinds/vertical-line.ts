// Purpose: Rendering, hit testing, and attributes for vertical line drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
  type Point,
  type RenderContext,
} from "@openchart/chart-core/drawing/shared";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawVerticalLine(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  context: RenderContext,
) {
  const area = context.area;
  const p = points[0];
  if (!p) return;
  drawLine(ctx, { x: p.x, y: area.y }, { x: p.x, y: area.y + area.height });
}

/** Attributes and canvas behavior for vertical line drawings. */
export const verticalLine: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context) {
    drawVerticalLine(ctx, points, context);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    const area = context.area;
    const p = points[0];
    if (!p) return null;
    const hit = HitTest.vertical(
      context.mouse.x,
      context.mouse.y,
      p.x,
      area.y,
      area.y + area.height,
    );
    return hit ? { distance: Math.abs(context.mouse.x - p.x) } : null;
  },
};
