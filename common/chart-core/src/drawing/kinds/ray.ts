// Purpose: Rendering, hit testing, and attributes for ray drawings
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
  visibleRaySegment,
} from "@openchart/chart-core/drawing/geometry";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawRay(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  context: RenderContext,
) {
  const area = context.area;
  if (points.length < 2) return;
  const segment = visibleRaySegment(points[0]!, points[1]!, area);
  if (!segment) return;
  drawLine(ctx, segment.start, segment.end);
}

/** Attributes and canvas behavior for ray drawings. */
export const ray: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: {
      Style: ["stroke", "width", "lineStyle", "startCap", "endCap", "extend"],
      Text: ATTACHED_TEXT_STYLE,
    },
  },
  render(ctx, item, points, context) {
    drawRay(ctx, points, context);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    const area = context.area;
    if (points.length < 2) return null;
    const intersections = lineIntersections(points[0]!, points[1]!, area)
      .filter((p) => p.t >= 0)
      .sort((a, b) => a.t - b.t);
    if (intersections.length === 0) return null;
    const end = intersections[intersections.length - 1]!;
    const hit = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      points[0]!.x,
      points[0]!.y,
      end.x,
      end.y,
    );
    return hit.hit ? { distance: hit.distance } : null;
  },
};
