// Purpose: Runtime layout solver for temporal chart annotation anchors and floating callout pills
// Module:  @openchart/chart-core / annotation

import { TextCache } from "@openchart/chart-core/cache";
import { CoordSys } from "@openchart/chart-core/coord";
import {
  DrawingRenderUtils,
  type RenderContext,
} from "@openchart/chart-core/drawing";
import { type Rect } from "@openchart/chart-core/span";
import {
  resolveAnnotationAppearance,
  type AnnotationAppearance,
  type AnnotationExpandedCardContent,
  type AnnotationSourceBadge,
} from "./appearance";
import {
  circleMask,
  combineMasks,
  createOccupancyBitmap,
  createRasterScale,
  lineMask,
  rectMask,
  type CandidateMask,
  type MaskSpan,
  type OccupancyBitmap,
  type RasterScale,
} from "./placement-raster";
import { ChartAnnotation } from "./types";

export type AnnotationPoint = { x: number; y: number };

export type AnnotationPlacement = {
  annotation: ChartAnnotation.Renderable;
  anchor: AnnotationPoint;
  leader: { from: AnnotationPoint; to: AnnotationPoint };
  handles: { target: AnnotationPoint; label: AnnotationPoint };
  pill: Rect;
  compactPill?: Rect;
  hit: Rect;
  exposed?: Rect;
  actionButton?: Rect;
  pillMotion?: { progress: number; marqueeElapsedMs?: number };
  text: string;
  fullText: string;
  zIndex: number;
  layer: number;
  state: "compact" | "hover" | "expanded" | "collapsed";
  appearance: AnnotationAppearance;
  expandedContent?: AnnotationExpandedCardContent;
  bodyExpanded?: boolean;
  bodyTruncated?: boolean;
};

export type ChartAnnotationLayoutSlot = {
  annotationId: string;
  start: number;
  offset: AnnotationPoint;
  center?: AnnotationPoint;
  width: number;
  height: number;
  xStep?: number;
  areaX?: number;
  areaY?: number;
  areaWidth?: number;
  areaHeight?: number;
};

export type ChartAnnotationLayoutState = {
  slots: Map<string, ChartAnnotationLayoutSlot>;
};

export type ChartAnnotationOccupancySnapshot = {
  area: Rect;
  ratio: number;
  width: number;
  height: number;
  chartSpans: readonly MaskSpan[];
  placedSpans: readonly MaskSpan[];
};

export type ChartAnnotationLayoutInput = {
  ctx: CanvasRenderingContext2D;
  textCache: ReturnType<typeof TextCache.create>;
  render: RenderContext;
  annotations: ChartAnnotation.Renderable[];
  hoveredAnnotationId?: string | null;
  expandedAnnotation?: ChartAnnotation.Expansion;
  activeAnnotationId?: string | null;
  sourceBadgesByAnnotationId?: Record<string, readonly AnnotationSourceBadge[]>;
  expandedCardsByAnnotationId?: Record<string, AnnotationExpandedCardContent>;
  agentAnnotationIds?: Record<string, true>;
  layoutState?: ChartAnnotationLayoutState;
  layoutStateWritable?: boolean;
  onOccupancySnapshot?: (snapshot: ChartAnnotationOccupancySnapshot) => void;
};

export function createChartAnnotationLayoutState(): ChartAnnotationLayoutState {
  return { slots: new Map() };
}

export type ChartAnnotationTranslatedLayoutInput =
  ChartAnnotationLayoutInput & {
    previousPlacements: readonly AnnotationPlacement[];
  };

type CandleBox = {
  x: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  width: number;
};

type AnnotationTarget = {
  annotation: ChartAnnotation.Renderable;
  candleIndex: number;
  candleTime: unknown;
  candle: CandleBox;
  targetAnchor?: AnnotationPoint;
  labelAnchor?: AnnotationPoint;
};

function sourceBadgesForAnnotation(
  input: ChartAnnotationLayoutInput,
  annotation: ChartAnnotation.Renderable,
): readonly AnnotationSourceBadge[] | undefined {
  return (
    input.sourceBadgesByAnnotationId?.[annotation.id] ??
    input.sourceBadgesByAnnotationId?.[annotation.eventId ?? annotation.id] ??
    annotation.sourceBadges
  );
}

function isAgentAnnotation(
  input: ChartAnnotationLayoutInput,
  annotation: ChartAnnotation.Renderable,
  sourceBadges?: readonly AnnotationSourceBadge[],
): boolean {
  return Boolean(
    annotation.content ??
    input.agentAnnotationIds?.[annotation.id] ??
    input.agentAnnotationIds?.[annotation.eventId ?? annotation.id] ??
    sourceBadges?.length,
  );
}

type Candidate = {
  pill: Rect;
  anchor: AnnotationPoint;
  mask: CandidateMask;
  pillMask: CandidateMask;
  commitMask: CandidateMask;
  baseOrder: number;
  directionKind: "vertical" | "diagonal" | "horizontal" | "intercardinal";
  ring: number;
  score: number;
  sticky?: "labelAnchor" | "runtimeSlot";
};

type PlacementOccupancy = {
  scale: RasterScale;
  chart: OccupancyBitmap;
  placed: OccupancyBitmap;
};

type LayoutObstacle = {
  rect: Rect;
  weight: number;
};

const PILL_GAP = 12;
const STACK_PEEK = 8;
const HIT_PADDING = 3;
const CHART_INK_PADDING = 5;
const LEADER_MASK_RADIUS = 3;
const MAX_AUTOMATIC_LEADER_LENGTH = 240;
const VERTICAL_AXIS_ALIGNMENT_EPSILON = 0.001;
const WICK_ANCHOR_GAP = 7;

function pointTime(row: unknown): number | null {
  return readNumber(row, "time");
}

/** Loaded bar starts define half-open intervals. Never snap an event forward
 * or invent coverage outside the loaded timeline.
 */
function resolveTargetIndex(
  render: RenderContext,
  annotation: ChartAnnotation.Renderable,
): number | null {
  const target = annotation.anchor.start;
  const first = pointTime(render.data[0]);
  const last = pointTime(render.data.at(-1));
  if (first === null || last === null || target < first || target > last)
    return null;
  let low = 0;
  let high = render.data.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const time = pointTime(render.data[mid]);
    if (time === null) return null;
    if (time <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

function readNumber(row: unknown, field: string): number | null {
  const value = (row as Record<string, unknown> | undefined)?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function yForValue(render: RenderContext, value: number): number | null {
  const scaleId = render.coord.defaultYScale;
  const scale =
    render.coord.scales.y[scaleId] ?? Object.values(render.coord.scales.y)[0];
  if (!scale) return null;
  const y = CoordSys.toPixel(value, scale);
  return Number.isFinite(y) ? y : null;
}

function yForAnchorValue(
  render: RenderContext,
  anchor: ChartAnnotation.ChartPointAnchor,
): number | null {
  const scaleId = anchor.axisId ?? render.coord.defaultYScale;
  const scale =
    render.coord.scales.y[scaleId] ?? Object.values(render.coord.scales.y)[0];
  if (!scale) return null;
  const y = CoordSys.toPixel(anchor.price, scale);
  return Number.isFinite(y) ? y : null;
}

function resolveCandle(render: RenderContext, index: number): CandleBox | null {
  const row = render.data[index];
  const x = render.xPositions[index] ?? render.xFn(index);
  if (!Number.isFinite(x)) return null;

  const close = readNumber(row, "close");
  const open = readNumber(row, "open") ?? close;
  const high = readNumber(row, "high") ?? open ?? close;
  const low = readNumber(row, "low") ?? open ?? close;
  const fallbackY = render.area.y + render.area.height / 2;
  const openY =
    open === null ? fallbackY : (yForValue(render, open) ?? fallbackY);
  const highY = high === null ? openY : (yForValue(render, high) ?? openY);
  const lowY = low === null ? openY : (yForValue(render, low) ?? openY);
  const closeY = close === null ? openY : (yForValue(render, close) ?? openY);
  const nextX = render.xPositions[index + 1] ?? render.xFn(index + 1);
  const prevX = render.xPositions[index - 1] ?? render.xFn(index - 1);
  const step = Number.isFinite(nextX - x)
    ? Math.abs(nextX - x)
    : Number.isFinite(x - prevX)
      ? Math.abs(x - prevX)
      : 8;
  return { x, openY, highY, lowY, closeY, width: Math.max(3, step * 0.62) };
}

function chartPointAnchorToPoint(
  render: RenderContext,
  anchor: ChartAnnotation.ChartPointAnchor | undefined,
): AnnotationPoint | null {
  if (!anchor) return null;
  const exact = DrawingRenderUtils.anchorToPoint(anchor, render);
  if (exact) return exact;
  const x = projectedXForAnchorTime(render, anchor.time);
  const y = yForAnchorValue(render, anchor);
  return x === null || y === null ? null : { x, y };
}

function projectedXForAnchorTime(
  render: RenderContext,
  target: number,
): number | null {
  const points: Array<{ x: number; time: number }> = [];
  for (let index = 0; index < render.data.length; index++) {
    const time = pointTime(render.data[index]);
    if (time === null) continue;
    const x = render.xPositions[index] ?? render.xFn(index);
    if (!Number.isFinite(x)) continue;
    points.push({ x, time });
  }
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!.x;

  let left = points[0]!;
  let right = points[1]!;
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    if (target <= point.time) {
      right = point;
      break;
    }
    left = point;
    right = points[index + 1] ?? point;
  }
  if (target <= points[0]!.time) {
    left = points[0]!;
    right = points[1]!;
  } else if (target >= points[points.length - 1]!.time) {
    left = points[points.length - 2]!;
    right = points[points.length - 1]!;
  }

  const span = right.time - left.time;
  if (span <= 0) return right.x;
  return left.x + ((target - left.time) / span) * (right.x - left.x);
}

function resolveTarget(
  render: RenderContext,
  annotation: ChartAnnotation.Renderable,
): AnnotationTarget | null {
  const index = resolveTargetIndex(render, annotation);
  if (index === null) return null;
  if (
    index < render.visibleRange.from - 2 ||
    index > render.visibleRange.to + 2
  )
    return null;
  const candle = resolveCandle(render, index);
  if (!candle) return null;
  if (candle.x < render.area.x - 420) return null;
  if (candle.x > render.area.x + render.area.width + 420) {
    return null;
  }
  return {
    annotation,
    candleIndex: index,
    candleTime: pointTime(render.data[index]),
    candle,
    targetAnchor:
      chartPointAnchorToPoint(render, annotation.anchor.targetAnchor) ??
      undefined,
    labelAnchor:
      chartPointAnchorToPoint(render, annotation.anchor.labelAnchor) ??
      undefined,
  };
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

function textWidth(
  input: ChartAnnotationLayoutInput,
  appearance: AnnotationAppearance,
  text: string,
): number {
  return TextCache.width(input.textCache, input.ctx, appearance.font, text);
}

function fontWidth(
  input: ChartAnnotationLayoutInput,
  font: string,
  text: string,
): number {
  return TextCache.width(input.textCache, input.ctx, font, text);
}

function wrappedLineCount(input: {
  layout: ChartAnnotationLayoutInput;
  font: string;
  text: string;
  maxWidth: number;
  maxLines: number;
}): number {
  const text = input.text.trim();
  if (!text) return 0;
  let lines = 1;
  let current = "";
  // Match CSS word wrapping, including CJK, long unbroken text and explicit paragraphs.
  const segments = new Intl.Segmenter(undefined, {
    granularity: "word",
  }).segment(text);
  for (const { segment } of segments) {
    if (segment.includes("\n")) {
      lines += segment.split("\n").length - 1;
      current = "";
    } else if (
      fontWidth(input.layout, input.font, current + segment) <= input.maxWidth
    ) {
      current += segment;
    } else {
      if (current.trim()) lines++;
      current = "";
      for (const character of segment.trimStart()) {
        if (
          current &&
          fontWidth(input.layout, input.font, current + character) >
            input.maxWidth
        ) {
          lines++;
          current = "";
        }
        current += character;
      }
    }
    if (lines >= input.maxLines) return input.maxLines;
  }
  return lines;
}

function fitText(
  input: ChartAnnotationLayoutInput,
  appearance: AnnotationAppearance,
  text: string,
  maxWidth: number,
): string {
  if (textWidth(input, appearance, text) <= maxWidth) return text;
  const words = text.split(" ");
  if (words.length > 1) {
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (textWidth(input, appearance, `${next}...`) > maxWidth) break;
      current = next;
    }
    if (current) return `${current}...`;
  }
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(input, appearance, `${text.slice(0, mid)}...`) <= maxWidth) {
      lo = mid;
    } else hi = mid - 1;
  }
  return `${text.slice(0, lo)}...`;
}

function pillSize(
  input: ChartAnnotationLayoutInput,
  text: string,
  appearance: AnnotationAppearance,
) {
  const maxText = Math.max(
    48,
    Math.min(
      appearance.compactTextMaxWidth,
      input.render.area.width -
        appearance.paddingX * 2 -
        appearance.sourceSlotWidth -
        appearance.textEndGap -
        12,
    ),
  );
  const fitted = fitText(input, appearance, text, maxText);
  const width = Math.max(
    appearance.minWidth,
    Math.min(
      maxText +
        appearance.paddingX * 2 +
        appearance.sourceSlotWidth +
        appearance.textEndGap,
      textWidth(input, appearance, fitted) +
        appearance.paddingX * 2 +
        appearance.sourceSlotWidth +
        appearance.textEndGap,
    ),
  );
  return { text: fitted, width, height: appearance.height };
}

function clampRect(rect: Rect, area: Rect): Rect {
  const x = Math.max(
    area.x + 4,
    Math.min(rect.x, area.x + area.width - rect.width - 4),
  );
  const y = Math.max(
    area.y + 4,
    Math.min(rect.y, area.y + area.height - rect.height - 4),
  );
  return { ...rect, x, y };
}

function leaderTargets(candle: CandleBox): AnnotationPoint[] {
  const topY = Math.min(candle.highY, candle.lowY);
  const bottomY = Math.max(candle.highY, candle.lowY);
  return [
    { x: candle.x, y: topY - WICK_ANCHOR_GAP },
    { x: candle.x, y: bottomY + WICK_ANCHOR_GAP },
  ];
}

function candleMidY(candle: CandleBox): number {
  return (
    (Math.min(candle.highY, candle.lowY) +
      Math.max(candle.highY, candle.lowY)) /
    2
  );
}

function labelDirectedLeaderTarget(
  candle: CandleBox,
  labelAnchor: AnnotationPoint,
): AnnotationPoint {
  const [upper, lower] = leaderTargets(candle);
  return labelAnchor.y >= candleMidY(candle) ? lower! : upper!;
}

function targetLeaderTargets(target: AnnotationTarget): AnnotationPoint[] {
  if (target.labelAnchor) {
    return [labelDirectedLeaderTarget(target.candle, target.labelAnchor)];
  }
  const anchors = leaderTargets(target.candle);
  if (!target.targetAnchor) return anchors;
  const closest = closestLeaderTarget(anchors, target.targetAnchor);
  return closest ? [closest] : anchors;
}

function closestLeaderTarget(
  anchors: readonly AnnotationPoint[],
  previous: AnnotationPoint,
): AnnotationPoint | null {
  let best: AnnotationPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x - previous.x, anchor.y - previous.y);
    if (distance >= bestDistance) continue;
    best = anchor;
    bestDistance = distance;
  }
  return best;
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${Math.round(candidate.pill.x)}:${Math.round(
      candidate.pill.y,
    )}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function candidateMasks(input: {
  anchor: AnnotationPoint;
  size: { width: number; height: number };
  area: Rect;
  occupancy: PlacementOccupancy;
  leaderTargetGap: number;
}): Candidate[] {
  const candidates: Candidate[] = [];
  for (const ring of [1, 2]) {
    const sides = ring === 1 ? 8 : 16;
    const radiusX =
      input.size.width / 2 +
      PILL_GAP +
      (ring - 1) * (input.size.width + PILL_GAP);
    const radiusY =
      input.size.height / 2 +
      PILL_GAP +
      (ring - 1) * (input.size.height + PILL_GAP);
    for (let index = 0; index < sides; index++) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const pill = clampRect(
        rectFromCenter(
          {
            x: input.anchor.x + x * radiusX,
            y: input.anchor.y + y * radiusY,
          },
          input.size,
        ),
        input.area,
      );
      const directionKind = candidateDirectionKind(x, y);
      const base = {
        pill,
        anchor: input.anchor,
        ring,
        directionKind,
        baseOrder: candidateBaseOrder(directionKind, ring, index),
      };
      const masks = candidateRasterMasks(
        input.occupancy.scale,
        pill,
        input.anchor,
        input.leaderTargetGap,
      );
      candidates.push({
        ...base,
        ...masks,
        score: 0,
      });
    }
  }
  return uniqueCandidates(candidates).sort((a, b) => a.baseOrder - b.baseOrder);
}

function candidateDirectionKind(
  x: number,
  y: number,
): Candidate["directionKind"] {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < 0.001) return "vertical";
  if (ay < 0.001) return "horizontal";
  if (Math.abs(ax - ay) < 0.08) return "diagonal";
  return "intercardinal";
}

function candidateBaseOrder(
  direction: Candidate["directionKind"],
  ring: number,
  index: number,
): number {
  const directionOrder = {
    vertical: 0,
    diagonal: 2,
    horizontal: 3,
    intercardinal: 4,
  } satisfies Record<Candidate["directionKind"], number>;
  return directionOrder[direction] * 1000 + ring * 100 + index;
}

function candidateRasterMasks(
  scale: RasterScale,
  pill: Rect,
  anchor: AnnotationPoint,
  leaderTargetGap: number,
): Pick<Candidate, "mask" | "pillMask" | "commitMask"> {
  const from = leaderBoundaryPoint(pill, anchor);
  const lineTo = pointAfterGap(anchor, from, leaderTargetGap);
  const pillMask = rectMask(scale, pill, HIT_PADDING);
  const leader = lineMask({
    scale,
    from,
    to: lineTo,
    radius: LEADER_MASK_RADIUS,
  });
  const target = circleMask({
    scale,
    center: anchor,
    radius: 8,
  });
  const mask = combineMasks([pillMask, leader]);
  return { mask, pillMask, commitMask: combineMasks([mask, target]) };
}

function pointAfterGap(
  from: AnnotationPoint,
  to: AnnotationPoint,
  gap: number,
): AnnotationPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= gap) return to;
  return {
    x: from.x + (dx / length) * gap,
    y: from.y + (dy / length) * gap,
  };
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function rectCenter(rect: Rect): AnnotationPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function offsetPoint(
  from: AnnotationPoint,
  to: AnnotationPoint,
): AnnotationPoint {
  return { x: to.x - from.x, y: to.y - from.y };
}

function rectFromCenter(
  center: AnnotationPoint,
  size: { width: number; height: number },
): Rect {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function cachedRect(
  target: AnnotationTarget,
  size: { width: number; height: number },
  anchor: AnnotationPoint,
  area: Rect,
  render: RenderContext,
  state?: ChartAnnotationLayoutState,
): Rect | null {
  if (target.labelAnchor) return null;
  const slot = state?.slots.get(target.annotation.id);
  if (!slot || slot.start !== target.annotation.anchor.start) return null;
  if (isPanCompatibleSlot(slot, size, render)) {
    const center = {
      x: anchor.x + slot.offset.x,
      y: anchor.y + slot.offset.y,
    };
    return clampRect(rectFromCenter(center, size), area);
  }
  if (slot.center) return null;
  const center = {
    x: anchor.x + slot.offset.x,
    y: anchor.y + slot.offset.y,
  };
  return clampRect(rectFromCenter(center, size), area);
}

function closeEnough(a: number | undefined, b: number): boolean {
  return a !== undefined && Math.abs(a - b) <= 0.5;
}

function rectCloseEnough(a: Rect, b: Rect): boolean {
  return (
    closeEnough(a.x, b.x) &&
    closeEnough(a.y, b.y) &&
    closeEnough(a.width, b.width) &&
    closeEnough(a.height, b.height)
  );
}

function renderXStep(render: RenderContext): number | null {
  const from = Math.max(0, Math.floor(render.visibleRange.from));
  const to = Math.min(
    render.data.length - 2,
    Math.ceil(render.visibleRange.to),
  );
  for (let index = from; index <= to; index++) {
    const current = render.xPositions[index] ?? render.xFn(index);
    const next = render.xPositions[index + 1] ?? render.xFn(index + 1);
    const step = Math.abs(next - current);
    if (Number.isFinite(step) && step > 0.0001) return step;
  }
  return null;
}

function isPanCompatibleSlot(
  slot: ChartAnnotationLayoutSlot,
  size: { width: number; height: number },
  render: RenderContext,
): boolean {
  if (!slot.center) return false;
  const xStep = renderXStep(render);
  if (xStep === null) return false;
  return (
    closeEnough(slot.width, size.width) &&
    closeEnough(slot.height, size.height) &&
    closeEnough(slot.xStep, xStep) &&
    closeEnough(slot.areaX, render.area.x) &&
    closeEnough(slot.areaY, render.area.y) &&
    closeEnough(slot.areaWidth, render.area.width) &&
    closeEnough(slot.areaHeight, render.area.height)
  );
}

function translatedPlacement(
  input: ChartAnnotationTranslatedLayoutInput,
  target: AnnotationTarget,
  previous: AnnotationPlacement,
): AnnotationPlacement | null {
  if (previous.state === "expanded") return null;
  const fullText = normalizeLabel(target.annotation.label);
  const collapsed = target.annotation.visibility === "collapsed";
  const sourceBadges = sourceBadgesForAnnotation(input, target.annotation);
  const agentBacked = isAgentAnnotation(input, target.annotation, sourceBadges);
  const appearance = resolveAnnotationAppearance({
    annotation: target.annotation,
    sourceBadges,
    agentBacked,
  });
  const size = collapsed
    ? { text: "", width: 18, height: 18 }
    : pillSize(input, fullText, appearance);
  if (
    !closeEnough(previous.pill.width, size.width) ||
    !closeEnough(previous.pill.height, size.height)
  ) {
    return null;
  }
  const anchors = targetLeaderTargets(target);
  const anchor = closestLeaderTarget(anchors, previous.anchor);
  if (!anchor) return null;
  const slot = input.layoutState?.slots.get(target.annotation.id);
  let offset = offsetPoint(previous.anchor, rectCenter(previous.pill));
  if (
    slot &&
    slot.start === target.annotation.anchor.start &&
    isPanCompatibleSlot(slot, size, input.render)
  ) {
    const projectedSlotPill = clampRect(
      rectFromCenter(
        {
          x: previous.anchor.x + slot.offset.x,
          y: previous.anchor.y + slot.offset.y,
        },
        size,
      ),
      input.render.area,
    );
    if (rectCloseEnough(previous.pill, projectedSlotPill)) {
      offset = slot.offset;
    }
  }
  const pill = clampRect(
    rectFromCenter(
      {
        x: anchor.x + offset.x,
        y: anchor.y + offset.y,
      },
      size,
    ),
    input.render.area,
  );
  const label = rectCenter(pill);
  const from = leaderBoundaryPoint(pill, anchor);
  const leader = { from, to: anchor };
  const hit = collapsed ? expandRect(pill, 6) : expandRect(pill, HIT_PADDING);
  return {
    annotation: target.annotation,
    anchor,
    leader,
    handles: { target: anchor, label },
    pill,
    hit,
    exposed: previous.exposed,
    text: size.text,
    fullText,
    zIndex: previous.zIndex,
    layer: previous.layer,
    state: collapsed ? "collapsed" : "compact",
    appearance,
  };
}

export function translateChartAnnotationPlacements(
  input: ChartAnnotationTranslatedLayoutInput,
): AnnotationPlacement[] | null {
  const targets = input.annotations
    .filter((annotation) => annotation.visibility !== "hidden")
    .map((annotation) => resolveTarget(input.render, annotation))
    .filter((target): target is AnnotationTarget => target !== null)
    .sort((a, b) => {
      const priority = b.annotation.priorityScore - a.annotation.priorityScore;
      if (priority !== 0) return priority;
      return a.annotation.id.localeCompare(b.annotation.id);
    });
  if (targets.length !== input.previousPlacements.length) return null;
  const previousById = new Map(
    input.previousPlacements.map((placement) => [
      placement.annotation.id,
      placement,
    ]),
  );
  const translated: AnnotationPlacement[] = [];
  for (const target of targets) {
    const previous = previousById.get(target.annotation.id);
    if (!previous) return null;
    const placement = translatedPlacement(input, target, previous);
    if (!placement) return null;
    translated.push(placement);
  }
  return translated;
}

function closestPointOnRect(
  rect: Rect,
  point: AnnotationPoint,
): AnnotationPoint {
  const center = rectCenter(rect);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx / rect.width) > Math.abs(dy / rect.height)) {
    return {
      x: dx > 0 ? rect.x + rect.width : rect.x,
      y: Math.max(rect.y, Math.min(point.y, rect.y + rect.height)),
    };
  }
  return {
    x: Math.max(rect.x, Math.min(point.x, rect.x + rect.width)),
    y: dy > 0 ? rect.y + rect.height : rect.y,
  };
}

export function leaderBoundaryPoint(
  rect: Rect,
  target: AnnotationPoint,
): AnnotationPoint {
  return (
    rayIntersectionWithRect(rect, target, rectCenter(rect)) ??
    closestPointOnRect(rect, target)
  );
}

function rayIntersectionWithRect(
  rect: Rect,
  from: AnnotationPoint,
  through: AnnotationPoint,
): AnnotationPoint | null {
  const dx = through.x - from.x;
  const dy = through.y - from.y;
  const candidates: Array<{ t: number; point: AnnotationPoint }> = [];
  const addVertical = (x: number) => {
    if (Math.abs(dx) < 0.0001) return;
    const t = (x - from.x) / dx;
    if (t < 0) return;
    const y = from.y + dy * t;
    if (y < rect.y - 0.0001 || y > rect.y + rect.height + 0.0001) return;
    candidates.push({ t, point: { x, y } });
  };
  const addHorizontal = (y: number) => {
    if (Math.abs(dy) < 0.0001) return;
    const t = (y - from.y) / dy;
    if (t < 0) return;
    const x = from.x + dx * t;
    if (x < rect.x - 0.0001 || x > rect.x + rect.width + 0.0001) return;
    candidates.push({ t, point: { x, y } });
  };

  addVertical(rect.x);
  addVertical(rect.x + rect.width);
  addHorizontal(rect.y);
  addHorizontal(rect.y + rect.height);

  candidates.sort((a, b) => a.t - b.t);
  return candidates[0]?.point ?? null;
}

function overlapArea(a: Rect, b: Rect): number {
  const x = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const y = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  return x * y;
}

function rectIntersectsArea(rect: Rect, area: Rect): boolean {
  return overlapArea(rect, area) > 0;
}

function rectFromPoints(
  a: AnnotationPoint,
  b: AnnotationPoint,
  padding: number,
): Rect {
  const x = Math.min(a.x, b.x) - padding;
  const y = Math.min(a.y, b.y) - padding;
  return {
    x,
    y,
    width: Math.abs(a.x - b.x) + padding * 2,
    height: Math.abs(a.y - b.y) + padding * 2,
  };
}

function addObstacle(
  obstacles: LayoutObstacle[],
  area: Rect,
  rect: Rect,
  weight: number,
) {
  const expanded = expandRect(rect, CHART_INK_PADDING);
  if (!rectIntersectsArea(expanded, area)) return;
  obstacles.push({ rect: expanded, weight });
}

function candleObstacles(render: RenderContext): LayoutObstacle[] {
  const obstacles: LayoutObstacle[] = [];
  const from = Math.max(0, Math.floor(render.visibleRange.from) - 2);
  const to = Math.min(
    render.data.length - 1,
    Math.ceil(render.visibleRange.to) + 2,
  );
  for (let index = from; index <= to; index++) {
    const candle = resolveCandle(render, index);
    if (!candle) continue;
    const wickTop = Math.min(candle.highY, candle.lowY);
    const wickBottom = Math.max(candle.highY, candle.lowY);
    const bodyTop = Math.min(candle.openY, candle.closeY);
    const bodyBottom = Math.max(candle.openY, candle.closeY);
    addObstacle(
      obstacles,
      render.area,
      {
        x: candle.x - 2,
        y: wickTop,
        width: 4,
        height: Math.max(1, wickBottom - wickTop),
      },
      0.9,
    );
    addObstacle(
      obstacles,
      render.area,
      {
        x: candle.x - candle.width / 2,
        y: bodyTop,
        width: candle.width,
        height: Math.max(2, bodyBottom - bodyTop),
      },
      1.25,
    );
  }
  return obstacles;
}

function valuePoint(
  render: RenderContext,
  index: number,
): AnnotationPoint | null {
  const row = render.data[index];
  const value =
    readNumber(row, "value") ??
    readNumber(row, "close") ??
    readNumber(row, "open");
  if (value === null) return null;
  const y = yForValue(render, value);
  if (y === null) return null;
  const x = render.xPositions[index] ?? render.xFn(index);
  return Number.isFinite(x) ? { x, y } : null;
}

function lineObstacles(render: RenderContext): LayoutObstacle[] {
  const obstacles: LayoutObstacle[] = [];
  const from = Math.max(0, Math.floor(render.visibleRange.from) - 2);
  const to = Math.min(
    render.data.length - 1,
    Math.ceil(render.visibleRange.to) + 2,
  );
  let previous: AnnotationPoint | null = null;
  for (let index = from; index <= to; index++) {
    const current = valuePoint(render, index);
    if (current && previous) {
      addObstacle(
        obstacles,
        render.area,
        rectFromPoints(previous, current, 3),
        0.65,
      );
    }
    previous = current;
  }
  return obstacles;
}

function chartInkObstacles(render: RenderContext): LayoutObstacle[] {
  return [...candleObstacles(render), ...lineObstacles(render)];
}

function createPlacementOccupancy(render: RenderContext): PlacementOccupancy {
  const scale = createRasterScale(render.area);
  const chart = createOccupancyBitmap(scale);
  const placed = createOccupancyBitmap(scale);
  for (const obstacle of chartInkObstacles(render)) {
    chart.set(rectMask(scale, obstacle.rect));
  }
  return { scale, chart, placed };
}

function occupancySnapshot(
  occupancy: PlacementOccupancy,
): ChartAnnotationOccupancySnapshot {
  return {
    area: occupancy.scale.area,
    ratio: occupancy.scale.ratio,
    width: occupancy.scale.width,
    height: occupancy.scale.height,
    chartSpans: occupancy.chart.spans(),
    placedSpans: occupancy.placed.spans(),
  };
}

function conflictsCandidate(
  occupancy: PlacementOccupancy,
  candidate: Candidate,
): boolean {
  return (
    occupancy.chart.hasAny(candidate.mask) ||
    occupancy.placed.hasAny(candidate.mask)
  );
}

function candidateOverlapScore(
  occupancy: PlacementOccupancy,
  candidate: Candidate,
): number {
  return (
    occupancy.chart.overlapCount(candidate.mask) * 2 +
    occupancy.placed.overlapCount(candidate.mask) * 4
  );
}

function commitCandidate(occupancy: PlacementOccupancy, candidate: Candidate) {
  occupancy.placed.set(candidate.commitMask);
}

function candidateWithPill(
  occupancy: PlacementOccupancy,
  candidate: Candidate,
  pill: Rect,
  leaderTargetGap: number,
): Candidate {
  return {
    ...candidate,
    pill,
    ...candidateRasterMasks(
      occupancy.scale,
      pill,
      candidate.anchor,
      leaderTargetGap,
    ),
  };
}

function orientation(
  a: AnnotationPoint,
  b: AnnotationPoint,
  c: AnnotationPoint,
) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsCross(
  a: { from: AnnotationPoint; to: AnnotationPoint },
  b: { from: AnnotationPoint; to: AnnotationPoint },
): boolean {
  const o1 = orientation(a.from, a.to, b.from);
  const o2 = orientation(a.from, a.to, b.to);
  const o3 = orientation(b.from, b.to, a.from);
  const o4 = orientation(b.from, b.to, a.to);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function pointInsideRect(point: AnnotationPoint, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function segmentIntersectsRect(
  segment: { from: AnnotationPoint; to: AnnotationPoint },
  rect: Rect,
): boolean {
  if (
    pointInsideRect(segment.from, rect) ||
    pointInsideRect(segment.to, rect)
  ) {
    return true;
  }
  const top = {
    from: { x: rect.x, y: rect.y },
    to: { x: rect.x + rect.width, y: rect.y },
  };
  const right = {
    from: { x: rect.x + rect.width, y: rect.y },
    to: { x: rect.x + rect.width, y: rect.y + rect.height },
  };
  const bottom = {
    from: { x: rect.x + rect.width, y: rect.y + rect.height },
    to: { x: rect.x, y: rect.y + rect.height },
  };
  const left = {
    from: { x: rect.x, y: rect.y + rect.height },
    to: { x: rect.x, y: rect.y },
  };
  return [top, right, bottom, left].some((edge) =>
    segmentsCross(segment, edge),
  );
}

function distance(a: AnnotationPoint, b: AnnotationPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function leaderDistancePenalty(length: number): number {
  const softLimit = 150;
  const excess = Math.max(0, length - softLimit);
  return length * 1.25 + excess * excess * 0.16;
}

function verticalAxisPenalty(candidate: Omit<Candidate, "score">): number {
  const offset = Math.abs(rectCenter(candidate.pill).x - candidate.anchor.x);
  if (offset <= VERTICAL_AXIS_ALIGNMENT_EPSILON) return -420;
  return 650 + offset * 0.22;
}

function verticallyAligned(candidate: Omit<Candidate, "score">): boolean {
  return (
    Math.abs(rectCenter(candidate.pill).x - candidate.anchor.x) <=
    VERTICAL_AXIS_ALIGNMENT_EPSILON
  );
}

function placementPressure(
  candidate: Omit<Candidate, "score">,
  placed: AnnotationPlacement[],
  area: Rect,
): number {
  if (placed.length === 0) return 0;
  const center = rectCenter(candidate.pill);
  const column = Math.max(
    0,
    Math.min(2, Math.floor(((center.x - area.x) / area.width) * 3)),
  );
  const row = Math.max(
    0,
    Math.min(2, Math.floor(((center.y - area.y) / area.height) * 3)),
  );
  let score = 0;
  for (const item of placed) {
    const itemCenter = rectCenter(item.pill);
    const itemColumn = Math.max(
      0,
      Math.min(2, Math.floor(((itemCenter.x - area.x) / area.width) * 3)),
    );
    const itemRow = Math.max(
      0,
      Math.min(2, Math.floor(((itemCenter.y - area.y) / area.height) * 3)),
    );
    if (itemColumn === column && itemRow === row) score += 140;
    if (itemColumn === column) score += 34;
    if (itemRow === row) score += 24;
    const localDistance = distance(center, itemCenter);
    if (localDistance < 220) score += (220 - localDistance) * 1.4;
  }
  return score;
}

function scoreCandidate(
  candidate: Omit<Candidate, "score">,
  placed: AnnotationPlacement[],
  area: Rect,
  obstacles: LayoutObstacle[],
): number {
  const center = rectCenter(candidate.pill);
  const leader = {
    from: leaderBoundaryPoint(candidate.pill, candidate.anchor),
    to: candidate.anchor,
  };
  const leaderBox = rectFromPoints(leader.from, leader.to, 1.5);
  let score =
    leaderDistancePenalty(distance(leader.from, leader.to)) +
    verticalAxisPenalty(candidate) +
    Math.abs(center.x - candidate.anchor.x) * 0.22 +
    placementPressure(candidate, placed, area);
  if (candidate.sticky) score -= 160;
  if (candidate.pill.y < area.y + area.height / 2) {
    score +=
      placed.filter((item) => item.pill.y < area.y + area.height / 2).length *
      18;
  } else {
    score +=
      placed.filter((item) => item.pill.y >= area.y + area.height / 2).length *
      18;
  }
  for (const item of placed) {
    const labelOverlap = overlapArea(candidate.pill, item.pill);
    if (labelOverlap > 0) score += 3000 + labelOverlap * 80;
    if (segmentsCross(leader, item.leader)) score += 900;
    const itemPill = expandRect(item.pill, HIT_PADDING);
    const leaderLabelOverlap = overlapArea(leaderBox, itemPill);
    if (leaderLabelOverlap > 0) {
      score += 1800 + leaderLabelOverlap * 35;
    }
    if (segmentIntersectsRect(leader, itemPill)) score += 12000;
  }
  for (const obstacle of obstacles) {
    const pillOverlap = overlapArea(candidate.pill, obstacle.rect);
    if (pillOverlap > 0) {
      score += 650 * obstacle.weight + pillOverlap * 90 * obstacle.weight;
    }
    if (overlapArea(leaderBox, obstacle.rect) > 0) {
      score += 55 * obstacle.weight;
    }
  }
  return score;
}

function candidateLeaderLength(candidate: Omit<Candidate, "score">): number {
  const from = leaderBoundaryPoint(candidate.pill, candidate.anchor);
  return distance(from, candidate.anchor);
}

function candidateChartInkOverlap(
  candidate: Omit<Candidate, "score">,
  obstacles: LayoutObstacle[],
): number {
  return obstacles.reduce(
    (total, obstacle) =>
      total + overlapArea(candidate.pill, obstacle.rect) * obstacle.weight,
    0,
  );
}

function candidateLabelOverlap(
  candidate: Omit<Candidate, "score">,
  placed: AnnotationPlacement[],
): number {
  return placed.reduce(
    (total, item) => total + overlapArea(candidate.pill, item.pill),
    0,
  );
}

function candidateLeaderCrossings(
  candidate: Omit<Candidate, "score">,
  placed: AnnotationPlacement[],
): number {
  const leader = {
    from: leaderBoundaryPoint(candidate.pill, candidate.anchor),
    to: candidate.anchor,
  };
  return placed.reduce(
    (total, item) => total + (segmentsCross(leader, item.leader) ? 1 : 0),
    0,
  );
}

function fewestCrossings(
  candidates: Candidate[],
  placed: AnnotationPlacement[],
): Candidate[] {
  if (candidates.length <= 1) return candidates;
  let min = Number.POSITIVE_INFINITY;
  const counts = new Map<Candidate, number>();
  for (const candidate of candidates) {
    const crossings = candidateLeaderCrossings(candidate, placed);
    counts.set(candidate, crossings);
    min = Math.min(min, crossings);
  }
  return candidates.filter((candidate) => counts.get(candidate) === min);
}

function preferVerticalAxis(candidates: Candidate[]): Candidate[] {
  const vertical = candidates.filter((candidate) =>
    verticallyAligned(candidate),
  );
  return vertical.length > 0 ? vertical : candidates;
}

function preferEliminatedCandidates(
  candidates: Candidate[],
  placed: AnnotationPlacement[],
  obstacles: LayoutObstacle[],
  occupancy: PlacementOccupancy,
): Candidate[] {
  const clean = candidates.filter(
    (candidate) => !conflictsCandidate(occupancy, candidate),
  );
  if (clean.length > 0) {
    return preferVerticalAxis(fewestCrossings(clean, placed));
  }
  const crossingReduced = fewestCrossings(candidates, placed);
  let bestOverlap = Number.POSITIVE_INFINITY;
  const fallback = crossingReduced.filter((candidate) => {
    const overlap =
      candidateOverlapScore(occupancy, candidate) +
      candidateChartInkOverlap(candidate, obstacles) +
      candidateLabelOverlap(candidate, placed) * 2;
    bestOverlap = Math.min(bestOverlap, overlap);
    candidate.score += overlap * 12;
    return true;
  });
  const smallest = fallback.filter(
    (candidate) =>
      candidateOverlapScore(occupancy, candidate) +
        candidateChartInkOverlap(candidate, obstacles) +
        candidateLabelOverlap(candidate, placed) * 2 ===
      bestOverlap,
  );
  return preferVerticalAxis(smallest);
}

function exposedRect(pill: Rect, layer: number): Rect {
  const width = Math.min(18, Math.max(8, STACK_PEEK + layer * 2));
  return {
    x: pill.x + pill.width - width,
    y: pill.y,
    width,
    height: pill.height,
  };
}

function layeredRect(
  rect: Rect,
  placed: AnnotationPlacement[],
  area: Rect,
): {
  pill: Rect;
  layer: number;
  exposed?: Rect;
} {
  const overlaps = placed.filter((item) => overlapArea(rect, item.pill) > 0);
  if (overlaps.length === 0) return { pill: rect, layer: 0 };
  const layer = overlaps.length;
  const shifted = clampRect(
    {
      ...rect,
      x: rect.x + STACK_PEEK * layer,
      y: rect.y + STACK_PEEK * layer,
    },
    area,
  );
  return { pill: shifted, layer, exposed: exposedRect(shifted, layer) };
}

function expandedCardPlacement(input: {
  layout: ChartAnnotationLayoutInput;
  compact: AnnotationPlacement;
  area: Rect;
  content?: AnnotationExpandedCardContent;
}): AnnotationPlacement {
  const size = expandedCardSize(input);
  const pill = rectCenteredInArea(
    input.compact.handles.label,
    size,
    input.area,
  );
  const label = rectCenter(pill);
  const from = leaderBoundaryPoint(pill, input.compact.leader.to);
  const hit = unionRect(
    expandRect(input.compact.pill, HIT_PADDING),
    expandRect(pill, HIT_PADDING),
  );
  return {
    ...input.compact,
    leader: { from, to: input.compact.leader.to },
    handles: { target: input.compact.handles.target, label },
    pill,
    compactPill: input.compact.pill,
    hit,
    zIndex: input.compact.zIndex + 1000,
    state: "expanded",
    expandedContent: input.content,
    bodyExpanded: size.bodyExpanded,
    bodyTruncated: size.bodyTruncated,
  };
}

function expandedCardSize(input: {
  layout: ChartAnnotationLayoutInput;
  compact: AnnotationPlacement;
  area: Rect;
  content?: AnnotationExpandedCardContent;
}): {
  width: number;
  height: number;
  bodyExpanded: boolean;
  bodyTruncated: boolean;
} {
  const bodyExpanded = input.layout.expandedAnnotation?.body === "full";
  const hoverWidth = hoverPillSize({
    layout: input.layout,
    compact: input.compact,
    area: input.area,
    showButton: input.content !== undefined,
  }).width;
  const maxWidth = Math.min(
    Math.max(input.compact.appearance.expandedCardWidth, hoverWidth),
    input.area.width - 12,
  );
  const contentWidth = input.content
    ? Math.max(
        fontWidth(
          input.layout,
          "600 18px system-ui, sans-serif",
          input.content.title,
        ) + 36,
        fontWidth(
          input.layout,
          "14px system-ui, sans-serif",
          input.content.content,
        ) * 0.72,
        ...input.content.questions.map(
          (question) =>
            fontWidth(input.layout, "12px system-ui, sans-serif", question) +
            36,
        ),
      )
    : maxWidth;
  const width = Math.max(
    input.compact.pill.width,
    hoverWidth,
    Math.min(
      maxWidth,
      Math.max(
        input.compact.appearance.expandedCardMinWidth,
        contentWidth + 32,
      ),
    ),
  );
  const textWidth = Math.max(120, width - 32);
  const titleLines = input.content
    ? wrappedLineCount({
        layout: input.layout,
        font: "600 18px system-ui, sans-serif",
        text: input.content.title,
        maxWidth: textWidth - 36,
        maxLines: 2,
      })
    : 2;
  const measuredContentLines = input.content
    ? wrappedLineCount({
        layout: input.layout,
        font: "14px system-ui, sans-serif",
        text: input.content.content,
        maxWidth: textWidth,
        maxLines: bodyExpanded ? Number.POSITIVE_INFINITY : 4,
      })
    : 2;
  const contentLines = bodyExpanded
    ? measuredContentLines
    : Math.min(3, measuredContentLines);
  // DOM chrome: padding/border, title with a 24px close button + 12px gap, sources/body.
  const preferredHeight =
    30 +
    titleLines * 25 +
    12 +
    24 +
    (contentLines > 0 ? 12 + contentLines * 20 : 0) +
    (input.content?.questions.length ? 16 + 1 + 12 + 16 + 34 + 28 : 0);
  const heightCap = bodyExpanded
    ? input.area.height - 12
    : Math.min(
        input.compact.appearance.expandedCardHeight,
        input.area.height - 12,
      );
  const height = Math.max(
    input.compact.pill.height,
    Math.min(
      heightCap,
      Math.max(input.compact.appearance.expandedCardMinHeight, preferredHeight),
    ),
  );
  return {
    width,
    height,
    bodyExpanded,
    bodyTruncated: !bodyExpanded && measuredContentLines > 3,
  };
}

function hoverPillSize(input: {
  layout: ChartAnnotationLayoutInput;
  compact: AnnotationPlacement;
  area: Rect;
  showButton: boolean;
}): { width: number; height: number; buttonSize: number } {
  const buttonSize = input.showButton
    ? Math.max(18, Math.min(22, input.compact.pill.height - 12))
    : 0;
  const titleWidth = textWidth(
    input.layout,
    input.compact.appearance,
    input.compact.fullText,
  );
  const idealWidth =
    input.compact.appearance.paddingX * 2 +
    input.compact.appearance.sourceSlotWidth +
    titleWidth +
    input.compact.appearance.textEndGap +
    (input.showButton ? 10 + buttonSize + 5 : 0);
  const maxWidth = Math.max(input.compact.pill.width, input.area.width - 8);
  return {
    width: Math.max(input.compact.pill.width, Math.min(maxWidth, idealWidth)),
    height: input.compact.pill.height,
    buttonSize,
  };
}

function rectCenteredInArea(
  center: AnnotationPoint,
  size: { width: number; height: number },
  area: Rect,
): Rect {
  const x = Math.max(
    area.x + 4,
    Math.min(center.x - size.width / 2, area.x + area.width - size.width - 4),
  );
  const y = Math.max(
    area.y + 4,
    Math.min(
      center.y - size.height / 2,
      area.y + area.height - size.height - 4,
    ),
  );
  return { x, y, width: size.width, height: size.height };
}

function hoverPillPlacement(input: {
  layout: ChartAnnotationLayoutInput;
  compact: AnnotationPlacement;
  area: Rect;
  content?: AnnotationExpandedCardContent;
}): AnnotationPlacement {
  const showButton = input.content !== undefined;
  const size = hoverPillSize({ ...input, showButton });
  const pill = rectCenteredInArea(
    input.compact.handles.label,
    {
      width: size.width,
      height: input.compact.pill.height,
    },
    input.area,
  );
  const label = rectCenter(pill);
  const from = leaderBoundaryPoint(pill, input.compact.leader.to);
  const actionButton = showButton
    ? {
        x: pill.x + pill.width - size.buttonSize - 5,
        y: pill.y + (pill.height - size.buttonSize) / 2,
        width: size.buttonSize,
        height: size.buttonSize,
      }
    : undefined;
  const textRight = actionButton
    ? actionButton.x
    : pill.x + pill.width - input.compact.appearance.paddingX;
  const textMaxWidth = Math.max(
    24,
    textRight -
      (pill.x +
        input.compact.appearance.paddingX +
        input.compact.appearance.sourceSlotWidth) -
      input.compact.appearance.textEndGap,
  );
  const hit = unionRect(
    expandRect(input.compact.pill, HIT_PADDING),
    expandRect(pill, HIT_PADDING),
  );
  return {
    ...input.compact,
    leader: { from, to: input.compact.leader.to },
    handles: { target: input.compact.handles.target, label },
    pill,
    compactPill: input.compact.pill,
    ...(actionButton ? { actionButton } : {}),
    hit,
    text: fitText(
      input.layout,
      input.compact.appearance,
      input.compact.fullText,
      textMaxWidth,
    ),
    zIndex: input.compact.zIndex + 1000,
    state: "hover",
  };
}

export function expandChartAnnotationPlacements(
  input: ChartAnnotationLayoutInput,
  placements: readonly AnnotationPlacement[],
): AnnotationPlacement[] {
  const expandedId = input.expandedAnnotation?.id;
  const hoveredId = input.hoveredAnnotationId ?? null;
  if (!expandedId && !hoveredId) {
    return placements as AnnotationPlacement[];
  }
  return placements.map((placement) => {
    const content =
      placement.annotation.content ??
      input.expandedCardsByAnnotationId?.[placement.annotation.id] ??
      input.expandedCardsByAnnotationId?.[
        placement.annotation.eventId ?? placement.annotation.id
      ];
    const agentBacked = isAgentAnnotation(
      input,
      placement.annotation,
      placement.appearance.sourceBadges,
    );
    if (placement.state === "collapsed" || !agentBacked) {
      return placement;
    }
    if (placement.annotation.id === expandedId) {
      return expandedCardPlacement({
        layout: input,
        compact: placement,
        area: input.render.area,
        content,
      });
    }
    if (placement.annotation.id === hoveredId) {
      return hoverPillPlacement({
        layout: input,
        compact: placement,
        area: input.render.area,
        content,
      });
    }
    return placement;
  });
}

export function layoutChartAnnotations(
  input: ChartAnnotationLayoutInput,
): AnnotationPlacement[] {
  const targets = input.annotations
    .filter((annotation) => annotation.visibility !== "hidden")
    .map((annotation) => resolveTarget(input.render, annotation))
    .filter((target): target is AnnotationTarget => target !== null)
    .sort((a, b) => {
      const priority = b.annotation.priorityScore - a.annotation.priorityScore;
      if (priority !== 0) return priority;
      return a.annotation.id.localeCompare(b.annotation.id);
    });

  if (targets.length === 0) {
    if (input.layoutState && input.layoutStateWritable) {
      input.layoutState.slots.clear();
    }
    if (input.onOccupancySnapshot) {
      const occupancy = createPlacementOccupancy(input.render);
      input.onOccupancySnapshot(occupancySnapshot(occupancy));
    }
    return [];
  }

  const placed: AnnotationPlacement[] = [];
  const output: AnnotationPlacement[] = [];
  const obstacles = chartInkObstacles(input.render);
  const occupancy = createPlacementOccupancy(input.render);
  const visibleIds = new Set<string>();
  for (let order = 0; order < targets.length; order++) {
    const target = targets[order]!;
    visibleIds.add(target.annotation.id);
    const fullText = normalizeLabel(target.annotation.label);
    const collapsed = target.annotation.visibility === "collapsed";
    const sourceBadges = sourceBadgesForAnnotation(input, target.annotation);
    const agentBacked = isAgentAnnotation(
      input,
      target.annotation,
      sourceBadges,
    );
    const appearance = resolveAnnotationAppearance({
      annotation: target.annotation,
      sourceBadges,
      agentBacked,
    });
    const size = collapsed
      ? { text: "", width: 18, height: 18 }
      : pillSize(input, fullText, appearance);
    const sticky: Candidate[] = [];
    const anchors = targetLeaderTargets(target);
    for (const anchor of anchors) {
      const cached = cachedRect(
        target,
        size,
        anchor,
        input.render.area,
        input.render,
        input.layoutState,
      );
      if (cached) {
        const base = {
          pill: cached,
          anchor,
          sticky: "runtimeSlot" as const,
          ring: 0,
          directionKind: "vertical" as const,
          baseOrder: -2000,
          ...candidateRasterMasks(
            occupancy.scale,
            cached,
            anchor,
            appearance.leaderTargetGap,
          ),
        };
        sticky.push({
          ...base,
          score: scoreCandidate(base, placed, input.render.area, obstacles),
        });
      }
    }
    if (target.labelAnchor) {
      const pill = clampRect(
        rectFromCenter(target.labelAnchor, size),
        input.render.area,
      );
      for (const anchor of anchors) {
        const base = {
          pill,
          anchor,
          sticky: "labelAnchor" as const,
          ring: 0,
          directionKind: "vertical" as const,
          baseOrder: -3000,
          ...candidateRasterMasks(
            occupancy.scale,
            pill,
            anchor,
            appearance.leaderTargetGap,
          ),
        };
        sticky.push({
          ...base,
          score: scoreCandidate(base, placed, input.render.area, obstacles),
        });
      }
    }
    const stickyEligible = sticky.filter(
      (candidate) =>
        collapsed ||
        candidate.sticky === "labelAnchor" ||
        (candidate.sticky === "runtimeSlot" &&
          candidateLeaderLength(candidate) <= MAX_AUTOMATIC_LEADER_LENGTH),
    );
    const candidates: Candidate[] = [...stickyEligible];
    if (stickyEligible.length === 0) {
      for (const anchor of anchors) {
        for (const candidate of candidateMasks({
          anchor,
          size,
          area: input.render.area,
          occupancy,
          leaderTargetGap: appearance.leaderTargetGap,
        })) {
          const base = candidate;
          if (
            !collapsed &&
            candidateLeaderLength(base) > MAX_AUTOMATIC_LEADER_LENGTH
          ) {
            continue;
          }
          candidates.push({
            ...base,
            score: scoreCandidate(base, placed, input.render.area, obstacles),
          });
        }
      }
    }
    const reduced =
      stickyEligible.length > 0
        ? stickyEligible
        : preferEliminatedCandidates(candidates, placed, obstacles, occupancy);
    const best = reduced.sort(
      (a, b) => a.score - b.score || a.baseOrder - b.baseOrder,
    )[0];
    if (!best) continue;

    const layered = layeredRect(best.pill, placed, input.render.area);
    const finalCandidate = candidateWithPill(
      occupancy,
      best,
      layered.pill,
      appearance.leaderTargetGap,
    );
    const labelHandle = rectCenter(finalCandidate.pill);
    const leaderFrom = leaderBoundaryPoint(finalCandidate.pill, best.anchor);
    const leader = {
      from: leaderFrom,
      to: best.anchor,
    };
    if (
      !collapsed &&
      best.sticky !== "labelAnchor" &&
      distance(leader.from, leader.to) > MAX_AUTOMATIC_LEADER_LENGTH
    ) {
      continue;
    }
    const hit = collapsed
      ? expandRect(finalCandidate.pill, 6)
      : expandRect(finalCandidate.pill, HIT_PADDING);
    const placement: AnnotationPlacement = {
      annotation: target.annotation,
      anchor: best.anchor,
      leader,
      handles: { target: best.anchor, label: labelHandle },
      pill: finalCandidate.pill,
      hit,
      exposed: layered.exposed,
      text: size.text,
      fullText,
      zIndex: targets.length - order,
      layer: layered.layer,
      state: collapsed ? "collapsed" : "compact",
      appearance,
    };
    placed.push(placement);
    commitCandidate(occupancy, finalCandidate);
    const existingRuntimeSlot = input.layoutState?.slots.get(
      placement.annotation.id,
    );
    const preserveRuntimeSlot = Boolean(
      best.sticky === "runtimeSlot" &&
      existingRuntimeSlot &&
      existingRuntimeSlot.start === placement.annotation.anchor.start &&
      isPanCompatibleSlot(existingRuntimeSlot, size, input.render),
    );
    if (
      input.layoutState &&
      input.layoutStateWritable &&
      !target.labelAnchor &&
      placement.state !== "collapsed" &&
      !preserveRuntimeSlot
    ) {
      input.layoutState.slots.set(placement.annotation.id, {
        annotationId: placement.annotation.id,
        start: placement.annotation.anchor.start,
        offset: offsetPoint(placement.anchor, rectCenter(placement.pill)),
        center: rectCenter(placement.pill),
        width: placement.pill.width,
        height: placement.pill.height,
        xStep: renderXStep(input.render) ?? undefined,
        areaX: input.render.area.x,
        areaY: input.render.area.y,
        areaWidth: input.render.area.width,
        areaHeight: input.render.area.height,
      });
    }
    output.push(placement);
  }
  if (input.layoutState && input.layoutStateWritable) {
    for (const id of input.layoutState.slots.keys()) {
      if (!visibleIds.has(id)) input.layoutState.slots.delete(id);
    }
  }
  input.onOccupancySnapshot?.(occupancySnapshot(occupancy));
  return output;
}

export function previewChartAnnotationDragPlacements(
  input: ChartAnnotationLayoutInput,
  placements: readonly AnnotationPlacement[],
  preview: { id: string; anchor: ChartAnnotation.Anchor },
): AnnotationPlacement[] {
  return placements.map((placement) => {
    if (placement.annotation.id !== preview.id) return placement;
    const annotation = { ...placement.annotation, anchor: preview.anchor };
    const target = resolveTarget(input.render, annotation);
    if (!target) return placement;
    const fullText = normalizeLabel(annotation.label);
    const sourceBadges = sourceBadgesForAnnotation(input, annotation);
    const agentBacked = isAgentAnnotation(input, annotation, sourceBadges);
    const appearance = resolveAnnotationAppearance({
      annotation,
      sourceBadges,
      agentBacked,
    });
    const size =
      annotation.visibility === "collapsed"
        ? { text: "", width: 18, height: 18 }
        : pillSize(input, fullText, appearance);
    const center = target.labelAnchor ?? placement.handles.label;
    const anchors = target.labelAnchor
      ? [labelDirectedLeaderTarget(target.candle, center)]
      : targetLeaderTargets(target);
    const anchor =
      closestLeaderTarget(anchors, placement.handles.target) ??
      placement.handles.target;
    const pill = clampRect(rectFromCenter(center, size), input.render.area);
    const label = rectCenter(pill);
    const from = leaderBoundaryPoint(pill, anchor);
    return {
      ...placement,
      annotation,
      anchor,
      leader: { from, to: anchor },
      handles: { target: anchor, label },
      pill,
      compactPill: undefined,
      actionButton: undefined,
      hit:
        annotation.visibility === "collapsed"
          ? expandRect(pill, 6)
          : expandRect(pill, HIT_PADDING),
      text: size.text,
      fullText,
      state: annotation.visibility === "collapsed" ? "collapsed" : "compact",
      appearance,
    };
  });
}
