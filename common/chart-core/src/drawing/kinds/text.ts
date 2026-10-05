// Purpose: Rendering, hit testing, and attributes for text drawings
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import type { DrawingDefinition } from "@openchart/chart-core/drawing/shared";
import { drawText } from "@openchart/chart-core/drawing/canvas";

function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
): { width: number; height: number } {
  ctx.font = `${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const height = fontSize * 1.2;
  return { width: metrics.width, height };
}

/** Attributes and canvas behavior for text drawings. */
export const text: DrawingDefinition = {
  attributes: {
    toolbar: ["fontColor", "fontSize"],
    modal: {
      Style: ["fontColor", "fontSize"],
      Text: ["text"],
    },
  },
  render(ctx, item, points) {
    if (item.type !== "text") return;
    const p = points[0]!;
    drawText(ctx, p, item.text, item.style.textColor, item.style.fontSize);
  },
  hitTest(item, points, context, canvas) {
    if (item.type !== "text") return null;
    const p = points[0];
    if (!p) return null;
    const metrics = measureText(canvas, item.text ?? "", item.style.fontSize);
    const inside = HitTest.rect(
      context.mouse.x,
      context.mouse.y,
      p.x,
      p.y,
      metrics.width,
      metrics.height,
    );
    return inside ? { distance: 0 } : null;
  },
};
