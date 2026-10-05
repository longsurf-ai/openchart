// Purpose: Rendering, hit testing, and attributes for ellipse drawings
// Module:  @openchart/chart-core / drawing

import type {
  DrawingDefinition,
  Point,
} from "@openchart/chart-core/drawing/shared";

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  fill?: string,
) {
  const x = (p1.x + p2.x) / 2;
  const y = (p1.y + p2.y) / 2;
  const rx = Math.abs(p1.x - p2.x) / 2;
  const ry = Math.abs(p1.y - p2.y) / 2;
  if (rx <= 0 || ry <= 0) return;

  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.stroke();
}

/** Attributes and canvas behavior for ellipse drawings. */
export const ellipse: DrawingDefinition = {
  attributes: {
    toolbar: ["stroke", "fill", "width", "lineStyle"],
    modal: { Style: ["stroke", "fill", "width", "lineStyle"], Text: [] },
  },
  render(ctx, item, points) {
    if (points.length < 2) return;
    drawEllipse(ctx, points[0]!, points[1]!, item.style.fillColor);
  },
  hitTest(_item, points, context) {
    if (points.length < 2) return null;
    const p1 = points[0]!;
    const p2 = points[1]!;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p1.x - p2.x);
    const h = Math.abs(p1.y - p2.y);
    const rx = w / 2;
    const ry = h / 2;
    if (rx <= 0 || ry <= 0) return null;
    const cx = x + rx;
    const cy = y + ry;
    const dx = (context.mouse.x - cx) / rx;
    const dy = (context.mouse.y - cy) / ry;
    const inside = dx * dx + dy * dy <= 1.1;
    return inside ? { distance: 0 } : null;
  },
};
