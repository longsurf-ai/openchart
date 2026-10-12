// Purpose: Find complete shared widget edges and resize both rectangles without changing their outer bounds.
import type { Layout, LayoutItem } from "react-grid-layout";

/** Two placements sharing their entire vertical or horizontal edge, ordered left/right or top/bottom. */
export interface SharedBoundary {
  readonly before: string;
  readonly after: string;
  readonly orientation: "vertical" | "horizontal";
}

/**
 * Find complete shared edges independently of widget kind. Partial edges and T junctions
 * retain ordinary widget resizing. Reads only geometry and allocates no placement IDs.
 * This owns no I/O or resources needing cleanup.
 * @example
 * sharedBoundaries([
 *   { i: "left", x: 0, y: 0, w: 6, h: 24 },
 *   { i: "right", x: 6, y: 0, w: 6, h: 24 },
 * ]); // One vertical boundary, ordered left to right.
 */
export function sharedBoundaries(layout: Layout): SharedBoundary[] {
  const result: SharedBoundary[] = [];
  for (const before of layout) {
    for (const after of layout) {
      if (
        before.x + before.w === after.x &&
        before.y === after.y &&
        before.h === after.h
      )
        result.push({
          before: before.i,
          after: after.i,
          orientation: "vertical",
        });
      if (
        before.y + before.h === after.y &&
        before.x === after.x &&
        before.w === after.w
      )
        result.push({
          before: before.i,
          after: after.i,
          orientation: "horizontal",
        });
    }
  }
  return result;
}

/**
 * Return the allowed grid-step movement from both placements' minimum and maximum
 * sizes. Pure geometry shared by resizing and accessible separator values, with
 * no I/O or cleanup. An inverted range means the size constraints cannot be met.
 * @example
 * sharedBoundaryLimits(
 *   { i: "left", x: 0, y: 0, w: 6, h: 24, minW: 4 },
 *   { i: "right", x: 6, y: 0, w: 6, h: 24, minW: 3 },
 *   "vertical",
 * ); // { min: -2, max: 3 }
 */
export function sharedBoundaryLimits(
  before: LayoutItem,
  after: LayoutItem,
  orientation: SharedBoundary["orientation"],
): { min: number; max: number } {
  const vertical = orientation === "vertical";
  const size = vertical ? "w" : "h";
  const min = vertical ? "minW" : "minH";
  const max = vertical ? "maxW" : "maxH";
  return {
    min: Math.max(
      (before[min] ?? 1) - before[size],
      after[size] - (after[max] ?? Infinity),
    ),
    max: Math.min(
      (before[max] ?? Infinity) - before[size],
      after[size] - (after[min] ?? 1),
    ),
  };
}

/**
 * Clamp an integer edge movement to both widgets' size limits, preserving the pair's
 * outer bounds and every other rectangle. Returns the input if either placement is
 * missing or no movement is possible, including incompatible size constraints;
 * does not compact, mutate, perform I/O or acquire resources needing cleanup.
 * @example
 * const layout = [
 *   { i: "left", x: 0, y: 0, w: 6, h: 24, minW: 4 },
 *   { i: "right", x: 6, y: 0, w: 6, h: 24, minW: 3 },
 * ];
 * resizeSharedBoundary(layout, sharedBoundaries(layout)[0]!, 1);
 * // Widths become 7 and 5; the right placement moves to x = 7.
 */
export function resizeSharedBoundary(
  layout: Layout,
  boundary: SharedBoundary,
  delta: number,
): Layout {
  const before = layout.find((item) => item.i === boundary.before);
  const after = layout.find((item) => item.i === boundary.after);
  if (!before || !after) return layout;
  const vertical = boundary.orientation === "vertical";
  const size = vertical ? "w" : "h";
  const position = vertical ? "x" : "y";
  const { min, max } = sharedBoundaryLimits(
    before,
    after,
    boundary.orientation,
  );
  if (min > max) return layout;
  const movement = Math.max(min, Math.min(Math.round(delta), max));
  if (!movement) return layout;
  return layout.map((item): LayoutItem => {
    if (item.i === before.i) return { ...item, [size]: item[size] + movement };
    if (item.i === after.i)
      return {
        ...item,
        [position]: item[position] + movement,
        [size]: item[size] - movement,
      };
    return item;
  });
}
