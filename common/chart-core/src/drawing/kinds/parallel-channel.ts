// Purpose: Rendering, hit testing, and attributes for parallel channel drawings
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
} from "@openchart/chart-core/drawing/geometry";
import { drawLine, drawLineText } from "@openchart/chart-core/drawing/canvas";

function drawParallelChannel(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  context: RenderContext,
) {
  const area = context.area;
  if (points.length < 3) return;
  const baseStart = points[0]!;
  const baseEnd = points[1]!;
  const base = segmentAcrossArea(baseStart, baseEnd, area) ?? {
    start: baseStart,
    end: baseEnd,
  };
  const offset = offsetFromLine(points[0]!, points[1]!, points[2]!);
  const shiftedStart = {
    x: baseStart.x + offset.x,
    y: baseStart.y + offset.y,
  };
  const shiftedEnd = { x: baseEnd.x + offset.x, y: baseEnd.y + offset.y };
  const shifted = segmentAcrossArea(shiftedStart, shiftedEnd, area) ?? {
    start: shiftedStart,
    end: shiftedEnd,
  };
  drawLine(ctx, base.start, base.end);
  drawLine(ctx, shifted.start, shifted.end);
}

/** Attributes and canvas behavior for parallel channel drawings. */
export const parallelChannel: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: ATTACHED_TEXT_STYLE },
  },
  render(ctx, item, points, context) {
    drawParallelChannel(ctx, points, context);
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    const area = context.area;
    if (points.length < 3) return null;
    const baseStart = points[0]!;
    const baseEnd = points[1]!;
    const base = segmentAcrossArea(baseStart, baseEnd, area) ?? {
      start: baseStart,
      end: baseEnd,
    };
    const offset = offsetFromLine(points[0]!, points[1]!, points[2]!);
    const hitBase = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      base.start.x,
      base.start.y,
      base.end.x,
      base.end.y,
    );
    if (hitBase.hit) return { distance: hitBase.distance };
    const shiftedStart = {
      x: baseStart.x + offset.x,
      y: baseStart.y + offset.y,
    };
    const shiftedEnd = { x: baseEnd.x + offset.x, y: baseEnd.y + offset.y };
    const shifted = segmentAcrossArea(shiftedStart, shiftedEnd, area) ?? {
      start: shiftedStart,
      end: shiftedEnd,
    };
    const hitOffset = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      shifted.start.x,
      shifted.start.y,
      shifted.end.x,
      shifted.end.y,
    );
    return hitOffset.hit ? { distance: hitOffset.distance } : null;
  },
};
