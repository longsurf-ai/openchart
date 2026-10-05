// Purpose: Rendering, hit testing, and attributes for fib channel drawings
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
  segmentAcrossArea,
  offsetFromLine,
  FIB_CHANNEL_LEVELS,
} from "@openchart/chart-core/drawing/geometry";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function channelSegments(
  points: Point[],
  area: RenderContext["area"],
): { start: Point; end: Point }[] {
  if (points.length < 3) return [];
  const baseStart = points[0]!;
  const baseEnd = points[1]!;
  const offset = offsetFromLine(points[0]!, points[1]!, points[2]!);
  return FIB_CHANNEL_LEVELS.map((level) => {
    const dx = offset.x * level;
    const dy = offset.y * level;
    const shiftedStart = { x: baseStart.x + dx, y: baseStart.y + dy };
    const shiftedEnd = { x: baseEnd.x + dx, y: baseEnd.y + dy };
    return (
      segmentAcrossArea(shiftedStart, shiftedEnd, area) ?? {
        start: shiftedStart,
        end: shiftedEnd,
      }
    );
  });
}

/** Attributes and canvas behavior for fib channel drawings. */
export const fibChannel: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: ATTACHED_TEXT_STYLE },
  },
  render(ctx, item, points, context) {
    for (const { start, end } of channelSegments(points, context.area)) {
      drawLine(ctx, start, end);
    }
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    for (const { start, end } of channelSegments(points, context.area)) {
      const hit = HitTest.line(
        context.mouse.x,
        context.mouse.y,
        start.x,
        start.y,
        end.x,
        end.y,
      );
      if (hit.hit) return { distance: hit.distance };
    }
    return null;
  },
};
