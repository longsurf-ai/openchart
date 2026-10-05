// Purpose: Rendering, hit testing, and attributes for fib retracement drawings
// Module:  @openchart/chart-core / drawing

import { CoordSys } from "@openchart/chart-core/coord";
import { Color } from "@openchart/chart-core/util";
import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
} from "@openchart/chart-core/drawing/shared";
import { drawLine, drawText } from "@openchart/chart-core/drawing/canvas";
import { FIB_RETRACEMENT_LEVELS } from "@openchart/chart-core/drawing/geometry";

function formatPrice(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

/** Attributes and canvas behavior for fib retracement drawings. */
export const fibRetracement: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context, isSelected, overlays) {
    if (points.length < 2) return;
    const p1 = points[0]!;
    const p2 = points[1]!;
    const area = context.area;
    const lineColor = item.style.lineColor;

    const scaleId = item.anchors[0]?.axisId ?? context.coord.defaultYScale;
    const scale =
      context.coord.scales.y[scaleId] ??
      Object.values(context.coord.scales.y)[0];

    const leftX = Math.min(p1.x, p2.x);
    const rightEdge = area.x + area.width;

    // 1. Shaded fill between level 0 and level 1
    const y0 = p1.y;
    const y1 = p2.y;
    ctx.fillStyle = Color.withAlpha(lineColor, 0.08);
    ctx.fillRect(leftX, Math.min(y0, y1), rightEdge - leftX, Math.abs(y1 - y0));

    // 2. Level lines from left control point to right edge + text labels
    for (const level of FIB_RETRACEMENT_LEVELS) {
      const y = p1.y + (p2.y - p1.y) * level;
      drawLine(ctx, { x: leftX, y }, { x: rightEdge, y });

      if (scale) {
        const price = CoordSys.toValue(y, scale);
        const label = `${level} (${formatPrice(price)})`;
        drawText(ctx, { x: leftX + 4, y: y - 14 }, label, lineColor, 11);
      }
    }

    // 3. Dashed connector between the two control points
    ctx.save();
    ctx.setLineDash([6, 4]);
    drawLine(ctx, p1, p2);
    ctx.restore();

    // 4. Overlay labels for y-axis price tags when selected (top and bottom only)
    if (isSelected && scale) {
      for (const level of [0, 1]) {
        const y = p1.y + (p2.y - p1.y) * level;
        const price = CoordSys.toValue(y, scale);
        overlays.push({ y, price, color: lineColor, axisId: scaleId });
      }
    }
  },
  hitTest(_item, points, context) {
    const area = context.area;
    if (points.length < 2) return null;
    const p1 = points[0]!;
    const p2 = points[1]!;
    const leftX = Math.min(p1.x, p2.x);
    const rightEdge = area.x + area.width;
    for (const level of FIB_RETRACEMENT_LEVELS) {
      const y = p1.y + (p2.y - p1.y) * level;
      const hit = HitTest.horizontal(
        context.mouse.x,
        context.mouse.y,
        y,
        leftX,
        rightEdge,
      );
      if (hit) return { distance: Math.abs(context.mouse.y - y) };
    }
    // Dashed connector line between control points
    const connectorHit = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      p1.x,
      p1.y,
      p2.x,
      p2.y,
    );
    if (connectorHit.hit) return { distance: connectorHit.distance };
    return null;
  },
};
