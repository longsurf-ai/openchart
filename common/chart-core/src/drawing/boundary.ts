// Purpose: Canonical finite drawing paths shared by canvas painting and Tea lowering
// Module:  @openchart/chart-core / drawing

import type { Drawing } from "./types";
import type { Point } from "./shared";

/** Logical X construction; interpolation happens after resolving the anchor timeline. */
export type BoundaryX =
  | { kind: "anchor"; index: number }
  | { kind: "lerp"; from: number; to: number; ratio: number };

/** A data-price point with an ordinal-X recipe, never a persisted pixel coordinate. */
export type BoundaryPoint = { x: BoundaryX; price: number };

type Primitive<P> =
  | { kind: "line"; index: number; start: P; end: P }
  | { kind: "quadratic"; index: number; start: P; control: P; end: P };

/** Stable path-order index, including the final closing edge for closed paths. */
export type BoundaryPrimitive = Primitive<BoundaryPoint>;

/** One ordered path. Closure is explicit and its edge is included in primitives. */
export type DrawingBoundary = {
  closed: boolean;
  primitives: readonly BoundaryPrimitive[];
};

/** Numerically resolved primitive in the caller's logical or pixel coordinate space. */
export type ResolvedBoundaryPrimitive = Primitive<Point>;

/** A resolved path owned by the caller; never stored in Drawing or Rule resources. */
export type ResolvedDrawingBoundary = {
  closed: boolean;
  primitives: readonly ResolvedBoundaryPrimitive[];
};

/** Derives finite boundary recipes without sorting, simplifying or closing open strokes.
 * Unsupported kinds and incomplete drafts return null. Anchor prices are retained;
 * triangle's apex uses the ordinal midpoint and its higher price, not a third anchor.
 * @example const boundary = drawingBoundary(item);
 */
export function drawingBoundary(item: Drawing.Item): DrawingBoundary | null {
  const anchor = (index: number): BoundaryPoint => ({
    x: { kind: "anchor", index },
    price: item.anchors[index]!.price,
  });
  const lines = (points: BoundaryPoint[], closed: boolean): DrawingBoundary => {
    const count = closed ? points.length : points.length - 1;
    return {
      closed,
      primitives: Array.from({ length: count }, (_, index) => ({
        kind: "line",
        index,
        start: points[index]!,
        end: points[(index + 1) % points.length]!,
      })),
    };
  };
  switch (item.type) {
    case "freehand":
    case "polyline":
      return item.anchors.length < 2
        ? null
        : lines(
            item.anchors.map((_, index) => anchor(index)),
            false,
          );
    case "rectangle": {
      if (item.anchors.length < 2) return null;
      const a = anchor(0);
      const b = anchor(1);
      return lines(
        [a, { x: b.x, price: a.price }, b, { x: a.x, price: b.price }],
        true,
      );
    }
    case "triangle": {
      if (item.anchors.length < 2) return null;
      const a = anchor(0);
      const b = anchor(1);
      const base = Math.min(a.price, b.price);
      return lines(
        [
          {
            x: { kind: "lerp", from: 0, to: 1, ratio: 0.5 },
            price: Math.max(a.price, b.price),
          },
          { x: b.x, price: base },
          { x: a.x, price: base },
        ],
        true,
      );
    }
    case "curved_line":
      return item.anchors.length < 3
        ? null
        : {
            closed: false,
            primitives: [
              {
                kind: "quadratic",
                index: 0,
                start: anchor(0),
                control: anchor(1),
                end: anchor(2),
              },
            ],
          };
    default:
      return null;
  }
}

/** Resolves a recipe using one current X frame and the caller's price projection.
 * Returns null for missing/nonfinite coordinates instead of connecting across them.
 * Neither the input recipes nor the supplied anchor coordinates are changed.
 * @example resolveBoundary(boundary, anchorIndexes, price => price);
 */
export function resolveBoundary(
  boundary: DrawingBoundary,
  anchorXs: readonly number[],
  priceToY: (price: number) => number,
): ResolvedDrawingBoundary | null {
  const point = (recipe: BoundaryPoint): Point => ({
    x:
      recipe.x.kind === "anchor"
        ? anchorXs[recipe.x.index]!
        : anchorXs[recipe.x.from]! +
          (anchorXs[recipe.x.to]! - anchorXs[recipe.x.from]!) * recipe.x.ratio,
    y: priceToY(recipe.price),
  });
  const primitives: ResolvedBoundaryPrimitive[] = boundary.primitives.map(
    (primitive) => {
      const endpoints = {
        index: primitive.index,
        start: point(primitive.start),
        end: point(primitive.end),
      };
      return primitive.kind === "quadratic"
        ? { ...endpoints, kind: "quadratic", control: point(primitive.control) }
        : { ...endpoints, kind: "line" };
    },
  );
  const valid = primitives.every((primitive) =>
    [
      primitive.start,
      primitive.end,
      ...(primitive.kind === "quadratic" ? [primitive.control] : []),
    ].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  return valid ? { closed: boundary.closed, primitives } : null;
}

/** Resolves a finite path from its already projected anchors, keeping canvas and
 * Tea path construction identical. Current recipes only reuse anchor prices.
 * Missing anchors return null; they must never be removed and reconnected.
 * @example const path = projectDrawingBoundary(item, projectedAnchors);
 */
export function projectDrawingBoundary(
  item: Drawing.Item,
  points: readonly Point[],
): ResolvedDrawingBoundary | null {
  const boundary = drawingBoundary(item);
  if (!boundary || points.length !== item.anchors.length) return null;
  const prices = new Map(
    item.anchors.map((anchor, index) => [anchor.price, points[index]!.y]),
  );
  return resolveBoundary(
    boundary,
    points.map((point) => point.x),
    (price) => prices.get(price)!,
  );
}
