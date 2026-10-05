// Purpose: Rendering, hit testing, and attributes for freehand drawings
// Module:  @openchart/chart-core / drawing

import {
  BASIC_LINE_STYLE,
  type DrawingDefinition,
} from "@openchart/chart-core/drawing/shared";
import { projectDrawingBoundary } from "@openchart/chart-core/drawing/boundary";
import { hitPolyline } from "@openchart/chart-core/drawing/geometry";
import {
  drawBoundary,
  drawLineText,
} from "@openchart/chart-core/drawing/canvas";

/** Attributes and canvas behavior for freehand drawings. */
export const freehand: DrawingDefinition = {
  attributes: {
    toolbar: BASIC_LINE_STYLE,
    modal: { Style: BASIC_LINE_STYLE, Text: [] },
  },
  render(ctx, item, points, context) {
    drawBoundary(ctx, projectDrawingBoundary(item, points));
    drawLineText(ctx, item, points, context);
  },
  hitTest(_item, points, context) {
    return hitPolyline(points, context);
  },
};
