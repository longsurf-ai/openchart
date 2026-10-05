// Purpose: Rendering, hit testing, and attributes for curved line drawings
// Module:  @openchart/chart-core / drawing

import {
  BASIC_LINE_STYLE,
  ATTACHED_TEXT_STYLE,
  type DrawingDefinition,
} from "@openchart/chart-core/drawing/shared";
import { projectDrawingBoundary } from "@openchart/chart-core/drawing/boundary";
import { boundaryDistance } from "@openchart/chart-core/drawing/boundary-labels";
import {
  drawBoundary,
  drawLineText,
} from "@openchart/chart-core/drawing/canvas";

/** Attributes and canvas behavior for curved line drawings. */
export const curvedLine: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: ATTACHED_TEXT_STYLE },
  },
  render(ctx, item, points, context) {
    drawBoundary(ctx, projectDrawingBoundary(item, points));
    drawLineText(ctx, item, points, context);
  },
  hitTest(item, points, context) {
    const primitive = projectDrawingBoundary(item, points)?.primitives[0];
    if (!primitive) return null;
    const distance = boundaryDistance(primitive, context.mouse);
    return distance <= 5 ? { distance } : null;
  },
};
