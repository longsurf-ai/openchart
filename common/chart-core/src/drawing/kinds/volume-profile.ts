// Purpose: Rendering, hit testing, and attributes for fixed-range volume profile drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
} from "@openchart/chart-core/drawing/shared";
import { drawLine } from "@openchart/chart-core/drawing/canvas";
import { Color } from "@openchart/chart-core/util";

/**
 * The range's edges as full-height lines, with a faint band between them while
 * selected; the profile itself is a separate chart object. Only the edges hit,
 * so dragging inside the range still pans the chart.
 */
export const volumeProfile: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context, isSelected) {
    const { area } = context;
    const [start, end] = points;
    if (!start || !end) return;
    if (isSelected) {
      ctx.save();
      ctx.fillStyle = Color.withAlpha(item.style.lineColor, 0.08);
      ctx.fillRect(
        Math.min(start.x, end.x),
        area.y,
        Math.abs(end.x - start.x),
        area.height,
      );
      ctx.restore();
    }
    for (const edge of [start, end])
      drawLine(
        ctx,
        { x: edge.x, y: area.y },
        { x: edge.x, y: area.y + area.height },
      );
  },
  hitTest(_item, points, context) {
    const { area } = context;
    const distances = points
      .slice(0, 2)
      .flatMap((edge) =>
        HitTest.vertical(
          context.mouse.x,
          context.mouse.y,
          edge.x,
          area.y,
          area.y + area.height,
        )
          ? [Math.abs(context.mouse.x - edge.x)]
          : [],
      );
    return distances.length ? { distance: Math.min(...distances) } : null;
  },
};
