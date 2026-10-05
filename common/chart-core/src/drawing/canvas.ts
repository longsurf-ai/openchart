// Purpose: Shared canvas strokes, labels, and selection handles
// Module:  @openchart/chart-core / drawing

import type { Drawing } from "./types";
import type { Point, RenderContext } from "./shared";
import type { ResolvedDrawingBoundary } from "./boundary";
import {
  visibleFiniteSegment,
  visibleRaySegment,
  visibleExtendedSegment,
  segmentAcrossArea,
} from "./geometry";

/** Applies the drawing line style to the caller-owned canvas context.
 * @example setLineDash(ctx, item.style.lineStyle);
 */
export function setLineDash(
  ctx: CanvasRenderingContext2D,
  style: Drawing.LineStyle,
) {
  if (style === "dashed") ctx.setLineDash([6, 4]);
  else if (style === "dotted") ctx.setLineDash([2, 2]);
  else ctx.setLineDash([]);
}

/** Strokes one segment using the current canvas style.
 * @example drawLine(ctx, start, end);
 */
export function drawLine(ctx: CanvasRenderingContext2D, p1: Point, p2: Point) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

/** Paints the canonical path, retaining true quadratic segments and explicit closure.
 * Incomplete/unresolved paths paint nothing; fills apply only to closed boundaries.
 * @example drawBoundary(ctx, projectDrawingBoundary(item, points), item.style.fillColor);
 */
export function drawBoundary(
  ctx: CanvasRenderingContext2D,
  boundary: ResolvedDrawingBoundary | null,
  fill?: string,
) {
  const first = boundary?.primitives[0];
  if (!boundary || !first) return;
  ctx.beginPath();
  ctx.moveTo(first.start.x, first.start.y);
  for (const primitive of boundary.primitives) {
    if (primitive.kind === "quadratic") {
      ctx.quadraticCurveTo(
        primitive.control.x,
        primitive.control.y,
        primitive.end.x,
        primitive.end.y,
      );
    } else {
      ctx.lineTo(primitive.end.x, primitive.end.y);
    }
  }
  if (boundary.closed) {
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }
  ctx.stroke();
}

/** Draws top-left-aligned text using the supplied color and font size.
 * @example drawText(ctx, point, "Label", "#ffffff", 12);
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  p: Point,
  text: string,
  color: string,
  fontSize: number,
) {
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, p.x, p.y);
}

/** Draws attached text on the visible line segment, restoring its local canvas changes.
 * @example drawLineText(ctx, item, points, context);
 */
export function drawLineText(
  ctx: CanvasRenderingContext2D,
  item: Drawing.Item,
  points: Point[],
  context: RenderContext,
) {
  if (!("text" in item)) return;
  const text = item.text?.trim();
  if (!text || points.length < 2) return;

  const segment = textSegment(item, points, context.area);
  if (!segment) return;

  const { start, end } = segment;
  const rawAngle = Math.atan2(end.y - start.y, end.x - start.x);
  const angle =
    rawAngle > Math.PI / 2
      ? rawAngle - Math.PI
      : rawAngle < -Math.PI / 2
        ? rawAngle + Math.PI
        : rawAngle;
  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };

  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(angle);
  ctx.fillStyle = item.style.textColor;
  ctx.font = `${item.style.fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(text, 0, -5);
  ctx.restore();
}

function textSegment(
  item: Drawing.Item,
  points: Point[],
  area: RenderContext["area"],
): { start: Point; end: Point } | null {
  if (points.length < 2) return null;
  const start = points[0]!;
  const end = points[1]!;

  if (item.type === "trend_line") {
    return visibleFiniteSegment(start, end, area) ?? { start, end };
  }
  if (item.type === "ray") {
    return visibleRaySegment(start, end, area);
  }
  if (item.type === "extended_line") {
    return visibleExtendedSegment(start, end, area);
  }
  if (item.type === "parallel_channel") {
    return segmentAcrossArea(start, end, area) ?? { start, end };
  }

  return { start, end };
}

/** Draws selection handles, restoring its local canvas changes.
 * @example drawHandles(ctx, points, item.style.lineColor);
 */
export function drawHandles(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
