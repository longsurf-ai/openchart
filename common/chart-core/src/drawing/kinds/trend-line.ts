// Purpose: Rendering, hit testing, and attributes for trend line drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  ATTACHED_TEXT_STYLE,
  type DrawingDefinition,
  type Point,
} from "@openchart/chart-core/drawing/shared";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawTrendLine(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length < 2) return;
  drawLine(ctx, points[0]!, points[1]!);
}

/** Attributes and canvas behavior for trend line drawings. */
export const trendLine: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: {
      Style: ["stroke", "width", "lineStyle", "startCap", "endCap", "extend"],
      Text: ATTACHED_TEXT_STYLE,
    },
  },
  render(ctx, item, points, context) {
    drawTrendLine(ctx, points);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    if (points.length < 2) return null;
    const hit = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      points[0]!.x,
      points[0]!.y,
      points[1]!.x,
      points[1]!.y,
    );
    return hit.hit ? { distance: hit.distance } : null;
  },
};
