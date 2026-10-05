// Purpose: Rendering, hit testing, and attributes for horizontal ray drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
  type Point,
  type RenderContext,
} from "@openchart/chart-core/drawing/shared";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawHorizontalRay(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  context: RenderContext,
) {
  const area = context.area;
  const p = points[0];
  if (!p) return;
  drawLine(ctx, { x: p.x, y: p.y }, { x: area.x + area.width, y: p.y });
}

/** Attributes and canvas behavior for horizontal ray drawings. */
export const horizontalRay: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context) {
    drawHorizontalRay(ctx, points, context);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    const area = context.area;
    const p = points[0];
    if (!p) return null;
    const hit = HitTest.horizontal(
      context.mouse.x,
      context.mouse.y,
      p.y,
      p.x,
      area.x + area.width,
    );
    return hit ? { distance: Math.abs(context.mouse.y - p.y) } : null;
  },
};
