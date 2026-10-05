// Purpose: Shared drawing render lifecycle: projection, clipping, styles, ordering, and handles
// Module:  @openchart/chart-core / drawing

import { Drawing } from "./types";
import type {
  Point,
  RenderContext,
  DrawingOverlayLabel,
  LineLabelPlacement,
} from "./shared";
import {
  anchorToPoint,
  handlePoints,
  indexFromTime,
  lineIntersections,
  segmentAcrossArea,
  offsetFromLine,
  lineLabelPlacements,
} from "./geometry";
import { setLineDash, drawHandles } from "./canvas";
import { DRAWING_REGISTRY } from "./registry";

export type { RenderContext, DrawingOverlayLabel } from "./shared";

/** Renders visible items and the draft, restoring canvas state after each item.
 * Returns selected drawings' axis labels; absent state produces no drawing work.
 * A caller-owned map may collect line label placements; the caller resets it per paint.
 * @example const labels = renderDrawings(ctx, input, context);
 */
export function renderDrawings(
  ctx: CanvasRenderingContext2D,
  state: Drawing.RenderInput | undefined,
  context: RenderContext,
  labelPlacements?: Map<string, readonly LineLabelPlacement[]>,
): DrawingOverlayLabel[] {
  const overlays: DrawingOverlayLabel[] = [];
  if (!state) return overlays;

  const items: Drawing.Item[] = [...(state.items ?? [])];
  if (state.draft) items.push(state.draft);

  for (const item of items) {
    if (item.hidden) continue;
    const definition = DRAWING_REGISTRY[item.type];
    if ("layer" in definition) continue;
    const projected = item.anchors.map((a) =>
      anchorToPoint(a, context, item.type),
    );
    // A missing interior anchor must not silently connect its neighbours.
    if (projected.some((point) => point === null)) continue;
    const points = projected as Point[];
    if (points.length === 0 && Drawing.requiredAnchors(item.type) > 0) continue;
    if (labelPlacements && item !== state.draft) {
      const placements = lineLabelPlacements(item, points, context.area);
      if (placements.length) labelPlacements.set(item.id, placements);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      context.area.x,
      context.area.y,
      context.area.width,
      context.area.height,
    );
    ctx.clip();
    ctx.globalAlpha = item.style.opacity;
    ctx.strokeStyle = item.style.lineColor;
    ctx.lineWidth = item.style.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const isDraft = state.draft?.id === item.id;
    setLineDash(
      ctx,
      isDraft && item.type !== "freehand" ? "dashed" : item.style.lineStyle,
    );

    definition.render(
      ctx,
      item,
      points,
      context,
      state.selectedId === item.id,
      overlays,
    );

    if (shouldShowDrawingHandles(item, state)) {
      const handles = handlePoints(item, context);
      drawHandles(ctx, handles, item.style.lineColor);
    }
    ctx.restore();
  }

  return overlays;
}

function shouldShowDrawingHandles(
  item: Drawing.Item,
  state: Drawing.State,
): boolean {
  return (
    item.type !== "freehand" &&
    item.anchors.length > 0 &&
    (state.selectedId === item.id ||
      state.hoveredId === item.id ||
      state.draft?.id === item.id)
  );
}

/** Shared geometry functions retained for chart interaction callers. */
export const DrawingRenderUtils = {
  indexFromTime,
  anchorToPoint,
  handlePoints,
  lineIntersections,
  segmentAcrossArea,
  offsetFromLine,
};
