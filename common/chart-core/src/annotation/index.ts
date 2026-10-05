// Purpose: Barrel export for chart annotation domain types and renderer
// Module:  @openchart/chart-core / annotation

export { ChartAnnotation } from "./types";
export { createDraftAnnotationRecord } from "./draft";
export {
  hitChartAnnotationPlacements,
  hitChartAnnotations,
  hitFromPlacement,
  orderChartAnnotationPlacementsForHit,
} from "./hit";
export {
  createChartAnnotationLayoutState,
  expandChartAnnotationPlacements,
  leaderBoundaryPoint,
  layoutChartAnnotations,
  previewChartAnnotationDragPlacements,
  translateChartAnnotationPlacements,
} from "./layout";
export {
  annotationSourceBadgeImagesReady,
  paintChartAnnotationPlacements,
  paintChartAnnotationOccupancyMap,
  preloadAnnotationSourceBadgeImages,
  renderChartAnnotations,
} from "./render";
export {
  resolveAgentAnnotationAccentColor,
  resolveAgentAnnotationStyle,
  sourceBadgeColor,
  sourceBadgeText,
} from "./appearance";
export type { ChartAnnotationHit } from "./hit";
export type {
  AnnotationPlacement,
  ChartAnnotationLayoutInput,
  ChartAnnotationLayoutState,
  ChartAnnotationOccupancySnapshot,
  ChartAnnotationTranslatedLayoutInput,
} from "./layout";
export type { ChartAnnotationRenderInput } from "./render";
export type {
  AnnotationExpandedCardContent,
  AnnotationSourceBadge,
} from "./appearance";
