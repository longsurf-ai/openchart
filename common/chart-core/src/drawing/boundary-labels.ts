// Purpose: Exact finite-path label positions and pointer branch selection in pixel space
// Module:  @openchart/chart-core / drawing

import type {
  ResolvedBoundaryPrimitive,
  ResolvedDrawingBoundary,
} from "./boundary";
import type { LineLabelPlacement, Point, RenderContext } from "./shared";

// These tolerances are for pixel-space UI root deduplication, never alert predicates.
const PARAMETER_TOLERANCE = 1e-10;

function roots(a: number, b: number, c: number): number[] {
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  if (discriminant === 0) return [-b / (2 * a)];
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
  return [q / a, c / q];
}

function coefficients(primitive: ResolvedBoundaryPrimitive) {
  const { start, end } = primitive;
  const control = primitive.kind === "quadratic" ? primitive.control : null;
  return {
    a: control
      ? {
          x: start.x - 2 * control.x + end.x,
          y: start.y - 2 * control.y + end.y,
        }
      : { x: 0, y: 0 },
    b: control
      ? { x: 2 * (control.x - start.x), y: 2 * (control.y - start.y) }
      : { x: end.x - start.x, y: end.y - start.y },
    c: start,
  };
}

function pointAt(primitive: ResolvedBoundaryPrimitive, t: number): Point {
  const { a, b, c } = coefficients(primitive);
  return { x: (a.x * t + b.x) * t + c.x, y: (a.y * t + b.y) * t + c.y };
}

function sortedParameters(values: number[], from = 0, to = 1): number[] {
  return values
    .filter((t) => t >= from && t <= to && Number.isFinite(t))
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t - all[i - 1]! > PARAMETER_TOLERANCE);
}

function readableAngle(dx: number, dy: number): number {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
}

/** Finds plot-centre-X positions on actual visible path branches and their tangents.
 * Closed paths are already explicit; no control-polygon or hidden closing edge is used.
 * If centre X misses visible geometry, candidates use the closest visible X instead.
 * Curve clipping/root solving only affects display, never the alert condition.
 * @example const labels = boundaryLabelPlacements(path, context.area);
 */
export function boundaryLabelPlacements(
  path: ResolvedDrawingBoundary,
  area: RenderContext["area"],
): LineLabelPlacement[] {
  const centerX = area.x + area.width / 2;
  const inside = (point: Point) =>
    point.x >= area.x - PARAMETER_TOLERANCE &&
    point.x <= area.x + area.width + PARAMETER_TOLERANCE &&
    point.y >= area.y - PARAMETER_TOLERANCE &&
    point.y <= area.y + area.height + PARAMETER_TOLERANCE;
  const candidates: LineLabelPlacement[] = [];
  for (const primitive of path.primitives) {
    const { a, b, c } = coefficients(primitive);
    // Clip in parameter space and split at X extrema so every visible part is monotone.
    const breaks = sortedParameters([
      0,
      1,
      ...roots(a.x, b.x, c.x - area.x),
      ...roots(a.x, b.x, c.x - area.x - area.width),
      ...roots(a.y, b.y, c.y - area.y),
      ...roots(a.y, b.y, c.y - area.y - area.height),
      ...(a.x === 0 ? [] : [-b.x / (2 * a.x)]),
    ]);
    for (let i = 1; i < breaks.length; i++) {
      const from = breaks[i - 1]!;
      const to = breaks[i]!;
      if (!inside(pointAt(primitive, (from + to) / 2))) continue;
      const start = pointAt(primitive, from);
      const end = pointAt(primitive, to);
      const targetX = Math.max(
        Math.min(start.x, end.x),
        Math.min(centerX, Math.max(start.x, end.x)),
      );
      const t =
        a.x === 0 && b.x === 0
          ? (from + to) / 2
          : roots(a.x, b.x, c.x - targetX).find(
              (value) =>
                value >= from - PARAMETER_TOLERANCE &&
                value <= to + PARAMETER_TOLERANCE,
            );
      if (t === undefined) continue;
      const boundedT = Math.max(from, Math.min(to, t));
      const point = pointAt(primitive, boundedT);
      let dx = 2 * a.x * boundedT + b.x;
      let dy = 2 * a.y * boundedT + b.y;
      // A stationary/retracing quadratic still has a limiting tangent.
      if (dx === 0 && dy === 0) {
        dx = a.x;
        dy = a.y;
      }
      candidates.push({
        ...point,
        angle: readableAngle(dx, dy),
        boundary: { primitive, from, to },
      });
    }
  }
  const nearestX = Math.min(
    ...candidates.map((point) => Math.abs(point.x - centerX)),
  );
  return candidates.filter(
    (point) => Math.abs(point.x - centerX) <= nearestX + PARAMETER_TOLERANCE,
  );
}

/** Pointer distance to the finite painted branch associated with a label.
 * Quadratic distance solves the cubic stationary-point equation on the clipped branch;
 * it does not use a control polygon. Legacy line/channel candidates retain line distance.
 * @example const nearest = labels.toSorted((a, b) => labelPlacementDistance(a, mouse) - labelPlacementDistance(b, mouse))[0];
 */
export function labelPlacementDistance(
  label: LineLabelPlacement,
  near: Point,
): number {
  const source = label.boundary;
  if (!source) {
    const angle = (label.angle * Math.PI) / 180;
    return Math.abs(
      (near.x - label.x) * Math.sin(angle) -
        (near.y - label.y) * Math.cos(angle),
    );
  }
  const { primitive, from, to } = source;
  return boundaryDistance(primitive, near, from, to);
}

/** Minimum pixel distance to a finite line/quadratic or its parameter interval.
 * Used by pointer hit tests and branch selection; not an alert tolerance.
 * @example const hit = boundaryDistance(curve, mouse) <= 5;
 */
export function boundaryDistance(
  primitive: ResolvedBoundaryPrimitive,
  near: Point,
  from = 0,
  to = 1,
): number {
  const { a, b, c } = coefficients(primitive);
  const offset = { x: c.x - near.x, y: c.y - near.y };
  const dot = (p: Point, q: Point) => p.x * q.x + p.y * q.y;
  const c3 = 2 * dot(a, a);
  const c2 = 3 * dot(a, b);
  const c1 = dot(b, b) + 2 * dot(a, offset);
  const c0 = dot(b, offset);
  const evaluate = (t: number) => ((c3 * t + c2) * t + c1) * t + c0;
  const parameters = [from, to];
  if (c3 === 0) {
    parameters.push(...roots(c2, c1, c0).filter((t) => t >= from && t <= to));
  } else {
    const critical = sortedParameters(
      [from, to, ...roots(3 * c3, 2 * c2, c1)],
      from,
      to,
    );
    parameters.push(...critical);
    for (let i = 1; i < critical.length; i++) {
      let left = critical[i - 1]!;
      let right = critical[i]!;
      const leftValue = evaluate(left);
      if (Math.sign(leftValue) === Math.sign(evaluate(right))) continue;
      // Bisection of a monotone cubic interval, to pixel precision.
      for (let step = 0; step < 48; step++) {
        const middle = (left + right) / 2;
        if (Math.sign(evaluate(middle)) === Math.sign(leftValue)) left = middle;
        else right = middle;
      }
      parameters.push((left + right) / 2);
    }
  }
  return Math.min(
    ...parameters.map((t) => {
      const point = pointAt(primitive, t);
      return Math.hypot(point.x - near.x, point.y - near.y);
    }),
  );
}
