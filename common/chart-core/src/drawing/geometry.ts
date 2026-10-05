// Purpose: Shared anchor projection and geometry for drawing renderers, hit tests, and interactions
// Module:  @openchart/chart-core / drawing

import { CoordSys } from "@openchart/chart-core/coord";
import { Data } from "@openchart/chart-core/data/schema";
import { HitTest } from "@openchart/chart-core/hit";
import { projectDrawingBoundary } from "./boundary";
import { boundaryLabelPlacements } from "./boundary-labels";
import type { Drawing } from "./types";
import type {
  Point,
  RenderContext,
  HitContext,
  LineLabelPlacement,
} from "./shared";

type Intersection = Point & { t: number };

/** Authoritative Fibonacci ratios shared by painting, hit testing and alert derivation. */
export const FIB_RETRACEMENT_LEVELS = [
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1,
] as const;
/** Parallel offsets from the base line, in units of the third anchor's distance. */
export const FIB_CHANNEL_LEVELS = [0, 0.382, 0.618, 1] as const;

function pointInsideArea(p: Point, area: RenderContext["area"]): boolean {
  return (
    p.x >= area.x &&
    p.x <= area.x + area.width &&
    p.y >= area.y &&
    p.y <= area.y + area.height
  );
}

// Drawing anchors are continuous epoch seconds. Legacy line tools snap to the
// nearest loaded bar; finite boundaries interpolate. Neither clamps to an edge.
/** Resolves continuous anchor time to the nearest loaded bar, or null outside the range.
 * @example indexFromTime([{ time: 1 }, { time: 3 }], 2);
 */
export function indexFromTime(data: unknown[], time: unknown): number | null {
  if (data.length === 0) return null;
  const firstTime = (data[0] as { time?: unknown } | undefined)?.time;
  const lastTime = (data[data.length - 1] as { time?: unknown } | undefined)
    ?.time;
  if (typeof firstTime !== "number" || typeof lastTime !== "number") {
    return null;
  }

  const target = Data.readTime(time);
  if (target === undefined) return null;
  if (target < firstTime || target > lastTime) return null;

  // Bar data is time-ascending; binary-search the insertion point.
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const midTime = (data[mid] as { time?: unknown }).time;
    if (typeof midTime !== "number") return null;
    if (midTime < target) lo = mid + 1;
    else hi = mid;
  }
  const atTime = (data[lo] as { time: number }).time;
  if (lo === 0) return 0;
  const prevTime = (data[lo - 1] as { time?: unknown }).time;
  if (typeof prevTime !== "number") return lo;
  return target - prevTime <= atTime - target ? lo - 1 : lo;
}

/** Finite boundary kinds preserve fractional X while their anchors become historical.
 * Legacy line/channel/Fibonacci tools retain their existing nearest-bar placement.
 * @example continuousDrawingTime("freehand");
 */
export function continuousDrawingTime(type: Drawing.Type | undefined): boolean {
  return (
    type === "freehand" ||
    type === "polyline" ||
    type === "rectangle" ||
    type === "triangle" ||
    type === "curved_line"
  );
}

/** Maps continuous time to a fractional ordinal index, interpolating within each
 * loaded interval and extrapolating its adjacent edge pair outside the timeline.
 * Invalid times/degenerate intervals return null; one bar resolves only its exact time.
 * @example continuousIndexFromTime([{ time: 10 }, { time: 20 }], 15); // 0.5
 */
export function continuousIndexFromTime(
  data: unknown[],
  time: unknown,
): number | null {
  const target = Data.readTime(time);
  const timeAt = (index: number) =>
    Data.readTime((data[index] as { time?: unknown } | undefined)?.time);
  const first = timeAt(0);
  const last = timeAt(data.length - 1);
  if (target === undefined || first === undefined || last === undefined)
    return null;
  if (data.length === 1) return target === first ? 0 : null;

  let left: number;
  if (target < first) left = 0;
  else if (target > last) left = data.length - 2;
  else {
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const value = timeAt(mid);
      if (value === undefined) return null;
      if (value < target) lo = mid + 1;
      else hi = mid;
    }
    if (timeAt(lo) === target) return lo;
    left = lo - 1;
  }
  const start = timeAt(left);
  const end = timeAt(left + 1);
  return start === undefined || end === undefined || end <= start
    ? null
    : left + (target - start) / (end - start);
}

/** Projects an anchor through the loaded timeline and price scale, or returns null.
 * Finite boundary kinds interpolate fractional time inside loaded bars; legacy kinds snap.
 * Outside loaded bars, extrapolates from the adjacent edge pair, like manual annotation labels.
 * This is display geometry, not evidence of a loaded bar or a trading-calendar forecast.
 * Invalid times or edges without two distinct timestamps cannot be extrapolated.
 * @example anchorToPoint(item.anchors[0], context);
 */
export function anchorToPoint(
  anchor: Drawing.Anchor,
  ctx: RenderContext,
  drawingType?: Drawing.Type,
): Point | null {
  const continuous = continuousDrawingTime(drawingType);
  const idx = continuous
    ? continuousIndexFromTime(ctx.data, anchor.time)
    : indexFromTime(ctx.data, anchor.time);
  const xAt = (index: number) => ctx.xPositions[index] ?? ctx.xFn(index);
  let x: number;
  if (idx !== null) {
    if (Number.isInteger(idx) && idx >= 0 && idx < ctx.data.length) {
      x = xAt(idx);
    } else {
      const left = Math.max(0, Math.min(ctx.data.length - 2, Math.floor(idx)));
      x = xAt(left) + (idx - left) * (xAt(left + 1) - xAt(left));
    }
  } else {
    if (continuous) return null;
    const target = anchor.time;
    const first = Data.readTime(
      (ctx.data[0] as { time?: unknown } | undefined)?.time,
    );
    const last = Data.readTime(
      (ctx.data.at(-1) as { time?: unknown } | undefined)?.time,
    );
    if (first === undefined || last === undefined || ctx.data.length < 2)
      return null;
    // Keep in-range matching with indexFromTime; only the blank margins are projected.
    const leftIndex =
      target < first ? 0 : target > last ? ctx.data.length - 2 : null;
    if (leftIndex === null) return null;
    const left = Data.readTime(
      (ctx.data[leftIndex] as { time?: unknown } | undefined)?.time,
    );
    const right = Data.readTime(
      (ctx.data[leftIndex + 1] as { time?: unknown } | undefined)?.time,
    );
    if (left === undefined || right === undefined || right <= left) return null;
    x =
      xAt(leftIndex) +
      ((target - left) / (right - left)) *
        (xAt(leftIndex + 1) - xAt(leftIndex));
  }
  if (!Number.isFinite(x)) return null;

  const scaleId = anchor.axisId ?? ctx.coord.defaultYScale;
  const scale =
    ctx.coord.scales.y[scaleId] ?? Object.values(ctx.coord.scales.y)[0];
  if (!scale) return null;

  const y = CoordSys.toPixel(anchor.price, scale);
  return { x, y };
}

/** Finds distinct intersections of an infinite line with the render area.
 * @example lineIntersections(start, end, context.area);
 */
export function lineIntersections(
  p1: Point,
  p2: Point,
  area: RenderContext["area"],
): Intersection[] {
  const results: Intersection[] = [];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const minX = area.x;
  const maxX = area.x + area.width;
  const minY = area.y;
  const maxY = area.y + area.height;

  if (dx !== 0) {
    const t1 = (minX - p1.x) / dx;
    const y1 = p1.y + t1 * dy;
    if (y1 >= minY && y1 <= maxY) results.push({ x: minX, y: y1, t: t1 });

    const t2 = (maxX - p1.x) / dx;
    const y2 = p1.y + t2 * dy;
    if (y2 >= minY && y2 <= maxY) results.push({ x: maxX, y: y2, t: t2 });
  }

  if (dy !== 0) {
    const t3 = (minY - p1.y) / dy;
    const x3 = p1.x + t3 * dx;
    if (x3 >= minX && x3 <= maxX) results.push({ x: x3, y: minY, t: t3 });

    const t4 = (maxY - p1.y) / dy;
    const x4 = p1.x + t4 * dx;
    if (x4 >= minX && x4 <= maxX) results.push({ x: x4, y: maxY, t: t4 });
  }

  const unique: Intersection[] = [];
  for (const p of results) {
    if (
      !unique.some(
        (u) => Math.abs(u.x - p.x) < 0.5 && Math.abs(u.y - p.y) < 0.5,
      )
    ) {
      unique.push(p);
    }
  }

  return unique;
}

/** Extends a line across the render area, retaining the existing offscreen fallback.
 * @example segmentAcrossArea(start, end, context.area);
 */
export function segmentAcrossArea(
  p1: Point,
  p2: Point,
  area: RenderContext["area"],
): { start: Point; end: Point } | null {
  let intersections = lineIntersections(p1, p2, area).sort((a, b) => a.t - b.t);
  if (intersections.length >= 2) {
    return {
      start: intersections[0]!,
      end: intersections[intersections.length - 1]!,
    };
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;

  const scale = Math.max(area.width, area.height) * 2;
  const ux = dx / len;
  const uy = dy / len;
  const extendedStart = { x: p1.x - ux * scale, y: p1.y - uy * scale };
  const extendedEnd = { x: p1.x + ux * scale, y: p1.y + uy * scale };
  intersections = lineIntersections(extendedStart, extendedEnd, area).sort(
    (a, b) => a.t - b.t,
  );
  if (intersections.length >= 2) {
    return {
      start: intersections[0]!,
      end: intersections[intersections.length - 1]!,
    };
  }
  return { start: extendedStart, end: extendedEnd };
}

/** Clips a finite segment to the render area; returns null without two visible endpoints.
 * @example visibleFiniteSegment(start, end, context.area);
 */
export function visibleFiniteSegment(
  p1: Point,
  p2: Point,
  area: RenderContext["area"],
): { start: Point; end: Point } | null {
  const candidates: Intersection[] = [];
  if (pointInsideArea(p1, area)) candidates.push({ ...p1, t: 0 });
  if (pointInsideArea(p2, area)) candidates.push({ ...p2, t: 1 });
  candidates.push(
    ...lineIntersections(p1, p2, area).filter((p) => p.t >= 0 && p.t <= 1),
  );

  const unique = candidates
    .sort((a, b) => a.t - b.t)
    .filter(
      (p, index, points) =>
        index === 0 ||
        Math.abs(p.x - points[index - 1]!.x) >= 0.5 ||
        Math.abs(p.y - points[index - 1]!.y) >= 0.5,
    );
  if (unique.length < 2) return null;
  return { start: unique[0]!, end: unique[unique.length - 1]! };
}

/** Clips a forward ray to the render area; returns null without two visible endpoints.
 * @example visibleRaySegment(start, end, context.area);
 */
export function visibleRaySegment(
  p1: Point,
  p2: Point,
  area: RenderContext["area"],
): { start: Point; end: Point } | null {
  const candidates: Intersection[] = [];
  if (pointInsideArea(p1, area)) candidates.push({ ...p1, t: 0 });
  candidates.push(...lineIntersections(p1, p2, area).filter((p) => p.t >= 0));

  const unique = candidates
    .sort((a, b) => a.t - b.t)
    .filter(
      (p, index, points) =>
        index === 0 ||
        Math.abs(p.x - points[index - 1]!.x) >= 0.5 ||
        Math.abs(p.y - points[index - 1]!.y) >= 0.5,
    );
  if (unique.length < 2) return null;
  return { start: unique[0]!, end: unique[unique.length - 1]! };
}

/** Clips an infinite line to the render area; returns null without two intersections.
 * @example visibleExtendedSegment(start, end, context.area);
 */
export function visibleExtendedSegment(
  p1: Point,
  p2: Point,
  area: RenderContext["area"],
): { start: Point; end: Point } | null {
  const intersections = lineIntersections(p1, p2, area).sort(
    (a, b) => a.t - b.t,
  );
  if (intersections.length < 2) return null;
  return {
    start: intersections[0]!,
    end: intersections[intersections.length - 1]!,
  };
}

/** Returns the perpendicular offset from a line to a reference point.
 * @example offsetFromLine(start, end, reference);
 */
export function offsetFromLine(p1: Point, p2: Point, pRef: Point): Point {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  const nx = -dy / len;
  const ny = dx / len;
  const dist = (pRef.x - p1.x) * nx + (pRef.y - p1.y) * ny;
  return { x: nx * dist, y: ny * dist };
}

/** Place labels at the plot's horizontal centre, constrained to each visible boundary.
 * Angles follow the projected line and remain readable when anchors are reversed.
 * Channels return one candidate per visible boundary; unsupported/unresolved drawings return none.
 * @example const labels = lineLabelPlacements(item, projectedAnchors, context.area);
 */
export function lineLabelPlacements(
  item: Drawing.Item,
  points: readonly Point[],
  area: RenderContext["area"],
): LineLabelPlacement[] {
  if (
    !points[0] ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return [];
  const boundary = projectDrawingBoundary(item, points);
  if (boundary) return boundaryLabelPlacements(boundary, area);
  const first = points[0];
  const horizontal =
    item.type === "horizontal_line" || item.type === "horizontal_ray";
  const second = horizontal ? { x: first.x + 1, y: first.y } : points[1];
  if (!second) return [];
  const segments: ({ start: Point; end: Point } | null)[] = [];
  switch (item.type) {
    case "trend_line":
      segments.push(visibleFiniteSegment(first, second, area));
      break;
    case "ray":
    case "horizontal_ray":
      segments.push(visibleRaySegment(first, second, area));
      break;
    case "extended_line":
    case "horizontal_line":
      segments.push(visibleExtendedSegment(first, second, area));
      break;
    case "fib_retracement": {
      const x = Math.min(first.x, second.x);
      for (const level of FIB_RETRACEMENT_LEVELS) {
        const y = first.y + (second.y - first.y) * level;
        segments.push(visibleRaySegment({ x, y }, { x: x + 1, y }, area));
      }
      break;
    }
    case "fib_channel":
    case "parallel_channel": {
      if (!points[2]) return [];
      const offset = offsetFromLine(first, second, points[2]);
      const levels = item.type === "fib_channel" ? FIB_CHANNEL_LEVELS : [0, 1];
      for (const level of levels)
        segments.push(
          visibleExtendedSegment(
            { x: first.x + offset.x * level, y: first.y + offset.y * level },
            { x: second.x + offset.x * level, y: second.y + offset.y * level },
            area,
          ),
        );
    }
  }
  return segments.flatMap((segment) => {
    if (!segment) return [];
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    if (dx === 0 && dy === 0) return [];
    const x = Math.max(
      Math.min(segment.start.x, segment.end.x),
      Math.min(
        area.x + area.width / 2,
        Math.max(segment.start.x, segment.end.x),
      ),
    );
    const y =
      dx === 0
        ? (segment.start.y + segment.end.y) / 2
        : segment.start.y + ((x - segment.start.x) * dy) / dx;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return [{ x, y, angle }];
  });
}

/** Projects selection handles, keeping one handle for axis-aligned line kinds.
 * @example handlePoints(item, context);
 */
export function handlePoints(item: Drawing.Item, ctx: RenderContext): Point[] {
  const anchors = item.anchors
    .map((a) => anchorToPoint(a, ctx, item.type))
    .filter(Boolean) as Point[];
  if (
    item.type === "horizontal_line" ||
    item.type === "horizontal_ray" ||
    item.type === "vertical_line" ||
    item.type === "cross_line"
  ) {
    return anchors.slice(0, 1);
  }
  return anchors;
}

/** Returns the nearest hit among adjacent polyline segments, or null.
 * @example hitPolyline(points, context);
 */
export function hitPolyline(
  points: Point[],
  context: HitContext,
): { distance: number } | null {
  if (points.length < 2) return null;
  let best: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const hit = HitTest.line(
      context.mouse.x,
      context.mouse.y,
      p0.x,
      p0.y,
      p1.x,
      p1.y,
    );
    if (!hit.hit) continue;
    best = best === null ? hit.distance : Math.min(best, hit.distance);
  }
  return best === null ? null : { distance: best };
}
