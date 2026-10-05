// Purpose: Public barrel export for the drawing module
// Module:  @openchart/chart-core / drawing

export { Drawing } from "./types";
export {
  drawingBoundary,
  resolveBoundary,
  type BoundaryX,
  type BoundaryPoint,
  type BoundaryPrimitive,
  type DrawingBoundary,
  type ResolvedBoundaryPrimitive,
  type ResolvedDrawingBoundary,
} from "./boundary";
export {
  attributesForType,
  type AttributeKey,
  type DrawingAttributeSchema,
  type ModalSchema,
  type ModalTabName,
  type ToolbarSchema,
} from "./attributes";
export {
  renderDrawings,
  type RenderContext,
  type DrawingOverlayLabel,
  DrawingRenderUtils,
} from "./render";
export { hitTestDrawings, type DrawingHit } from "./hit";
