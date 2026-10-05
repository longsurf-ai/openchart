// Purpose: Rendering, hit testing, and attributes for cross line drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
  type Point,
  type RenderContext,
} from "@openchart/chart-core/drawing/shared";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawCrossLine(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  context: RenderContext,
) {
  const area = context.area;
  const p = points[0];
  if (!p) return;
  drawLine(ctx, { x: area.x, y: p.y }, { x: area.x + area.width, y: p.y });
  drawLine(ctx, { x: p.x, y: area.y }, { x: p.x, y: area.y + area.height });
}

/** Attributes and canvas behavior for cross line drawings. */
export const crossLine: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context) {
    drawCrossLine(ctx, points, context);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    const area = context.area;
    const p = points[0];
    if (!p) return null;
    const hitH = HitTest.horizontal(
      context.mouse.x,
      context.mouse.y,
      p.y,
      area.x,
      area.x + area.width,
    );
    const hitV = HitTest.vertical(
      context.mouse.x,
      context.mouse.y,
      p.x,
      area.y,
      area.y + area.height,
    );
    if (hitH) return { distance: Math.abs(context.mouse.y - p.y) };
    if (hitV) return { distance: Math.abs(context.mouse.x - p.x) };
    return null;
  },
};
