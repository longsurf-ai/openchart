// Purpose: Shared drawing hit-test lifecycle: reverse order, anchor projection, and handles before bodies
// Module:  @openchart/chart-core / drawing

import { HitTest } from "@openchart/chart-core/hit";
import type { Drawing } from "./types";
import type { Point, HitContext } from "./shared";
import { anchorToPoint, handlePoints } from "./geometry";
import { DRAWING_REGISTRY } from "./registry";

export type DrawingHit = {
  id: string;
  part: "handle" | "body";
  handleIndex?: number;
  distance: number;
};

/** Finds the topmost visible drawing hit, checking handles before its body.
 * Drafts are excluded; absent state or no hit returns null. Text hit testing
 * uses the caller's canvas for font measurement.
 * @example const hit = hitTestDrawings(input, context, ctx);
 */
export function hitTestDrawings(
  state: Drawing.RenderInput | undefined,
  context: HitContext,
  canvas: CanvasRenderingContext2D,
): DrawingHit | null {
  const items = state?.items ?? [];
  if (items.length === 0) return null;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.hidden) continue;
    const definition = DRAWING_REGISTRY[item.type];
    if ("layer" in definition) continue;
    const projected = item.anchors.map((a) =>
      anchorToPoint(a, context, item.type),
    );
    // A missing interior anchor must not silently connect its neighbours.
    if (projected.some((point) => point === null)) continue;
    const points = projected as Point[];
    if (points.length === 0) continue;

    if (item.type !== "freehand") {
      const handles = handlePoints(item, context);
      for (let h = 0; h < handles.length; h++) {
        const p = handles[h]!;
        const hit = HitTest.point(
          context.mouse.x,
          context.mouse.y,
          p.x,
          p.y,
          6,
        );
        if (hit.hit) {
          return {
            id: item.id,
            part: "handle",
            handleIndex: h,
            distance: hit.distance,
          };
        }
      }
    }

    const body = definition.hitTest(item, points, context, canvas);
    if (body) return { id: item.id, part: "body", distance: body.distance };
  }

  return null;
}
