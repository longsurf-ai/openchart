// Purpose: Rendering, hit testing, and attributes for extended line drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  ATTACHED_TEXT_STYLE,
  type DrawingDefinition,
  type Point,
  type RenderContext,
} from "@openchart/chart-core/drawing/shared";
import {
  lineIntersections,
  visibleExtendedSegment,
} from "@openchart/chart-core/drawing/geometry";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawExtendedLine(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  context: RenderContext,
) {
  const area = context.area;
  if (points.length < 2) return;
  const segment = visibleExtendedSegment(points[0]!, points[1]!, area);
  if (!segment) return;
  drawLine(ctx, segment.start, segment.end);
}

/** Attributes and canvas behavior for extended line drawings. */
export const extendedLine: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: {
      Style: ["stroke", "width", "lineStyle", "startCap", "endCap", "extend"],
      Text: ATTACHED_TEXT_STYLE,
    },
  },
  render(ctx, item, points, context) {
    drawExtendedLine(ctx, points, context);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    const area = context.area;
    if (points.length < 2) return null;
    const intersections = lineIntersections(points[0]!, points[1]!, area).sort(
      (a, b) => a.t - b.t,
    );
    if (intersections.length < 2) return null;
    const start = intersections[0]!;
    const end = intersections[intersections.length - 1]!;
    const hit = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      start.x,
      start.y,
      end.x,
      end.y,
    );
    return hit.hit ? { distance: hit.distance } : null;
  },
};
