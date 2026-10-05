// Purpose: Rendering, hit testing, and attributes for circle drawings
// Module:  @openchart/chart-core / drawing

import type {
  DrawingDefinition,
  Point,
} from "@openchart/chart-core/drawing/shared";

function drawCircle(
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  fill?: string,
) {
  const x = (p1.x + p2.x) / 2;
  const y = (p1.y + p2.y) / 2;
  const r = Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y)) / 2;
  if (r <= 0) return;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.stroke();
}

/** Attributes and canvas behavior for circle drawings. */
export const circle: DrawingDefinition = {
  attributes: {
    toolbar: ["stroke", "fill", "width", "lineStyle"],
    modal: { Style: ["stroke", "fill", "width", "lineStyle"], Text: [] },
  },
  render(ctx, item, points) {
    if (points.length < 2) return;
    drawCircle(ctx, points[0]!, points[1]!, item.style.fillColor);
  },
  hitTest(_item, points, context) {
    if (points.length < 2) return null;
    const p1 = points[0]!;
    const p2 = points[1]!;
    const w = Math.abs(p1.x - p2.x);
    const h = Math.abs(p1.y - p2.y);
    const r = Math.max(w, h) / 2;
    if (r <= 0) return null;
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const inside = Math.hypot(context.mouse.x - cx, context.mouse.y - cy) <= r;
    return inside ? { distance: 0 } : null;
  },
};
