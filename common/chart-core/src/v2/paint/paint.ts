// Purpose: Stateless repaint pipeline — reads Chart.State, computes layout/extents/coords, and renders all series, axes, crosshairs, and overlays onto a single canvas.
// Module:  @openchart/chart-core / v2 / paint

import { Invalidate } from "@openchart/chart-core/invalidate";
import {
  Series,
  SeriesRegistry,
  resolveHistogramBarColor,
} from "@openchart/chart-core/series";
import { TimeScale, PriceAxis, TimeAxis } from "@openchart/chart-core/scale";
import { Draw, RenderCache, Render } from "@openchart/chart-core/render";
import { CoordSys, CoordSysRegistry } from "@openchart/chart-core/coord";
import type { LineLabelPlacement } from "@openchart/chart-core/drawing/shared";
import { PrimitiveWrapper } from "@openchart/chart-core/primitive";
import { createSeriesOccupancy } from "@openchart/chart-core/primitive/series-occupancy";
import {
  Drawing,
  renderDrawings,
  type DrawingOverlayLabel,
  type RenderContext,
} from "@openchart/chart-core/drawing";
import { renderSpanBands, SpanRenderUtils } from "@openchart/chart-core/span";
import { agentSessionBands } from "@openchart/chart-core/drawing/kinds/agent-session";
import {
  ChartAnnotation,
  createChartAnnotationLayoutState,
  createDraftAnnotationRecord,
  expandChartAnnotationPlacements,
  layoutChartAnnotations,
  leaderBoundaryPoint,
  paintChartAnnotationPlacements,
  paintChartAnnotationOccupancyMap,
  orderChartAnnotationPlacementsForHit,
  previewChartAnnotationDragPlacements,
  translateChartAnnotationPlacements,
  type AnnotationPlacement,
  type ChartAnnotationLayoutState,
  type ChartAnnotationOccupancySnapshot,
} from "@openchart/chart-core/annotation";
import { renderMarkers } from "@openchart/chart-core/marker";
import { renderStrategyExecutions } from "@openchart/chart-core/strategy";
import {
  layoutVerticalProfile,
  paintVerticalProfile,
} from "@openchart/chart-core/vertical-profile";
import { Color } from "@openchart/chart-core/util";
import { DataView } from "@openchart/chart-core/data";
import { Data } from "@openchart/chart-core/data/schema";
import { Locale } from "@openchart/chart-core/format";
import { Chart, ChartObjectId } from "@openchart/chart-core/chart/state";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import type {
  YAxisConfig,
  XAxisConfig,
} from "@openchart/chart-core/scale/config";
import {
  axisDataLength,
  axisSeries,
  buildOrdinalScale,
  deriveLinearDomain,
  getAxis,
  linearBarWidth,
  linearSeriesValues,
  linearValueToX,
  linearVisibleRange,
  ordinalVisibleRange,
} from "@openchart/chart-core/v2/x-scale";
import {
  readNumber,
  resolveField,
} from "@openchart/chart-core/v2/series/fields";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import {
  centerAnchorValueInExtent,
  comparableFrom,
  lastIndexAtOrBefore,
  modeBaseline,
  modeTransformFields,
  modeTransformValue,
  rawVisibleExtent,
  readComparableValue,
  transformPointForMode,
} from "@openchart/chart-core/v2/scale-mode";
import type { RenderProfileFrame, RenderProfileMetadata } from "./profile";

type Axis = YAxisConfig.Axis;
type XAxis = XAxisConfig.Axis;

type RangeMap = Record<string, { from: number; to: number }>;

export type AnnotationHitInteractionSignature = Pick<
  Chart.State,
  "hoveredAnnotationId" | "expandedAnnotation" | "activeAnnotationId"
>;

type SeriesXRuntime = {
  xFn: (index: number) => number;
  xPositions: number[];
  range: Render.Range;
  barWidth: number;
};

type SeriesModeTransform = {
  fields: string[];
  signature: string;
  value: (raw: number) => number;
  point: (point: Record<string, unknown>) => Record<string, unknown>;
};

type ReturnObservation = {
  time: number;
  value: number;
};

type XRuntimesCache = {
  signature: string;
  seriesMap: Map<string, SeriesXRuntime>;
  seriesRanges: Map<string, Render.Range>;
  axisRanges: RangeMap;
};

type AnnotationPillMotion = {
  from: number;
  to: number;
  startedAt: number;
  hoverWidth: number;
  buttonSize: number;
};

type RenderPane = {
  id: string;
  index: number;
  height: number;
  objectIds: string[];
};

const FLOATING_AXIS_ANCHOR_GAP_PX = 110;
const FLOATING_AXIS_MIN_LEFT_PADDING_PX = 30;
const FLOATING_AXIS_RIGHT_INSET_PX = 10;
const FLOATING_AXIS_OVERLAY_WIDTH_PX = 88;
const FIXED_COMPARISON_ANCHOR_SNAP_PX = 6;
const SERIES_CONTEXT_DIM_ALPHA = 0.34;
const SERIES_FOCUS_GLOW_COLOR = "var(--glow-active, 35 80% 52%)";

export interface RuntimeState {
  canvas: { width: number; height: number };
  ctx: CanvasRenderingContext2D;
  ratio: number;
  textCache: ReturnType<typeof TextCache.create>;
  labelCache: ReturnType<typeof LabelCache.create>;
  renderCache: RenderCache.State;
  xCache: { positions: number[]; version: number; offset: number };
  coord?: CoordSys.State;
  panePrimitives: PrimitiveWrapper.PaneState;
  seriesPrimitives: Map<string, PrimitiveWrapper.SeriesState>;
  lastRange?: { from: number; to: number };
  xRuntimeCache?: XRuntimesCache;
  /** Detached DOM label geometry from this paint, never persisted in Chart.State. */
  drawingLabelPlacements?: Map<string, readonly LineLabelPlacement[]>;
  floatingAxisOverlays?: Array<{
    axisId: string;
    seriesId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  disposed: boolean;
  pendingFrame?: number;
  pendingMask?: Invalidate.Mask;
  /**
   * Cached mode-transforms + visible extents keyed by a value signature of every
   * input they read (comparison topology, per-axis mode/anchor/autoscale, and
   * per-series data identity/range). Both are O(series × visible-points) and
   * otherwise recompute every frame; during a crosshair hover their inputs are
   * invariant, so the signature matches and the cache short-circuits the two
   * dominant stages. An anchor drag mutates `axis.modeAnchor.time`, which is in
   * the signature, so it correctly busts the cache and recomputes each frame.
   */
  modeCache?: {
    signature: string;
    modeTransforms: Map<string, SeriesModeTransform>;
    extents: {
      x: { min: number; max: number };
      y: Record<string, { min: number; max: number }>;
    };
  };
  /** Per-series data reference from last paint — used to skip retransform at light level. */
  seriesDataRefs?: Map<string, unknown[]>;
  /** Per-series render signature from last paint — invalidates cached geometry when transforms or y-scale change. */
  seriesRenderSignatures?: Map<string, string>;
  /** Runtime-only stable annotation slot assignments; never persisted. */
  annotationLayoutState?: ChartAnnotationLayoutState;
  /** Last annotation occupancy bitmap projection for local debug rendering. */
  annotationOccupancySnapshot?: ChartAnnotationOccupancySnapshot;
  /** Cached annotation layout for crosshair-only repaints. */
  annotationLayoutCache?: {
    solveKey: string;
    positionKey: string;
    placements: AnnotationPlacement[];
    occupancySnapshot?: ChartAnnotationOccupancySnapshot;
  };
  /** Cached solve signature for unchanged immutable annotation render inputs. */
  annotationSolveSignatureCache?: {
    geometryKey: string;
    annotations: readonly ChartAnnotation.Renderable[];
    drawingObjects: Chart.State["objects"];
    annotationCreate: Chart.State["annotationCreate"];
    sourceBadgesByAnnotationId: unknown;
    expandedCardsByAnnotationId: unknown;
    agentAnnotationIds: unknown;
    signature: string;
  };
  /** Compact annotation placements; event hit-testing expands them for the current interaction state. */
  annotationPlacements?: AnnotationPlacement[];
  /** Last painted annotation placements sorted topmost-first for pointer hit-testing. */
  annotationHitPlacements?: AnnotationPlacement[];
  /** Interaction state that produced the sorted annotation hit placements. */
  annotationHitPlacementsSignature?: AnnotationHitInteractionSignature;
  /** Runtime-only canvas pill width easing; layout/hit geometry remains canonical. */
  annotationPillMotions?: Map<string, AnnotationPillMotion>;
  /** True while canvas-owned annotation pill motion needs another light frame. */
  annotationPillMotionActive?: boolean;
  /** Runtime-only annotation drag preview; commits to Chart.State on mouseup. */
  annotationDragPreview?: {
    id: string;
    anchor: ChartAnnotation.Anchor;
  };
  /** Cached z-ordered annotation hit placements for unchanged painted placements. */
  annotationHitPlacementsCache?: {
    placements: readonly AnnotationPlacement[];
    ordered: AnnotationPlacement[];
  };
}

function isVisible(series: Series.State): boolean {
  const value = (series.options as Record<string, unknown>).visible;
  return value !== false;
}

function seriesRenderSignature(
  series: Series.State,
  yAxisId: string,
  yScale: CoordSys.Scale | undefined,
  transform: SeriesModeTransform | undefined,
): string {
  return [
    series.type,
    Series.getXAxisId(series),
    yAxisId,
    JSON.stringify(series.fieldMap ?? {}),
    transform?.signature ?? "raw",
    yScale?.extent[0] ?? "na",
    yScale?.extent[1] ?? "na",
    yScale?.range[0] ?? "na",
    yScale?.range[1] ?? "na",
    yScale?.mode ?? "na",
  ].join(":");
}

function hasLastValueVisible(series: Series.State): boolean {
  const value = (series.options as Record<string, unknown>).lastValueVisible;
  return value !== false;
}

function hasValueLineVisible(series: Series.State): boolean {
  const value = (series.options as Record<string, unknown>).valueLineVisible;
  return value !== false;
}

function chartAnnotationsForRender(
  state: Chart.State,
): ChartAnnotation.Renderable[] {
  const annotations = ChartStateModel.annotationItems(state);
  const draft = state.annotationCreate;
  if (!draft || draft.phase === "armed") {
    return annotations;
  }
  const now = new Date().toISOString();
  return [
    ...annotations,
    createDraftAnnotationRecord({
      id: draft.id,
      label: draft.label,
      anchor: draft.anchor,
      now,
    }),
  ];
}

function hiddenAnnotationTextIdsForRender(
  state: Chart.State,
): ReadonlySet<string> | undefined {
  const ids = new Set<string>();
  const draft = state.annotationCreate;
  if (draft && draft.phase !== "armed" && draft.phase !== "placing") {
    ids.add(draft.id);
  }
  if (state.editingAnnotationId) {
    ids.add(state.editingAnnotationId);
  }
  return ids.size > 0 ? ids : undefined;
}

function hiddenAnnotationBodyIdsForRender(
  state: Chart.State,
): ReadonlySet<string> | undefined {
  const ids = new Set<string>();
  const draft = state.annotationCreate;
  if (draft && draft.phase !== "armed" && draft.phase !== "placing") {
    ids.add(draft.id);
  }
  if (state.editingAnnotationId) {
    ids.add(state.editingAnnotationId);
  }
  const expanded = state.expandedAnnotation?.id;
  if (
    expanded &&
    (state.expandedCardsByAnnotationId?.[expanded] ||
      ChartStateModel.annotationItems(state).some(
        (item) => item.id === expanded && item.content,
      ))
  ) {
    ids.add(expanded);
  }
  return ids.size > 0 ? ids : undefined;
}

const ANNOTATION_PILL_MOTION_MS = 100;

function annotationMotionNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function easeAnnotationMotion(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return 1 - (1 - t) ** 4;
}

function prefersReducedAnnotationMotion(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rectCenter(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function motionProgress(motion: AnnotationPillMotion, now: number): number {
  const elapsed = (now - motion.startedAt) / ANNOTATION_PILL_MOTION_MS;
  return lerp(motion.from, motion.to, easeAnnotationMotion(elapsed));
}

function animatedAnnotationPlacement(
  placement: AnnotationPlacement,
  motion: AnnotationPillMotion,
  progress: number,
  now: number,
): AnnotationPlacement {
  const center = rectCenter(placement.pill);
  const width = lerp(
    placement.compactPill?.width ?? placement.pill.width,
    motion.hoverWidth,
    progress,
  );
  const pill = {
    x: center.x - width / 2,
    y: placement.pill.y,
    width,
    height: placement.pill.height,
  };
  const buttonSize = motion.buttonSize;
  const actionButton =
    progress > 0.01
      ? {
          x: pill.x + pill.width - buttonSize - 5,
          y: pill.y + (pill.height - buttonSize) / 2,
          width: buttonSize,
          height: buttonSize,
        }
      : placement.actionButton;
  return {
    ...placement,
    pill,
    handles: { ...placement.handles, label: rectCenter(pill) },
    leader: {
      from: leaderBoundaryPoint(pill, placement.leader.to),
      to: placement.leader.to,
    },
    actionButton,
    pillMotion: {
      progress,
      ...(placement.state === "hover" && placement.fullText !== placement.text
        ? { marqueeElapsedMs: Math.max(0, now - motion.startedAt) }
        : {}),
    },
    state: progress > 0.01 ? "hover" : placement.state,
  };
}

function animateAnnotationPillPlacements(
  runtime: RuntimeState,
  placements: readonly AnnotationPlacement[],
): AnnotationPlacement[] {
  if (prefersReducedAnnotationMotion()) {
    runtime.annotationPillMotions?.clear();
    runtime.annotationPillMotionActive = false;
    return placements as AnnotationPlacement[];
  }
  const now = annotationMotionNow();
  const motions =
    runtime.annotationPillMotions ??
    (runtime.annotationPillMotions = new Map());
  const seen = new Set<string>();
  let active = false;

  const result = placements.map((placement) => {
    const id = placement.annotation.id;
    seen.add(id);
    let motion = motions.get(id);
    if (placement.state === "hover") {
      const buttonSize = placement.actionButton?.width ?? 22;
      if (!motion) {
        motion = {
          from: 0,
          to: 1,
          startedAt: now,
          hoverWidth: placement.pill.width,
          buttonSize,
        };
        motions.set(id, motion);
      } else {
        motion.hoverWidth = placement.pill.width;
        motion.buttonSize = buttonSize;
        if (motion.to !== 1) {
          motion.from = motionProgress(motion, now);
          motion.to = 1;
          motion.startedAt = now;
        }
      }
    } else if (motion && motion.to !== 0) {
      motion.from = motionProgress(motion, now);
      motion.to = 0;
      motion.startedAt = now;
    }

    if (!motion) return placement;
    const progress = motionProgress(motion, now);
    const done = Math.abs(progress - motion.to) < 0.001;
    if (!done) active = true;
    if (placement.state === "hover" && placement.fullText !== placement.text) {
      active = true;
    }
    if (done && motion.to === 0) {
      motions.delete(id);
      return placement;
    }
    return animatedAnnotationPlacement(
      placement,
      motion,
      done ? motion.to : progress,
      now,
    );
  });

  for (const id of motions.keys()) {
    if (!seen.has(id)) motions.delete(id);
  }
  runtime.annotationPillMotionActive = active;
  return result;
}

function rounded(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1000) / 1000
    : null;
}

function annotationXStepSignature(render: RenderContext): number | null {
  const from = Math.max(0, Math.floor(render.visibleRange.from));
  const to = Math.min(
    render.data.length - 2,
    Math.ceil(render.visibleRange.to),
  );
  for (let index = from; index <= to; index++) {
    const current = render.xPositions[index] ?? render.xFn(index);
    const next = render.xPositions[index + 1] ?? render.xFn(index + 1);
    const step = Math.abs(next - current);
    if (Number.isFinite(step) && step > 0.0001) return rounded(step);
  }
  return null;
}

function annotationRowTimeSignature(row: unknown): unknown {
  return (row as { time?: number } | undefined)?.time;
}

function annotationYScaleShapeSignature(render: RenderContext): string {
  return Object.entries(render.coord.scales.y)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, scale]) => {
      return `${id}:${scale.mode}:${scale.range
        .map((value) => rounded(value))
        .join(",")}`;
    })
    .join("|");
}

function annotationYScalePositionSignature(render: RenderContext): string {
  return Object.entries(render.coord.scales.y)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, scale]) =>
        `${id}:${scale.mode}:${scale.extent
          .map((value) => rounded(value))
          .join(",")}:${scale.range.map((value) => rounded(value)).join(",")}`,
    )
    .join("|");
}

function annotationRenderSolveSignature(
  runtime: RuntimeState,
  state: Chart.State,
  render: RenderContext,
  annotations: readonly ChartAnnotation.Renderable[],
): string {
  const geometryKey = JSON.stringify({
    area: render.area,
    xStep: annotationXStepSignature(render),
    data: {
      length: render.data.length,
      first: annotationRowTimeSignature(render.data[0]),
      last: annotationRowTimeSignature(render.data.at(-1)),
    },
    y: annotationYScaleShapeSignature(render),
  });
  const sourceBadgesByAnnotationId = state.sourceBadgesByAnnotationId ?? null;
  const expandedCardsByAnnotationId = state.expandedCardsByAnnotationId ?? null;
  const agentAnnotationIds = state.agentAnnotationIds ?? null;
  const cached = runtime.annotationSolveSignatureCache;
  // @agent invariant: ChartCanvas render state is immutable between updates, so
  // reference equality is the safe owner-level cache key for annotation
  // resources. Crosshair-only light paints must not re-stringify every
  // annotation record.
  if (
    cached &&
    cached.geometryKey === geometryKey &&
    cached.annotations === state.annotations &&
    cached.drawingObjects === state.objects &&
    cached.annotationCreate === state.annotationCreate &&
    cached.sourceBadgesByAnnotationId === sourceBadgesByAnnotationId &&
    cached.expandedCardsByAnnotationId === expandedCardsByAnnotationId &&
    cached.agentAnnotationIds === agentAnnotationIds
  ) {
    return cached.signature;
  }
  const signature = JSON.stringify({
    geometry: geometryKey,
    annotations,
    sourceBadgesByAnnotationId,
    expandedCardsByAnnotationId,
    agentAnnotationIds,
  });
  runtime.annotationSolveSignatureCache = {
    geometryKey,
    annotations: state.annotations,
    drawingObjects: state.objects,
    annotationCreate: state.annotationCreate,
    sourceBadgesByAnnotationId,
    expandedCardsByAnnotationId,
    agentAnnotationIds,
    signature,
  };
  return signature;
}

function annotationRenderPositionSignature(render: RenderContext): string {
  const from = Math.max(0, Math.floor(render.visibleRange.from));
  const to = Math.min(
    render.data.length - 1,
    Math.ceil(render.visibleRange.to),
  );
  const mid = Math.floor((from + to) / 2);
  const xAt = (index: number) => {
    const value = render.xPositions[index] ?? render.xFn(index);
    return rounded(value);
  };
  return [
    rounded(render.visibleRange.from),
    rounded(render.visibleRange.to),
    from,
    xAt(from),
    mid,
    xAt(mid),
    to,
    xAt(to),
    render.data.length,
    annotationYScalePositionSignature(render),
  ].join("|");
}

function annotationHitPlacementsForPaint(
  runtime: RuntimeState,
  placements: readonly AnnotationPlacement[],
): AnnotationPlacement[] {
  const cached = runtime.annotationHitPlacementsCache;
  if (cached?.placements === placements) return cached.ordered;
  const ordered = orderChartAnnotationPlacementsForHit(placements);
  runtime.annotationHitPlacementsCache = { placements, ordered };
  return ordered;
}

function annotationHitInteractionSignature(
  state: Chart.State,
): AnnotationHitInteractionSignature {
  return {
    hoveredAnnotationId: state.hoveredAnnotationId,
    expandedAnnotation: state.expandedAnnotation
      ? { ...state.expandedAnnotation }
      : undefined,
    activeAnnotationId: state.activeAnnotationId,
  };
}

function seriesValueAtOrBefore(
  series: Series.State,
  time: number | undefined,
): number | undefined {
  // Resolve field names ONCE per call. The per-point readComparableValue path
  // re-merged the series field map (SeriesRegistry.get + spread) on every point,
  // and this scan runs per series inside buildComparisonModeTransforms every
  // anchor-drag frame — the merge allocation dominated, not the arithmetic.
  const closeField = resolveField(
    series,
    "close",
    series.fieldMap?.value ?? "close",
  );
  const valueField = resolveField(series, "value", "value");
  const data = series.data;

  if (time === undefined) {
    for (let i = 0; i < data.length; i++) {
      const record = data[i] as Record<string, unknown> | undefined;
      if (!record) continue;
      const value = comparableFrom(record, closeField, valueField);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  const timeField = resolveField(series, "time", "time") ?? "time";
  // O(log N) anchor lookup over time-sorted data (highest-time valid value at or
  // before `time`); falls back to the first valid value when nothing precedes.
  const bound = lastIndexAtOrBefore(data, timeField, time);
  for (let i = bound; i >= 0; i--) {
    const record = data[i] as Record<string, unknown> | undefined;
    if (!record) continue;
    const value = comparableFrom(record, closeField, valueField);
    if (value !== undefined) return value;
  }
  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown> | undefined;
    if (!record) continue;
    const value = comparableFrom(record, closeField, valueField);
    if (value !== undefined) return value;
  }
  return undefined;
}

function seriesLogReturns(series: Series.State): ReturnObservation[] {
  const timeField = resolveField(series, "time", "time") ?? "time";
  const returns: ReturnObservation[] = [];
  let previous: { time: number; value: number } | undefined;

  for (const point of series.data) {
    const record = point as Record<string, unknown>;
    const time = Data.readTime(record[timeField]);
    const value = readComparableValue(series, point);
    if (
      time === undefined ||
      value === undefined ||
      value <= 0 ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    if (previous) {
      const logReturn = Math.log(value / previous.value);
      if (Number.isFinite(logReturn)) {
        returns.push({ time, value: logReturn });
      }
    }
    previous = { time, value };
  }

  return returns;
}

function sampleStdDev(values: readonly number[]): number | undefined {
  if (values.length < 2) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  const stdDev = Math.sqrt(variance);
  return Number.isFinite(stdDev) && stdDev > 0 ? stdDev : undefined;
}

function comparisonVolatilityScale(
  main: Series.State | undefined,
  series: Series.State,
  adjustment: Chart.ComparisonAdjustment,
): number {
  if (adjustment.kind !== "volatility" || !main) return 1;

  const mainByTime = new Map(
    seriesLogReturns(main).map((point) => [point.time, point.value]),
  );
  const pairedMain: number[] = [];
  const pairedSeries: number[] = [];
  for (const point of seriesLogReturns(series)) {
    const mainReturn = mainByTime.get(point.time);
    if (mainReturn === undefined) continue;
    pairedMain.push(mainReturn);
    pairedSeries.push(point.value);
  }

  const mainVolatility = sampleStdDev(pairedMain);
  const seriesVolatility = sampleStdDev(pairedSeries);
  if (mainVolatility === undefined || seriesVolatility === undefined) return 1;

  const scale = mainVolatility / seriesVolatility;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function buildBasicModeTransform(
  series: Series.State,
  axis: Axis,
  baseline: number,
  signaturePrefix: string,
): SeriesModeTransform {
  const fields = modeTransformFields(series);
  return {
    fields,
    signature: `${signaturePrefix}:${axis.id}:${axis.mode}:${baseline}`,
    value: (raw) => modeTransformValue(axis, raw, baseline),
    point: (point) => transformPointForMode(point, axis, baseline, fields),
  };
}

function modeAnchorValue(axis: Axis): number {
  return axis.mode === "indexed" ? 100 : 0;
}

// Comparison participants always render as line series (durable comparison
// invariant), and a line's `transform` only reads the resolved `value` field
// per point (plus an optional per-point color). The previous per-point path
// spread the whole OHLC candle and transformed open/high/low/close even though
// only `close` is drawn — for 50 series × thousands of points re-projected every
// anchor-drag frame that allocation + wasted math dominated `series.transform`.
// This builds a minimal point carrying just the transformed value field, which
// is byte-identical for the line renderer.
function buildComparisonLinePoint(
  series: Series.State,
  value: (raw: number) => number,
): (point: Record<string, unknown>) => Record<string, unknown> {
  const valueField = resolveField(series, "value", "value");
  const colorField = resolveField(series, "color", "color");
  return (point) => {
    const raw = point[valueField];
    const next: Record<string, unknown> = {
      [valueField]:
        typeof raw === "number" && Number.isFinite(raw) ? value(raw) : raw,
    };
    const color = point[colorField];
    if (color !== undefined) next[colorField] = color;
    return next;
  };
}

function buildShiftedModeTransform(
  series: Series.State,
  axis: Axis,
  baseline: number,
  shift: number,
  signaturePrefix: string,
): SeriesModeTransform {
  const fields = modeTransformFields(series);
  const shifted = (raw: number): number =>
    modeTransformValue(axis, raw, baseline) + shift;
  return {
    fields,
    signature: `${signaturePrefix}:${axis.id}:${axis.mode}:${baseline}:${shift}`,
    value: shifted,
    point: buildComparisonLinePoint(series, shifted),
  };
}

function buildMappedValueTransform(
  series: Series.State,
  signature: string,
  value: (raw: number) => number,
): SeriesModeTransform {
  return {
    fields: modeTransformFields(series),
    signature,
    value,
    point: buildComparisonLinePoint(series, value),
  };
}

// A percentage/indexed/comparison mode transform is affine in the raw value, and
// the comparison y-scale is linear, so `pixel(close) = toPixel(value(close)) =
// toPixel(slope*close + intercept)` can be folded into the y-scale's extent. The
// renderer then projects the RAW data through the folded scale and gets
// byte-identical pixels WITHOUT the per-point `transform.point` allocation — the
// dominant cost when re-projecting every series every anchor-drag frame.
//
// Returns a coord with the folded scale, or null when the fold is not provably
// exact: a non-linear (log) scale, a non-affine transform (the equally-spaced
// sample check fails), a degenerate slope, or a non-finite sample.
function foldModeTransformIntoScale(
  coord: CoordSys.State,
  transform: SeriesModeTransform,
): CoordSys.State | null {
  const scaleId = coord.defaultYScale;
  const scale = coord.scales.y[scaleId];
  if (!scale || scale.mode !== "linear") return null;
  const v0 = transform.value(0);
  const v1 = transform.value(1);
  const v2 = transform.value(2);
  if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2)) {
    return null;
  }
  const slope = v1 - v0;
  if (!(Math.abs(slope) > 1e-12)) return null;
  // Equally-spaced inputs (0,1,2) must map to equally-spaced outputs for the
  // transform to be affine; otherwise fall back to the exact per-point path.
  if (Math.abs(v2 - v1 - slope) > 1e-6 * (1 + Math.abs(slope))) return null;
  const intercept = v0;
  const foldedExtent: [number, number] = [
    (scale.extent[0] - intercept) / slope,
    (scale.extent[1] - intercept) / slope,
  ];
  if (!Number.isFinite(foldedExtent[0]) || !Number.isFinite(foldedExtent[1])) {
    return null;
  }
  return {
    ...coord,
    scales: {
      ...coord.scales,
      y: { ...coord.scales.y, [scaleId]: { ...scale, extent: foldedExtent } },
    },
  };
}

function coordForRawSeriesValues(
  coord: CoordSys.State,
  axis: Pick<Axis, "id" | "mode"> | undefined,
  transform: SeriesModeTransform | undefined,
): CoordSys.State {
  if (
    !axis ||
    !transform ||
    (axis.mode !== "percentage" && axis.mode !== "indexed")
  ) {
    return coord;
  }
  const folded = foldModeTransformIntoScale(coord, transform);
  if (folded) return folded;
  throw new Error(
    `Invariant violated: ${axis.mode} axis ${axis.id} has a non-foldable raw-value transform`,
  );
}

function buildComparisonModeTransforms(
  state: Chart.State,
  allById: Map<string, Series.State>,
  axesById: Map<string, Axis>,
): Map<string, SeriesModeTransform> {
  const transforms = new Map<string, SeriesModeTransform>();
  const comparison = state.comparison;
  if (!comparison?.enabled) return transforms;

  const axis = axesById.get(comparison.axisId);
  if (!axis) return transforms;

  const anchorTime = Data.readTime(axis.modeAnchor?.time);
  const anchorValue = modeAnchorValue(axis);
  const main = allById.get(comparison.mainSeriesId);
  const display = comparison.display ?? "percentage_from_anchor";

  if (display === "indexed_to_main_at_anchor") {
    if (!main) return transforms;
    const mainAnchor = seriesValueAtOrBefore(main, anchorTime);
    if (mainAnchor === undefined) return transforms;

    transforms.set(
      main.id,
      buildMappedValueTransform(
        main,
        [
          "comparison:main:indexed-to-main",
          comparison.mode ?? "relative_performance",
          comparison.yScale ?? "linear",
          anchorTime ?? "first",
        ].join(":"),
        (raw) => raw,
      ),
    );

    for (const seriesId of comparison.auxiliarySeriesIds) {
      const series = allById.get(seriesId);
      if (!series || Series.getYAxisId(series) !== comparison.axisId) continue;
      const auxAnchor = seriesValueAtOrBefore(series, anchorTime);
      if (auxAnchor === undefined) continue;
      const adjustmentScale = comparisonVolatilityScale(
        main,
        series,
        comparison.adjustment,
      );
      transforms.set(
        series.id,
        buildMappedValueTransform(
          series,
          [
            "comparison:aux:indexed-to-main",
            comparison.mode ?? "relative_performance",
            comparison.yScale ?? "linear",
            anchorTime ?? "first",
            auxAnchor,
            mainAnchor,
            adjustmentScale,
            JSON.stringify(comparison.adjustment),
          ].join(":"),
          (raw) => mainAnchor * (1 + (raw / auxAnchor - 1) * adjustmentScale),
        ),
      );
    }

    return transforms;
  }

  if (axis.mode !== "percentage" && axis.mode !== "indexed") return transforms;

  let mainAnchorDisplay = anchorValue;
  if (main) {
    const mainAnchor = seriesValueAtOrBefore(main, anchorTime);
    const mainBaselineTime =
      Data.readTime(comparison.mainBaselineTime) ?? anchorTime;
    const mainBaseline = seriesValueAtOrBefore(main, mainBaselineTime);
    if (mainAnchor !== undefined && mainBaseline !== undefined) {
      mainAnchorDisplay = modeTransformValue(axis, mainAnchor, mainBaseline);

      transforms.set(
        main.id,
        buildShiftedModeTransform(
          main,
          axis,
          mainBaseline,
          anchorValue - mainAnchorDisplay,
          [
            "comparison:main",
            comparison.mode ?? "relative_performance",
            comparison.display ?? "percentage_from_anchor",
            comparison.yScale ?? "linear",
            mainBaselineTime ?? "first",
            anchorTime ?? "first",
          ].join(":"),
        ),
      );
    }
  }

  for (const seriesId of comparison.auxiliarySeriesIds) {
    const series = allById.get(seriesId);
    if (!series || Series.getYAxisId(series) !== comparison.axisId) continue;
    const auxAnchor = seriesValueAtOrBefore(series, anchorTime);
    if (auxAnchor === undefined) continue;
    const auxAnchorDisplay = modeTransformValue(axis, auxAnchor, auxAnchor);
    const adjustmentScale = comparisonVolatilityScale(
      main,
      series,
      comparison.adjustment,
    );
    const adjustedValue = (raw: number): number =>
      anchorValue +
      (modeTransformValue(axis, raw, auxAnchor) - auxAnchorDisplay) *
        adjustmentScale;
    transforms.set(
      series.id,
      buildMappedValueTransform(
        series,
        [
          "comparison:aux",
          comparison.mode ?? "relative_performance",
          comparison.display ?? "percentage_from_anchor",
          comparison.yScale ?? "linear",
          axis.id,
          axis.mode,
          anchorTime ?? "first",
          auxAnchor,
          anchorValue,
          auxAnchorDisplay,
          adjustmentScale,
          JSON.stringify(comparison.adjustment),
        ].join(":"),
        adjustedValue,
      ),
    );
  }

  return transforms;
}

function buildModeTransforms(
  state: Chart.State,
  all: Series.State[],
  seriesRanges: Map<string, Render.Range>,
  axes: Axis[],
): Map<string, SeriesModeTransform> {
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));
  const allById = new Map(all.map((series) => [series.id, series]));
  const transforms = buildComparisonModeTransforms(state, allById, axesById);
  const comparison = state.comparison;
  const comparisonSeriesIds =
    comparison?.enabled && comparison.axisId
      ? new Set([comparison.mainSeriesId, ...comparison.auxiliarySeriesIds])
      : undefined;

  for (const series of all) {
    if (transforms.has(series.id)) continue;
    const axis = axesById.get(Series.getYAxisId(series));
    if (!axis || (axis.mode !== "percentage" && axis.mode !== "indexed"))
      continue;
    if (
      comparison?.enabled &&
      comparison.axisId === axis.id &&
      comparisonSeriesIds?.has(series.id)
    ) {
      continue;
    }
    const range = seriesRanges.get(series.id) ?? {
      from: 0,
      to: series.data.length,
    };
    const ordinaryAxis = axis.modeAnchor
      ? ({ ...axis, modeAnchor: undefined } as Axis)
      : axis;
    const baseline = modeBaseline(series, range, ordinaryAxis);
    if (baseline === undefined) continue;
    transforms.set(
      series.id,
      buildBasicModeTransform(series, ordinaryAxis, baseline, "mode"),
    );
  }

  return transforms;
}

function computeExtents(
  state: Chart.State,
  all: Series.State[],
  seriesRanges: Map<string, Render.Range>,
  axes: Axis[],
  modeTransforms: Map<string, SeriesModeTransform>,
): {
  x: { min: number; max: number };
  y: Record<string, { min: number; max: number }>;
} {
  const x = { min: 0, max: 100 };
  const y: Record<string, { min: number; max: number }> = {};

  for (const s of all) {
    const def = SeriesRegistry.get(s.type);
    if (!def) continue;
    const scaleId = Series.getYAxisId(s);
    const comparison = state.comparison;
    const comparisonAxisOwnsScale =
      comparison?.enabled && comparison.axisId === scaleId;
    const comparisonSeriesIds = comparisonAxisOwnsScale
      ? new Set([comparison.mainSeriesId, ...comparison.auxiliarySeriesIds])
      : undefined;
    const shouldContributeYExtent =
      !comparisonAxisOwnsScale || comparisonSeriesIds?.has(s.id) === true;
    if (!shouldContributeYExtent) continue;

    const transform = modeTransforms.get(s.id);
    if (comparisonAxisOwnsScale && !transform) continue;

    if (!y[scaleId]) y[scaleId] = { min: Infinity, max: -Infinity };

    const range = seriesRanges.get(s.id) ?? { from: 0, to: s.data.length };
    const axis = axes.find((item) => item.id === scaleId);
    const modeExt = modeExtent(s, range, axis, transform);
    const ext =
      modeExt ?? def.visibleExtent(s.data, range.from, range.to, s.fieldMap);
    if (ext) {
      if (ext.min < y[scaleId]!.min) y[scaleId]!.min = ext.min;
      if (ext.max > y[scaleId]!.max) y[scaleId]!.max = ext.max;
      const base = (s.options as { base?: number }).base;
      if (
        (s.type === "Area" || s.type === "Histogram") &&
        typeof base === "number"
      ) {
        const value = transform ? transform.value(base) : base;
        if (Number.isFinite(value)) {
          y[scaleId]!.min = Math.min(y[scaleId]!.min, value);
          y[scaleId]!.max = Math.max(y[scaleId]!.max, value);
        }
      }
    }
  }

  if (Object.keys(y).length === 0) y.right = { min: 0, max: 100 };

  const axisSeriesMap = new Map<string, Series.State[]>();
  for (const series of all) {
    const axisId = Series.getYAxisId(series);
    const list = axisSeriesMap.get(axisId) ?? [];
    list.push(series);
    axisSeriesMap.set(axisId, list);
  }

  for (const axis of axes) {
    // Manual visible extents only apply while auto-scale is disabled.
    if (!axis.autoScale && axis.visibleExtent) {
      y[axis.id] = { min: axis.visibleExtent.min, max: axis.visibleExtent.max };
    }
    if (
      axis.autoScale &&
      axis.modeAnchor &&
      state.comparison?.enabled &&
      state.comparison.axisId === axis.id &&
      (axis.mode === "percentage" || axis.mode === "indexed")
    ) {
      const anchorValue = axis.mode === "indexed" ? 100 : 0;
      const extent = y[axis.id] ?? { min: anchorValue, max: anchorValue };
      extent.min = Math.min(extent.min, anchorValue);
      extent.max = Math.max(extent.max, anchorValue);
      y[axis.id] =
        state.comparison.fixedZeroAxis === true
          ? centerAnchorValueInExtent(extent, anchorValue)
          : extent;
    }
    const boundSeries = axisSeriesMap.get(axis.id) ?? [];
    const hasHistogram = boundSeries.some(
      (series) => series.type === "Histogram",
    );
    const lockZeroEligible =
      boundSeries.length > 0 &&
      boundSeries.every(
        (series) => series.type === "Histogram" || !!series.parentId,
      );
    if ((hasHistogram || (axis.lockZero && lockZeroEligible)) && y[axis.id]) {
      y[axis.id]!.min = Math.min(0, y[axis.id]!.min);
      y[axis.id]!.max = Math.max(0, y[axis.id]!.max);
    }
    if (y[axis.id] && y[axis.id]!.min === Infinity) {
      y[axis.id] = { min: 0, max: 100 };
    }
  }

  return { x, y };
}

function cloneExtents(extents: {
  x: { min: number; max: number };
  y: Record<string, { min: number; max: number }>;
}): {
  x: { min: number; max: number };
  y: Record<string, { min: number; max: number }>;
} {
  const y: Record<string, { min: number; max: number }> = {};
  for (const key of Object.keys(extents.y)) {
    const bound = extents.y[key]!;
    y[key] = { min: bound.min, max: bound.max };
  }
  return { x: { min: extents.x.min, max: extents.x.max }, y };
}

// @agent invariant: must enumerate EVERY value read by buildModeTransforms and
// computeExtents. If you add an input to either (a new comparison field, axis
// property, or per-series attribute that changes the transform or extent), add
// it here or the cache will serve stale geometry. The signature is intentionally
// value-based (not reference-based) because the render projection rebuilds a
// fresh Chart.State object every frame.
// Monotonic id per series-data array reference. Series data is updated
// immutably (setSeriesData / live-merge replace the array), so a new reference
// means the data changed — including interior-only rewrites that preserve length
// and endpoints, which buildModeTransforms reads when comparison uses a
// volatility/beta adjustment or an explicit mainBaselineTime. Keying the
// mode/extent signature on this id is both cheaper than digesting endpoints and
// airtight against those interior reads.
let nextDataRevision = 1;
const dataRevisionCache = new WeakMap<readonly unknown[], number>();
function dataRevisionId(data: readonly unknown[]): number {
  let id = dataRevisionCache.get(data);
  if (id === undefined) {
    id = nextDataRevision;
    nextDataRevision += 1;
    dataRevisionCache.set(data, id);
  }
  return id;
}

function computeModeExtentSignature(
  state: Chart.State,
  all: Series.State[],
  seriesRanges: Map<string, Render.Range>,
  axes: Axis[],
): string {
  const parts: string[] = [];
  const c = state.comparison;
  parts.push(
    c
      ? `c|${c.enabled}|${c.axisId}|${c.mainSeriesId}|${c.auxiliarySeriesIds.join(",")}|${c.display ?? ""}|${c.yScale ?? ""}|${c.mode ?? ""}|${c.mainBaselineTime ?? ""}|${c.fixedZeroAxis === true}|${JSON.stringify(c.adjustment)}`
      : "c|none",
  );
  for (const axis of axes) {
    const ext = axis.visibleExtent;
    parts.push(
      `a|${axis.id}|${axis.mode}|${axis.modeAnchor?.time ?? ""}|${axis.autoScale}|${ext ? `${ext.min},${ext.max}` : ""}|${axis.lockZero ?? ""}`,
    );
  }
  for (const s of all) {
    const range = seriesRanges.get(s.id);
    // dataRevisionId(s.data) busts on any data change (append/prepend/live
    // revision/interior rewrite); range covers pan/zoom; the rest covers
    // identity and axis binding.
    parts.push(
      `s|${s.id}|${s.type}|${Series.getYAxisId(s)}|${dataRevisionId(s.data)}|${JSON.stringify(s.fieldMap ?? null)}|${range ? `${range.from}-${range.to}` : ""}|${(s.options as { base?: number }).base ?? ""}`,
    );
  }
  return parts.join(";");
}

function getSeriesColor(s: Series.State): string {
  const opts = s.options as Record<string, unknown>;
  if (s.type === "Histogram") {
    const valueField = s.fieldMap?.value ?? "value";
    const colorField = s.fieldMap?.color ?? "color";
    // Only the last two finite values (plus the last point's explicit color)
    // determine the bar color, so scan backward and stop once both are found
    // instead of walking the whole series every render — the volume histogram
    // can hold thousands of bars and this ran on every crosshair repaint.
    let previousValue: number | undefined;
    let lastValue: number | undefined;
    let lastExplicitColor: unknown;
    const data = s.data as Array<Record<string, unknown> | undefined>;
    for (let i = data.length - 1; i >= 0; i--) {
      const point = data[i];
      const value = Number(point?.[valueField]);
      if (!Number.isFinite(value)) continue;
      if (lastValue === undefined) {
        lastValue = value;
        lastExplicitColor = point?.[colorField];
      } else {
        previousValue = value;
        break;
      }
    }
    if (lastValue !== undefined) {
      return resolveHistogramBarColor({
        options: s.options as Series.HistogramOptions,
        value: lastValue,
        previousValue,
        explicitColor: lastExplicitColor,
      });
    }
  }
  if (s.type === "Bar" || s.type === "Candlestick") {
    for (let i = s.data.length - 1; i >= 0; i--) {
      const point = s.data[i] as Record<string, unknown> | undefined;
      if (!point) continue;
      const open = readNumber(point, s, "open", "open");
      const close = readNumber(point, s, "close", "close");
      if (open === undefined || close === undefined) continue;
      return close < open
        ? typeof opts.downColor === "string"
          ? opts.downColor
          : "#ef5350"
        : typeof opts.upColor === "string"
          ? opts.upColor
          : "#26a69a";
    }
  }
  if ("color" in opts && typeof opts.color === "string") return opts.color;
  if ("lineColor" in opts && typeof opts.lineColor === "string")
    return opts.lineColor;
  if ("upColor" in opts && typeof opts.upColor === "string")
    return opts.upColor;
  if ("topLineColor" in opts && typeof opts.topLineColor === "string")
    return opts.topLineColor;
  return "#2196F3";
}

function formatValue(value: number): string {
  const absValue = Math.abs(value);
  const precision = absValue >= 1000 ? 2 : absValue >= 1 ? 2 : 4;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function formatXValue(axis: XAxis, value: unknown): string {
  if (value === undefined || value === null) return "";
  if ((axis.field ?? "time") === "time") {
    return TimeScale.format(value as never);
  }
  return String(value);
}

function formatAxisValue(axis: Axis | undefined, value: number): string {
  const custom = (axis as Record<string, unknown> | undefined)?.formatter;
  if (typeof custom === "function")
    return (custom as (v: number) => string)(value);
  if (axis?.mode === "percentage") {
    return `${value.toFixed(2)}%`;
  }
  return formatValue(value);
}

function fixedComparisonAnchorCrosshairSnap(
  state: Chart.State,
  axis: Axis | undefined,
  yScale: CoordSys.Scale | undefined,
  y: number,
): { y: number; label: string } | undefined {
  const comparison = state.comparison;
  if (!axis || !yScale || !comparison?.enabled) return undefined;
  if (comparison.axisId !== axis.id) return undefined;
  if (comparison.fixedZeroAxis !== true) return undefined;
  if (axis.mode !== "percentage" && axis.mode !== "indexed") return undefined;
  const anchorValue = modeAnchorValue(axis);
  const anchorY = CoordSys.toPixel(anchorValue, yScale);
  if (!Number.isFinite(anchorY)) return undefined;
  if (Math.abs(y - anchorY) > FIXED_COMPARISON_ANCHOR_SNAP_PX) {
    return undefined;
  }
  return { y: anchorY, label: formatAxisValue(axis, anchorValue) };
}

function pointSessionType(point: unknown): string | undefined {
  if (!point || typeof point !== "object") return undefined;
  const type = (point as { sessionType?: unknown }).sessionType;
  return typeof type === "string" ? type : undefined;
}

function pointSessionInterval(
  point: unknown,
): { start: number; end: number } | undefined {
  if (!point || typeof point !== "object") return undefined;
  const candidate = point as { sessionStart?: unknown; sessionEnd?: unknown };
  if (
    typeof candidate.sessionStart !== "number" ||
    typeof candidate.sessionEnd !== "number" ||
    !Number.isFinite(candidate.sessionStart) ||
    !Number.isFinite(candidate.sessionEnd) ||
    candidate.sessionEnd <= candidate.sessionStart
  ) {
    return undefined;
  }
  return { start: candidate.sessionStart, end: candidate.sessionEnd };
}

function isExtendedSessionType(
  type: string | undefined,
): type is "pre" | "post" | "overnight" {
  return type === "pre" || type === "post" || type === "overnight";
}

function pointTimeSeconds(
  series: Series.State,
  point: unknown,
  xField: string,
): number | undefined {
  return (
    readNumber(point, series, "x", xField) ??
    readNumber(point, series, "time", "time")
  );
}

// Series data ascends by time (see INVARIANTS.md), so a binary search finds the
// bars around a time; times beyond either end extrapolate from the two
// nearest bars.
function projectedXForTime(
  series: Series.State,
  runtime: SeriesXRuntime,
  targetSec: number,
  xField: string,
): number | undefined {
  const { data } = series;
  if (data.length === 0 || !Number.isFinite(targetSec)) return undefined;
  const at = (index: number) => {
    const time = pointTimeSeconds(series, data[index], xField);
    return time === undefined ? undefined : { index, time };
  };
  if (data.length === 1) return at(0) ? runtime.xFn(0) : undefined;
  // The first bar after the first one that opens at or after the target.
  let low = 1;
  let high = data.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    const time = at(middle)?.time;
    if (time !== undefined && time >= targetSec) high = middle;
    else low = middle + 1;
  }
  const left = at(low - 1);
  const right = at(low);
  return left && right
    ? interpolateXForTime(runtime, left, right, targetSec)
    : undefined;
}

function interpolateXForTime(
  runtime: SeriesXRuntime,
  left: { index: number; time: number },
  right: { index: number; time: number },
  targetSec: number,
): number {
  const span = right.time - left.time;
  const indexSpan = right.index - left.index;
  if (span <= 0 || indexSpan <= 0) return runtime.xFn(right.index);
  return runtime.xFn(left.index + ((targetSec - left.time) / span) * indexSpan);
}

function effectiveAxisSide(
  axis: Pick<Axis, "fixed" | "visible" | "side"> | undefined,
): Axis["side"] {
  if (!axis) return "right";
  if (axis.fixed === false || axis.visible === false) return "right";
  return axis.side === "left" ? "left" : "right";
}

function withAlpha(hex: string, alpha: number): string {
  if (!Color.isHex(hex)) {
    return hex;
  }
  const { r, g, b } = Color.toRGB(hex);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

function emphasizeColor(
  color: unknown,
  options?: {
    alphaBoost?: number;
    hexFactor?: number;
    fallback?: string;
  },
): string {
  const fallback = options?.fallback ?? Color.resolve(SERIES_FOCUS_GLOW_COLOR);
  const alphaBoost = options?.alphaBoost ?? 0.28;
  const hexFactor = options?.hexFactor ?? 0.22;
  if (typeof color !== "string" || !color.trim()) return fallback;
  const input = color.trim();

  if (Color.isHex(input)) {
    return Color.salient(input);
  }

  const rgbaMatch = input.match(
    /^rgba\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([0-9]*\.?[0-9]+)\s*\)$/i,
  );
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    const nextAlpha = Math.max(0, Math.min(1, Number(a) + alphaBoost));
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha.toFixed(2)})`;
  }

  const hslAlphaMatch = input.match(
    /^hsl\(\s*(.+?)\s*\/\s*([0-9]*\.?[0-9]+)\s*\)$/i,
  );
  if (hslAlphaMatch) {
    const [, body, a] = hslAlphaMatch;
    const nextAlpha = Math.max(0, Math.min(1, Number(a) + alphaBoost));
    return `hsl(${body!.trim()} / ${nextAlpha.toFixed(2)})`;
  }

  const hslMatch = input.match(/^hsl\(\s*(.+)\s*\)$/i);
  if (hslMatch) {
    return `hsl(${hslMatch[1]!.trim()} / ${(0.72).toFixed(2)})`;
  }

  if (input.startsWith("rgb(")) {
    const rgbBody = input.slice(4, -1);
    return `rgba(${rgbBody}, ${(0.82).toFixed(2)})`;
  }

  if (Color.isHex(fallback)) {
    return Color.lighten(fallback, hexFactor);
  }
  return fallback;
}

function focusedRenderOptions(
  series: Series.State,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const focusColor = Color.resolve(SERIES_FOCUS_GLOW_COLOR);
  const lineWidth =
    typeof base.lineWidth === "number" ? Math.max(1, base.lineWidth + 1) : 2;

  if (series.type === "Line") {
    return {
      ...base,
      color: emphasizeColor(base.color, { fallback: focusColor }),
      lineWidth,
    };
  }

  if (series.type === "Area") {
    return {
      ...base,
      lineColor: emphasizeColor(base.lineColor ?? base.color, {
        fallback: focusColor,
      }),
      topColor: emphasizeColor(base.topColor, {
        alphaBoost: 0.34,
        fallback: focusColor,
      }),
      bottomColor: emphasizeColor(base.bottomColor, {
        alphaBoost: 0.26,
        fallback: focusColor,
      }),
      lineWidth,
    };
  }

  if (series.type === "Histogram") {
    return {
      ...base,
      color: emphasizeColor(base.color, {
        alphaBoost: 0.36,
        fallback: focusColor,
      }),
    };
  }

  if (series.type === "Bar") {
    return {
      ...base,
      upColor: emphasizeColor(base.upColor ?? base.color, {
        fallback: focusColor,
      }),
      downColor: emphasizeColor(base.downColor ?? base.color, {
        fallback: focusColor,
      }),
    };
  }

  if (series.type === "Candlestick") {
    const up = emphasizeColor(
      base.upColor ?? base.borderUpColor ?? base.color,
      {
        fallback: focusColor,
      },
    );
    const down = emphasizeColor(
      base.downColor ?? base.borderDownColor ?? base.color,
      {
        fallback: focusColor,
      },
    );
    return {
      ...base,
      upColor: up,
      downColor: down,
      borderUpColor: emphasizeColor(base.borderUpColor ?? up, { fallback: up }),
      borderDownColor: emphasizeColor(base.borderDownColor ?? down, {
        fallback: down,
      }),
      wickUpColor: emphasizeColor(base.wickUpColor ?? up, { fallback: up }),
      wickDownColor: emphasizeColor(base.wickDownColor ?? down, {
        fallback: down,
      }),
    };
  }

  if (series.type === "Baseline") {
    return {
      ...base,
      topLineColor: emphasizeColor(base.topLineColor ?? base.color, {
        fallback: focusColor,
      }),
      bottomLineColor: emphasizeColor(base.bottomLineColor ?? base.color, {
        fallback: focusColor,
      }),
      topFillColor1: emphasizeColor(base.topFillColor1, {
        alphaBoost: 0.3,
        fallback: focusColor,
      }),
      topFillColor2: emphasizeColor(base.topFillColor2, {
        alphaBoost: 0.3,
        fallback: focusColor,
      }),
      bottomFillColor1: emphasizeColor(base.bottomFillColor1, {
        alphaBoost: 0.3,
        fallback: focusColor,
      }),
      bottomFillColor2: emphasizeColor(base.bottomFillColor2, {
        alphaBoost: 0.3,
        fallback: focusColor,
      }),
      lineWidth,
    };
  }

  return {
    ...base,
    color: emphasizeColor(base.color, { fallback: focusColor }),
    lineWidth,
  };
}

function compareValueTagPaintOrder(
  a: { focused: boolean; stableOrder: number },
  b: { focused: boolean; stableOrder: number },
): number {
  if (a.focused !== b.focused) return a.focused ? 1 : -1;
  return a.stableOrder - b.stableOrder;
}

function focusedValueTagBorderColor(textColor: string): string {
  return Color.withAlpha(textColor, 0.38);
}

function focusedValueTagFont(font: string): string {
  return `600 ${font}`;
}

function panesForRender(state: Chart.State): RenderPane[] {
  const source =
    state.panes.length > 0
      ? state.panes
      : [
          {
            id: ChartStateModel.MAIN_PANE_ID,
            index: 0,
            height: state.config.chart.dimensions.height,
            objectIds: [],
          },
        ];

  const byIndex = new Map<number, RenderPane>();
  for (let i = 0; i < source.length; i++) {
    const pane = source[i]!;
    const index = Number.isFinite(pane.index)
      ? Math.max(0, Math.floor(pane.index))
      : i;
    byIndex.set(index, {
      id:
        pane.id ||
        (index === 0 ? ChartStateModel.MAIN_PANE_ID : `pane-${index + 1}`),
      index,
      height: Number.isFinite(pane.height)
        ? pane.height
        : state.config.chart.dimensions.height,
      objectIds: Array.isArray(pane.objectIds) ? pane.objectIds : [],
    });
  }

  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

function paneBounds(
  state: Chart.State,
  areaX: number,
  areaWidth: number,
  areaHeight: number,
): Map<string, { x: number; y: number; width: number; height: number }> {
  const panes = panesForRender(state);
  const sum = panes.reduce((acc, pane) => acc + Math.max(1, pane.height), 0);
  const map = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  let cursorY = 0;
  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i]!;
    const isLast = i === panes.length - 1;
    const paneHeight = isLast
      ? Math.max(0, areaHeight - cursorY)
      : Math.max(0, (Math.max(1, pane.height) / sum) * areaHeight);
    map.set(pane.id, {
      x: areaX,
      y: cursorY,
      width: areaWidth,
      height: paneHeight,
    });
    cursorY += paneHeight;
  }
  return map;
}

function seriesPaneIds(state: Chart.State): Map<string, string> {
  const panes = panesForRender(state);
  const map = new Map<string, string>();
  for (const pane of panes) {
    for (const objectId of pane.objectIds ?? []) {
      const object = state.objects?.[ChartObjectId.parse(objectId)] as
        { kind?: string; seriesId?: string } | undefined;
      if (object?.kind !== "series" || !object.seriesId) continue;
      if (!map.has(object.seriesId)) {
        map.set(object.seriesId, pane.id);
      }
    }
  }
  return map;
}

function primarySeriesIdInPane(
  state: Chart.State,
  paneId: string,
): string | undefined {
  const pane = state.panes.find((item) => item.id === paneId);
  if (!pane) return undefined;
  const idsFromObjects = (pane.objectIds ?? [])
    .map((objectId) => {
      const object = state.objects?.[objectId] as
        { kind?: string; seriesId?: string } | undefined;
      return object?.kind === "series" ? object.seriesId : undefined;
    })
    .filter((id): id is string => !!id);
  const candidateIds = idsFromObjects;
  const declaredMain = candidateIds.find(
    (id) => ChartStateModel.getSeriesObject(state, id)?.role === "main",
  );
  if (declaredMain) return declaredMain;
  for (const seriesId of candidateIds) {
    const series = ChartStateModel.getSeries(state, seriesId);
    if (!series) continue;
    if (series.parentId) continue;
    if (series.type === "Histogram") continue;
    return seriesId;
  }
  return candidateIds[0];
}

function lastVisibleSeriesPoint(
  series: Series.State,
  xRuntime: SeriesXRuntime,
  axis: Axis | undefined,
  yScale: CoordSys.Scale,
  transform: SeriesModeTransform | undefined,
  bounds?: { x: number; y: number; width: number; height: number },
): { index: number; x: number; y: number; value: number } | undefined {
  const from = Math.max(0, xRuntime.range.from);
  const to = Math.min(
    series.data.length,
    Math.max(from + 1, xRuntime.range.to),
  );
  const needsBaseline = axis?.mode === "percentage" || axis?.mode === "indexed";
  if (needsBaseline && !transform) return undefined;

  const minX = bounds ? bounds.x - 2 : Number.NEGATIVE_INFINITY;
  const maxX = bounds ? bounds.x + bounds.width + 2 : Number.POSITIVE_INFINITY;

  const pointAt = (
    i: number,
  ): { index: number; x: number; y: number; value: number } | undefined => {
    const point = series.data[i] as Record<string, unknown> | undefined;
    if (!point) return undefined;
    const rawValue =
      readNumber(point, series, "close", series.fieldMap?.value ?? "close") ??
      readNumber(point, series, "value", "value") ??
      readNumber(point, series, "high", series.fieldMap?.value ?? "high") ??
      readNumber(point, series, "low", series.fieldMap?.value ?? "low");
    if (rawValue === undefined) return undefined;
    const value = transform ? transform.value(rawValue) : rawValue;
    if (!Number.isFinite(value)) return undefined;
    const x = xRuntime.xPositions[i] ?? xRuntime.xFn(i);
    if (!Number.isFinite(x)) return undefined;
    if (x < minX || x > maxX) return undefined;
    const y = CoordSys.toPixel(value, yScale);
    if (!Number.isFinite(y)) return undefined;
    return { index: i, x, y, value };
  };

  for (let i = to - 1; i >= from; i--) {
    const candidate = pointAt(i);
    if (candidate) return candidate;
  }

  for (let i = series.data.length - 1; i >= 0; i--) {
    if (i >= from && i < to) continue;
    const candidate = pointAt(i);
    if (candidate) return candidate;
  }

  return undefined;
}

function sessionAxisValue(
  rawValue: number | undefined,
  transform: SeriesModeTransform | undefined,
): number | undefined {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return undefined;
  }
  const value = transform ? transform.value(rawValue) : rawValue;
  return Number.isFinite(value) ? value : undefined;
}

function modeExtent(
  series: Series.State,
  range: Render.Range,
  axis: Axis | undefined,
  transform: SeriesModeTransform | undefined,
): { min: number; max: number } | undefined {
  void axis;
  if (!transform) return undefined;
  // The raw high/low extent over the visible range is anchor-independent and
  // cached; the mode transform is monotonic in the raw value for a fixed
  // per-series baseline, so the transformed extent is the transform applied to
  // {minLo, maxHi}. This collapses the per-anchor-frame cost from O(visible
  // points) to O(1) per series. (Math.min/max guards against an inverted
  // transform, which percentage/indexed with a positive baseline never is.)
  const raw = rawVisibleExtent(series, range.from, range.to);
  if (!raw.valid) return undefined;
  const tLo = transform.value(raw.minLo);
  const tHi = transform.value(raw.maxHi);
  if (!Number.isFinite(tLo) || !Number.isFinite(tHi)) return undefined;
  return { min: Math.min(tLo, tHi), max: Math.max(tLo, tHi) };
}

function drawFloatingAxis(
  ctx: CanvasRenderingContext2D,
  axis: Axis,
  marks: PriceAxis.TickMark[],
  font: string,
  textColor: string,
  lineColor: string,
  segment: { x: number; top: number; bottom: number },
): void {
  const { x, top, bottom } = segment;
  const side = effectiveAxisSide(axis);
  const textOffset = side === "right" ? 8 : -8;
  const tickStart = side === "right" ? x : x - 6;
  const tickEnd = side === "right" ? x + 6 : x;

  const gradient = ctx.createLinearGradient(x, top, x, bottom);
  gradient.addColorStop(0, withAlpha(lineColor, 0));
  gradient.addColorStop(0.15, withAlpha(lineColor, 0.75));
  gradient.addColorStop(0.85, withAlpha(lineColor, 0.75));
  gradient.addColorStop(1, withAlpha(lineColor, 0));

  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();

  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textAlign = side === "right" ? "left" : "right";
  ctx.textBaseline = "middle";
  for (const mark of marks) {
    const y = mark.y;
    if (y < top || y > bottom) continue;
    ctx.strokeStyle = withAlpha(lineColor, 0.65);
    ctx.beginPath();
    ctx.moveTo(tickStart, Math.round(y) + 0.5);
    ctx.lineTo(tickEnd, Math.round(y) + 0.5);
    ctx.stroke();
    const labelX = side === "right" ? x + textOffset : x + textOffset;
    const label =
      axis.mode === "percentage" && !mark.label.includes("%")
        ? `${mark.label}%`
        : mark.label;
    ctx.fillText(label, labelX, y);
  }
  ctx.restore();
}

function buildSeriesXRuntimes(
  state: Chart.State,
  all: Series.State[],
  areaX: number,
  areaWidth: number,
): {
  seriesMap: Map<string, SeriesXRuntime>;
  seriesRanges: Map<string, Render.Range>;
  axisRanges: RangeMap;
} {
  const xAxes =
    Array.isArray(state.config.xAxis.axes) && state.config.xAxis.axes.length > 0
      ? (state.config.xAxis.axes as XAxis[])
      : [getAxis(state.config.xAxis, state.config.xAxis.activeId)];

  const seriesMap = new Map<string, SeriesXRuntime>();
  const seriesRanges = new Map<string, Render.Range>();
  const axisRanges: RangeMap = {};

  for (const axis of xAxes) {
    const bound = axisSeries(all, axis.id);
    if (axis.mode === "ordinal") {
      const len = axisDataLength(all, axis.id);
      const { range, valid } = ordinalVisibleRange(
        state.config,
        axis,
        areaWidth,
        len,
      );
      axisRanges[axis.id] = { from: range.from, to: range.to };

      const scale = buildOrdinalScale(state.config, axis, areaWidth);
      const barWidth = TimeScale.barWidth(scale);
      const axisXPositions: number[] = [];
      const xFrom = Math.max(0, valid.from - 1);
      const xTo = Math.min(Math.max(0, len), valid.to + 2);
      const axisXFn = (index: number) =>
        areaX + Number(TimeScale.indexToX(scale, index, Math.max(1, len)));
      for (let i = xFrom; i < xTo; i++) axisXPositions[i] = axisXFn(i);

      for (const series of bound) {
        const offset = Number(series.options.xOffset ?? 0);
        const clampedRange = {
          from: Math.max(
            0,
            offset === 0 ? valid.from : Math.floor(range.from - offset),
          ),
          to: Math.min(
            series.data.length,
            offset === 0 ? valid.to : Math.ceil(range.to - offset),
          ),
        };
        const xFn =
          offset === 0 ? axisXFn : (index: number) => axisXFn(index + offset);
        const xPositions = offset === 0 ? axisXPositions : [];
        if (offset !== 0)
          for (
            let i = Math.max(0, clampedRange.from - 1);
            i < Math.min(series.data.length, clampedRange.to + 2);
            i++
          )
            xPositions[i] = xFn(i);

        seriesMap.set(series.id, {
          xFn,
          xPositions,
          range: clampedRange,
          barWidth,
        });
        seriesRanges.set(series.id, clampedRange);
      }
      continue;
    }

    const domain = deriveLinearDomain(axis, bound);
    let axisFrom = Infinity;
    let axisTo = -Infinity;

    for (const series of bound) {
      const values = linearSeriesValues(series, axis);
      const offset = Number(series.options.xOffset ?? 0);
      const visible = linearVisibleRange(values, domain);
      const range = {
        from: Math.max(0, visible.from - offset),
        to: Math.min(series.data.length, visible.to - offset),
      };
      axisFrom = Math.min(axisFrom, visible.from);
      axisTo = Math.max(axisTo, visible.to);
      const barWidth = linearBarWidth(
        values,
        domain,
        areaWidth,
        axis.spacing.barSpacing,
      );
      const xFn = (index: number) => {
        const target = index + offset;
        const edge = target < 0 ? 0 : values.length - 1;
        const neighbour = target < 0 ? 1 : edge - 1;
        const xValue =
          values[target] ??
          (values.length >= 2
            ? values[edge]! +
              ((target - edge) * (values[edge]! - values[neighbour]!)) /
                (edge - neighbour)
            : undefined);
        if (!Number.isFinite(xValue)) return areaX;
        return areaX + linearValueToX(xValue!, domain, areaWidth);
      };
      const xPositions: number[] = [];
      const xFrom = Math.max(0, range.from - 1);
      const xTo = Math.min(series.data.length, range.to + 2);
      for (let i = xFrom; i < xTo; i++) xPositions[i] = xFn(i);

      seriesMap.set(series.id, {
        xFn,
        xPositions,
        range,
        barWidth,
      });
      seriesRanges.set(series.id, range);
    }

    if (axisFrom === Infinity || axisTo === -Infinity) {
      axisRanges[axis.id] = { from: 0, to: 0 };
    } else {
      axisRanges[axis.id] = { from: axisFrom, to: axisTo };
    }
  }

  for (const series of all) {
    if (seriesMap.has(series.id)) continue;
    const xPositions: number[] = [];
    const xFn = (index: number) => areaX + index;
    for (let i = 0; i < series.data.length; i++) xPositions[i] = xFn(i);
    seriesMap.set(series.id, {
      xFn,
      xPositions,
      range: { from: 0, to: series.data.length },
      barWidth: 5,
    });
    seriesRanges.set(series.id, { from: 0, to: series.data.length });
  }

  return { seriesMap, seriesRanges, axisRanges };
}

function drawLiveIndicatorDot(
  ctx: CanvasRenderingContext2D,
  lastX: number,
  y: number,
  seriesColor: string,
  livePulseTime?: number,
): void {
  const PULSE_PERIOD = 1000;
  const now = performance.now();
  const elapsed = livePulseTime ? now - livePulseTime : PULSE_PERIOD;
  const progress = Math.min(Math.max(elapsed / PULSE_PERIOD, 0), 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  const pulseAlpha = 1 - progress;

  ctx.save();

  // Polymarket-style live marker: one filled disk expands and fades after a
  // real data arrival, with a solid endpoint dot always anchored at the tip.
  if (pulseAlpha > 0.01) {
    const diskRadius = 4 + eased * 10;
    ctx.globalAlpha = 0.24 * pulseAlpha;
    ctx.fillStyle = seriesColor;
    ctx.beginPath();
    ctx.arc(lastX, y, diskRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = seriesColor;
  ctx.beginPath();
  ctx.arc(lastX, y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function seriesValueAt(
  series: Series.State,
  index: number,
  transform: SeriesModeTransform | undefined,
): number | undefined {
  const point = series.data[index] as Record<string, unknown> | undefined;
  if (!point) return undefined;
  const rawValue =
    readNumber(point, series, "value", "value") ??
    readNumber(point, series, "close", series.fieldMap?.value ?? "close") ??
    readNumber(point, series, "high", series.fieldMap?.value ?? "high") ??
    readNumber(point, series, "low", series.fieldMap?.value ?? "low");
  if (rawValue === undefined) return undefined;
  const value = transform ? transform.value(rawValue) : rawValue;
  return Number.isFinite(value) ? value : undefined;
}

function renderLineBandFills(input: {
  ctx: CanvasRenderingContext2D;
  all: Series.State[];
  seriesMap: Map<string, SeriesXRuntime>;
  coordForAxis: (axisId: string) => CoordSys.State;
  modeTransforms: Map<string, SeriesModeTransform>;
  paneRectForSeries: (seriesId: string) => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  clipToRect: (
    rect: { x: number; y: number; width: number; height: number },
    draw: () => void,
  ) => void;
  isVisible: (series: Series.State) => boolean;
}): void {
  const byId = new Map(input.all.map((series) => [series.id, series]));
  for (const upperSeries of input.all) {
    if (!input.isVisible(upperSeries)) continue;
    const upperOptions = upperSeries.options as Record<string, unknown>;
    const lowerSeriesId = upperOptions.bandFillToSeriesId;
    if (typeof lowerSeriesId !== "string") continue;
    const lowerSeries = byId.get(lowerSeriesId);
    if (!lowerSeries || !input.isVisible(lowerSeries)) continue;

    const axisId = Series.getYAxisId(upperSeries);
    if (Series.getYAxisId(lowerSeries) !== axisId) continue;
    const upperRuntime = input.seriesMap.get(upperSeries.id);
    if (!upperRuntime) continue;
    const yScale = input.coordForAxis(axisId).scales.y[axisId];
    if (!yScale) continue;

    const upperTransform = input.modeTransforms.get(upperSeries.id);
    const lowerTransform = input.modeTransforms.get(lowerSeries.id);
    const paneRect = input.paneRectForSeries(upperSeries.id);
    const fillColor =
      typeof upperOptions.bandFillColor === "string"
        ? upperOptions.bandFillColor
        : "rgba(155, 109, 243, 0.12)";

    const from = Math.max(0, Math.floor(upperRuntime.range.from));
    const to = Math.min(
      upperSeries.data.length,
      lowerSeries.data.length,
      Math.ceil(upperRuntime.range.to),
    );
    let topPath: Array<{ x: number; y: number }> = [];
    let bottomPath: Array<{ x: number; y: number }> = [];

    const flush = () => {
      if (topPath.length < 2 || bottomPath.length < 2) {
        topPath = [];
        bottomPath = [];
        return;
      }
      input.ctx.save();
      input.ctx.fillStyle = fillColor;
      input.ctx.beginPath();
      input.ctx.moveTo(topPath[0]!.x, topPath[0]!.y);
      for (let i = 1; i < topPath.length; i++) {
        input.ctx.lineTo(topPath[i]!.x, topPath[i]!.y);
      }
      for (let i = bottomPath.length - 1; i >= 0; i--) {
        input.ctx.lineTo(bottomPath[i]!.x, bottomPath[i]!.y);
      }
      input.ctx.closePath();
      input.ctx.fill();
      input.ctx.restore();
      topPath = [];
      bottomPath = [];
    };

    input.clipToRect(paneRect, () => {
      for (let index = from; index < to; index++) {
        const upperValue = seriesValueAt(upperSeries, index, upperTransform);
        const lowerValue = seriesValueAt(lowerSeries, index, lowerTransform);
        const x = upperRuntime.xPositions[index] ?? upperRuntime.xFn(index);
        if (
          upperValue === undefined ||
          lowerValue === undefined ||
          !Number.isFinite(x)
        ) {
          flush();
          continue;
        }
        const upperY = CoordSys.toPixel(upperValue, yScale);
        const lowerY = CoordSys.toPixel(lowerValue, yScale);
        if (!Number.isFinite(upperY) || !Number.isFinite(lowerY)) {
          flush();
          continue;
        }
        topPath.push({ x, y: upperY });
        bottomPath.push({ x, y: lowerY });
      }
      flush();
    });
  }
}

function computeXRuntimeSignature(
  state: Chart.State,
  all: Series.State[],
  areaX: number,
  areaWidth: number,
): string {
  const xAxes =
    Array.isArray(state.config.xAxis.axes) && state.config.xAxis.axes.length > 0
      ? (state.config.xAxis.axes as XAxis[])
      : [getAxis(state.config.xAxis, state.config.xAxis.activeId)];
  const axesSignature = xAxes
    .map((axis) => {
      const domain = axis.domain
        ? `${axis.domain.min},${axis.domain.max},${axis.domain.minSpan}`
        : "-";
      return [
        axis.id,
        axis.mode,
        axis.field ?? "",
        axis.spacing.barSpacing,
        axis.spacing.rightOffset,
        axis.spacing.minBarSpacing,
        axis.spacing.maxBarSpacing,
        domain,
      ].join(":");
    })
    .join("|");

  const axisById = new Map(xAxes.map((axis) => [axis.id, axis]));
  const xValueSignature = (series: Series.State, index: number): string => {
    const point = series.data[index] as Record<string, unknown> | undefined;
    if (!point) return "-";
    const axis = axisById.get(Series.getXAxisId(series));
    const field = series.fieldMap?.x ?? axis?.field ?? "time";
    const value = point[field];
    if (typeof value === "number" || typeof value === "string")
      return String(value);
    return JSON.stringify(value);
  };

  const seriesSignature = all
    .map((series) => {
      const first = xValueSignature(series, 0);
      const last = xValueSignature(series, series.data.length - 1);
      return `${series.id}:${Series.getXAxisId(series)}:${series.data.length}:${first}:${last}:${series.options.xOffset ?? 0}`;
    })
    .join("|");

  return `${areaX};${areaWidth};${state.config.xAxis.activeId};${axesSignature};${seriesSignature}`;
}

export function repaint(
  state: Chart.State,
  runtime: RuntimeState,
  mask: Invalidate.Mask,
  profile?: RenderProfileFrame,
): { from: number; to: number } | undefined {
  if (!Invalidate.dirty(mask)) return undefined;
  ChartStateModel.assertModelReady(state);
  const drawingState = {
    ...state.drawings,
    items: ChartStateModel.drawingItems(state),
  };
  const drawingLabelPlacements = new Map<
    string,
    readonly LineLabelPlacement[]
  >();
  runtime.drawingLabelPlacements = drawingLabelPlacements;
  const time = <T>(
    name: string,
    action: () => T,
    metadata?: RenderProfileMetadata,
  ): T => {
    if (!profile) return action();
    return profile.time(name, action, metadata);
  };

  const ctx = runtime.ctx;
  const config = state.config;
  const { width, height } = config.chart.dimensions;
  const { layout, grid, sessionBands } = config.chart;
  const layoutBackground = Color.resolve(layout.background);
  const layoutTextColor = Color.resolve(layout.textColor);
  const gridColor = Color.resolve(grid.color);
  const sessionBandColor = (type: string | undefined) =>
    Color.resolve(
      type === "post"
        ? sessionBands.post
        : type === "overnight"
          ? sessionBands.overnight
          : sessionBands.pre,
    );
  const resolveTextColor = (color?: string) =>
    color ? Color.resolve(color) : layoutTextColor;
  const { crosshair } = config.interaction;
  const axes = config.yAxis.axes as Axis[];
  const axisWidth = config.yAxis.width;
  const axisById = new Map<string, Axis>();
  for (const axis of axes) axisById.set(axis.id, axis);

  time("canvas.clear", () => Draw.clear(ctx, width, height, layoutBackground), {
    width,
    height,
  });

  const all = ChartStateModel.resolvedSeriesValues(state);
  if (all.length === 0) return undefined;
  const focusedSeriesId =
    state.lockedSeriesId ?? state.hoveredSeriesId ?? state.focusedSeriesId;

  const fixedAxes = axes.filter((a) => a.visible && a.fixed !== false);
  const leftAxes = fixedAxes.filter((a) => a.side === "left");
  const rightAxes = fixedAxes.filter((a) => a.side === "right");
  const chartLayout = time("layout.chart", () => Chart.computeLayout(config), {
    seriesCount: all.length,
    axisCount: axes.length,
  });
  const { areaX, areaWidth, areaHeight, timeAxisHeight } = chartLayout;
  const timeAxisY = areaHeight;
  const paneRects = time(
    "layout.panes",
    () => paneBounds(state, areaX, areaWidth, areaHeight),
    { paneCount: state.panes.length },
  );
  const paneIdsBySeries = time("layout.series-panes", () =>
    seriesPaneIds(state),
  );
  const chartBounds = { x: areaX, y: 0, width: areaWidth, height: areaHeight };
  const paneRectForSeries = (seriesId: string) => {
    const paneId =
      paneIdsBySeries.get(seriesId) ?? ChartStateModel.MAIN_PANE_ID;
    return paneRects.get(paneId) ?? chartBounds;
  };
  const seriesContextTarget = state.seriesContextMenu?.seriesId
    ? ChartStateModel.resolvedSeries(state, state.seriesContextMenu.seriesId)
    : undefined;
  const seriesContextPaneId = seriesContextTarget
    ? (paneIdsBySeries.get(seriesContextTarget.id) ??
      ChartStateModel.MAIN_PANE_ID)
    : undefined;
  const isDimmedBySeriesContext = (series: Series.State): boolean => {
    if (!seriesContextTarget || !seriesContextPaneId) return false;
    const paneId =
      paneIdsBySeries.get(series.id) ?? ChartStateModel.MAIN_PANE_ID;
    if (paneId !== seriesContextPaneId) return false;
    if (series.id === seriesContextTarget.id) return false;
    if (series.parentId === seriesContextTarget.id) return false;
    return true;
  };
  const withSeriesContextAlpha = (series: Series.State, draw: () => void) => {
    if (!isDimmedBySeriesContext(series)) {
      draw();
      return;
    }
    ctx.save();
    ctx.globalAlpha *= SERIES_CONTEXT_DIM_ALPHA;
    draw();
    ctx.restore();
  };
  const clipToRect = (
    rect: { x: number; y: number; width: number; height: number },
    draw: () => void,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    draw();
    ctx.restore();
  };
  const level = mask.chart;

  const xRuntimeSignature = computeXRuntimeSignature(
    state,
    all,
    areaX,
    areaWidth,
  );
  // xRuntimeCache can be reused at both cursor and light levels when the
  // signature matches.  The signature encodes areaX, areaWidth, axis config,
  // bar spacing, and every series' data.length — so an appended bar, a zoom,
  // or a resize all invalidate it.  For live ticks that update the last bar
  // without appending, data.length is unchanged and x-positions are identical,
  // making reuse correct and saving the cost of buildSeriesXRuntimes().
  // 'full' always rebuilds because extent/layout may have changed structurally.
  const canReuseXRuntimes =
    level !== "full" && runtime.xRuntimeCache?.signature === xRuntimeSignature;
  const xRuntimes = time(
    "x-runtime",
    () =>
      canReuseXRuntimes
        ? runtime.xRuntimeCache!
        : (() => {
            const built = buildSeriesXRuntimes(state, all, areaX, areaWidth);
            const cache: XRuntimesCache = {
              signature: xRuntimeSignature,
              seriesMap: built.seriesMap,
              seriesRanges: built.seriesRanges,
              axisRanges: built.axisRanges,
            };
            runtime.xRuntimeCache = cache;
            return cache;
          })(),
    { cacheHit: canReuseXRuntimes, seriesCount: all.length },
  );

  const { seriesMap, seriesRanges, axisRanges } = xRuntimes;
  const activeAxis = getAxis(state.config.xAxis, state.config.xAxis.activeId);

  const activeRange = axisRanges[activeAxis.id] ?? { from: 0, to: 0 };

  const modeSignature = computeModeExtentSignature(
    state,
    all,
    seriesRanges,
    axes,
  );
  const modeCacheHit = runtime.modeCache?.signature === modeSignature;
  const modeTransforms = time(
    "mode-transforms",
    () =>
      modeCacheHit
        ? runtime.modeCache!.modeTransforms
        : buildModeTransforms(state, all, seriesRanges, axes),
    { seriesCount: all.length, cacheHit: modeCacheHit },
  );

  const extents = time(
    "extents",
    () =>
      modeCacheHit
        ? cloneExtents(runtime.modeCache!.extents)
        : computeExtents(state, all, seriesRanges, axes, modeTransforms),
    { seriesCount: all.length, axisCount: axes.length, cacheHit: modeCacheHit },
  );

  if (!modeCacheHit) {
    runtime.modeCache = {
      signature: modeSignature,
      modeTransforms,
      extents: cloneExtents(extents),
    };
  }
  const factory = CoordSysRegistry.get("cartesian2d");
  if (!factory) return undefined;

  const paneRectForAxis = (
    axis: Axis,
  ): { x: number; y: number; width: number; height: number } | undefined => {
    if (axis.paneId) {
      const rect = paneRects.get(axis.paneId);
      if (rect) return rect;
    }
    for (const series of all) {
      if (Series.getYAxisId(series) !== axis.id) continue;
      const paneId = paneIdsBySeries.get(series.id);
      if (!paneId) continue;
      const rect = paneRects.get(paneId);
      if (rect) return rect;
    }
    return undefined;
  };

  const axisScaleBounds = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  const axisPaneId = new Map<string, string>();
  for (const axis of axes) {
    const rect = paneRectForAxis(axis) ?? chartBounds;
    axisScaleBounds.set(axis.id, rect);
    const paneId =
      Array.from(paneRects.entries()).find(
        ([, paneRect]) => paneRect === rect,
      )?.[0] ??
      axis.paneId ??
      ChartStateModel.MAIN_PANE_ID;
    axisPaneId.set(axis.id, paneId);
  }

  const leftStackByPane = new Map<string, string[]>();
  const rightStackByPane = new Map<string, string[]>();
  for (const axis of leftAxes) {
    const paneId = axisPaneId.get(axis.id) ?? ChartStateModel.MAIN_PANE_ID;
    const stack = leftStackByPane.get(paneId) ?? [];
    stack.push(axis.id);
    leftStackByPane.set(paneId, stack);
  }
  for (const axis of rightAxes) {
    const paneId = axisPaneId.get(axis.id) ?? ChartStateModel.MAIN_PANE_ID;
    const stack = rightStackByPane.get(paneId) ?? [];
    stack.push(axis.id);
    rightStackByPane.set(paneId, stack);
  }

  const leftSlotByAxisId = new Map<string, number>();
  const rightSlotByAxisId = new Map<string, number>();
  for (const stack of leftStackByPane.values()) {
    stack.forEach((axisId, slot) => leftSlotByAxisId.set(axisId, slot));
  }
  for (const stack of rightStackByPane.values()) {
    stack.forEach((axisId, slot) => rightSlotByAxisId.set(axisId, slot));
  }

  const axisXFor = (axis: Axis): number => {
    if (axis.side === "left") {
      const slot = leftSlotByAxisId.get(axis.id) ?? 0;
      return areaX - axisWidth * (slot + 1);
    }
    const slot = rightSlotByAxisId.get(axis.id) ?? 0;
    return areaX + areaWidth + slot * axisWidth;
  };

  const bounds = chartBounds;
  const scaleConfigs: Record<string, CoordSys.ScaleConfig> = {};
  for (const axis of axes) {
    const scaleBounds = axisScaleBounds.get(axis.id) ?? chartBounds;
    const paneBottom = scaleBounds.y + scaleBounds.height;
    const paneTop = scaleBounds.y;
    const paneFrom =
      areaHeight > 0 ? (areaHeight - paneBottom) / areaHeight : 0;
    const paneTo = areaHeight > 0 ? (areaHeight - paneTop) / areaHeight : 1;
    const paneSpan = Math.max(1e-4, paneTo - paneFrom);
    const bottomMargin = Math.max(0, Math.min(1, axis.margins.bottom));
    const topMargin = Math.max(0, Math.min(1, axis.margins.top));
    let from = paneFrom + bottomMargin * paneSpan;
    let to = paneFrom + (1 - topMargin) * paneSpan;
    from = Math.max(0, Math.min(1, from));
    to = Math.max(0, Math.min(1, to));
    if (to <= from) {
      const mid = Math.max(0, Math.min(1, (from + to) / 2));
      from = Math.max(0, mid - 5e-5);
      to = Math.min(1, mid + 5e-5);
    }
    scaleConfigs[axis.id] = {
      from,
      to,
      mode: axis.mode === "logarithmic" ? "log" : "linear",
    };
  }
  const defaultYScale =
    axes.find((axis) => axis.id === "right")?.id ?? axes[0]?.id ?? "right";
  const coord = time(
    "coord-system",
    () => factory(bounds, extents, defaultYScale, scaleConfigs),
    { axisCount: axes.length },
  );
  runtime.coord = coord;
  const coordByAxis = new Map<string, CoordSys.State>();
  coordByAxis.set(defaultYScale, coord);
  const coordForAxis = (axisId: string) => {
    const cachedCoord = coordByAxis.get(axisId);
    if (cachedCoord) return cachedCoord;
    const created = factory(bounds, extents, axisId, scaleConfigs);
    coordByAxis.set(axisId, created);
    return created;
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(areaX, 0, areaWidth, areaHeight);
  ctx.clip();

  const activeSeries =
    all.find((series) => Series.getXAxisId(series) === activeAxis.id) ?? all[0];
  const activeSeriesRuntime = activeSeries
    ? seriesMap.get(activeSeries.id)
    : undefined;
  const activeTimeDisplayTimezone = Chart.resolveTimeDisplayTimezone(
    state,
    activeSeries?.id,
  );
  const mainSeries = ChartStateModel.mainSeries(state);
  const eventSeries =
    mainSeries && Series.getXAxisId(mainSeries) === activeAxis.id
      ? mainSeries
      : activeSeries;
  const eventSeriesRuntime = eventSeries
    ? seriesMap.get(eventSeries.id)
    : undefined;
  const activeBarWidth =
    activeSeriesRuntime?.barWidth ??
    Math.max(1, Math.floor(activeAxis.spacing.barSpacing * 0.8));

  const sessionMap = (
    state as Chart.State & {
      session?: Record<string, Chart.SessionInfo>;
    }
  ).session;

  const sessionBandSeries = mainSeries ?? activeSeries;
  const sessionBandRuntime = sessionBandSeries
    ? seriesMap.get(sessionBandSeries.id)
    : undefined;
  if (sessionBandSeries && sessionBandRuntime) {
    const start = Math.max(0, Math.floor(sessionBandRuntime.range.from));
    const end = Math.min(
      sessionBandSeries.data.length - 1,
      Math.ceil(sessionBandRuntime.range.to),
    );
    time(
      "session-bands",
      () => {
        const session = sessionMap?.[sessionBandSeries.id];
        const xField = activeAxis.field || "time";
        const activeBandType =
          session?.phase === "pre" || session?.phase === "post"
            ? session.phase
            : undefined;
        const activeBandStart =
          typeof session?.currentSessionOpenAt === "number"
            ? session.currentSessionOpenAt
            : undefined;
        const activeBandEnd =
          typeof session?.nextCloseAt === "number"
            ? session.nextCloseAt
            : undefined;
        let bandStart: number | undefined;
        let bandType: string | undefined;
        let bandKey: string | undefined;
        const drawClippedBand = (
          left: number,
          right: number,
          type: string | undefined,
        ) => {
          const clippedLeft = Math.max(areaX, Math.min(left, right));
          const clippedRight = Math.min(
            areaX + areaWidth,
            Math.max(left, right),
          );
          const x = Math.floor(clippedLeft);
          const width = Math.ceil(clippedRight) - x;
          if (width <= 0) return;
          ctx.save();
          ctx.fillStyle = sessionBandColor(type);
          ctx.fillRect(x, 0, width, areaHeight);
          ctx.restore();
        };
        const drawBand = (
          fromIndex: number,
          toIndex: number,
          type: string | undefined,
        ) => {
          const left =
            sessionBandRuntime.xFn(fromIndex) - sessionBandRuntime.barWidth / 2;
          const right =
            sessionBandRuntime.xFn(toIndex) + sessionBandRuntime.barWidth / 2;
          drawClippedBand(left, right, type);
        };
        const shouldDrawPointBand = (
          index: number,
          type: string | undefined,
        ) => {
          if (
            type !== activeBandType ||
            activeBandStart === undefined ||
            activeBandEnd === undefined
          ) {
            return true;
          }
          const time = pointTimeSeconds(
            sessionBandSeries,
            sessionBandSeries.data[index],
            xField,
          );
          return (
            time === undefined ||
            time < activeBandStart ||
            time >= activeBandEnd
          );
        };
        const closeBand = (toIndex: number) => {
          if (bandStart === undefined) return;
          drawBand(bandStart, toIndex, bandType);
          bandStart = undefined;
          bandType = undefined;
          bandKey = undefined;
        };
        const drawTimeBand = (fromSec: number, toSec: number, type: string) => {
          if (toSec <= fromSec) return;
          const left = projectedXForTime(
            sessionBandSeries,
            sessionBandRuntime,
            fromSec,
            xField,
          );
          const right = projectedXForTime(
            sessionBandSeries,
            sessionBandRuntime,
            toSec,
            xField,
          );
          if (left === undefined || right === undefined) return;
          drawClippedBand(left, right, type);
        };
        const isActiveBandInterval = (
          fromSec: number,
          toSec: number,
          type: string | undefined,
        ) =>
          type === activeBandType &&
          activeBandStart !== undefined &&
          activeBandEnd !== undefined &&
          fromSec < activeBandEnd &&
          toSec > activeBandStart;

        for (let index = start; index <= end; index++) {
          const point = sessionBandSeries.data[index];
          const type = pointSessionType(point);
          const interval = pointSessionInterval(point);
          const key = interval
            ? `${type}:${interval.start}:${interval.end}`
            : type;
          const activeInterval =
            interval &&
            isActiveBandInterval(interval.start, interval.end, type);
          if (
            isExtendedSessionType(type) &&
            !activeInterval &&
            shouldDrawPointBand(index, type)
          ) {
            if (bandStart === undefined) {
              bandStart = index;
              bandType = type;
              bandKey = key;
              continue;
            }
            if (type !== bandType || key !== bandKey) {
              drawBand(bandStart, index - 1, bandType);
              bandStart = index;
              bandType = type;
              bandKey = key;
            }
            continue;
          }
          closeBand(index - 1);
        }
        closeBand(end);

        if (
          (session?.phase === "pre" || session?.phase === "post") &&
          typeof session.currentSessionOpenAt === "number" &&
          typeof session.nextCloseAt === "number"
        ) {
          drawTimeBand(
            session.currentSessionOpenAt,
            session.nextCloseAt,
            session.phase,
          );
        }
      },
      {
        seriesId: sessionBandSeries.id,
        totalPoints: sessionBandSeries.data.length,
        visiblePoints: Math.max(0, end - start + 1),
      },
    );
  }

  if (grid.visible) {
    time("grid", () => {
      const zoomFactor = Math.max(0.5, Math.min(2, activeBarWidth / 5));
      const xLineCount = Math.max(
        2,
        Math.round(areaWidth / (100 / zoomFactor)),
      );
      const xLines: number[] = [];
      for (let i = 1; i < xLineCount; i++) {
        xLines.push(Math.round((i / xLineCount) * areaWidth));
      }

      const yScale = coord.scales.y.right ?? Object.values(coord.scales.y)[0];
      const yLines: number[] = [];
      if (yScale) {
        for (const mark of PriceAxis.fromVisualRange(yScale, areaHeight, 50)) {
          yLines.push(Math.round(mark.y));
        }
      }

      Draw.grid(ctx, areaWidth, areaHeight, xLines, yLines, gridColor);
    });
  }

  const primitiveLabels: CoordSys.Bounds[] = [];
  const primitiveStates = [...runtime.seriesPrimitives.values()];
  const seriesInk =
    primitiveStates.some((state) => state.primitives.size > 0) &&
    (level !== "cursor" ||
      primitiveStates.some(
        (state) =>
          state.primitives.size > 0 && !state.context?.labelIntersectsSeries,
      ))
      ? createSeriesOccupancy({
          x: areaX,
          y: 0,
          width: areaWidth,
          height: areaHeight,
        })
      : undefined;
  for (const primitives of runtime.seriesPrimitives.values()) {
    // Cursor repaints reuse primitive geometry, but text occupancy belongs only
    // to this paint, not the previous frame's accepted labels.
    if (primitives.context?.labelPlacements)
      primitives.context.labelPlacements.length = 0;
    if (seriesInk && primitives.context)
      primitives.context.labelIntersectsSeries = (rect) =>
        seriesInk.intersects(rect, primitives.context!.coord.bounds);
  }
  for (const s of all) {
    const primState = runtime.seriesPrimitives.get(s.id);
    if (!primState || !isVisible(s)) continue;
    const xRuntime = seriesMap.get(s.id);
    if (!xRuntime) continue;
    // Every layer consumes this paint's geometry. Previously background primitives
    // ran before updateAllViews, leaving new clouds blank or one frame behind.
    if (level !== "cursor" || !primState.context) {
      const axisId = Series.getYAxisId(s);
      const rawCoord = coordForRawSeriesValues(
        coordForAxis(axisId),
        axisById.get(axisId),
        modeTransforms.get(s.id),
      );
      PrimitiveWrapper.update(
        primState,
        {
          chartId: state.id,
          seriesId: s.id,
          paneIndex: ChartStateModel.paneIndexForSeriesId(state, s.id),
          coord: { ...rawCoord, bounds: paneRectForSeries(s.id) },
          width,
          height,
          barWidth: xRuntime.barWidth,
          xPositions: xRuntime.xPositions,
          xPositionAt: (index) =>
            xRuntime.xFn(index - Number(s.options.xOffset ?? 0)),
          labelPlacements: primitiveLabels,
          labelIntersectsSeries: seriesInk
            ? (rect) => seriesInk.intersects(rect, paneRectForSeries(s.id))
            : undefined,
        },
        { data: s.data, visibleRange: xRuntime.range },
      );
    }
    clipToRect(paneRectForSeries(s.id), () => {
      PrimitiveWrapper.render(primState, ctx, "background");
    });
  }

  const paneViews = PrimitiveWrapper.paneViews(runtime.panePrimitives);
  for (const v of paneViews) {
    if (v.zOrder() !== "background") continue;
    const r = v.renderer();
    if (r?.drawBackground) r.drawBackground(ctx);
    if (r) r.draw(ctx);
  }

  // Profiles sit under series and are laid out afresh every paint.
  time("vertical-profiles", () => {
    const xField = activeAxis.field || "time";
    const visibleTime = (index: number) =>
      sessionBandSeries && sessionBandRuntime
        ? pointTimeSeconds(
            sessionBandSeries,
            sessionBandSeries.data[
              Math.max(0, Math.min(sessionBandSeries.data.length - 1, index))
            ],
            xField,
          )
        : undefined;
    const visibleFrom =
      visibleTime(Math.floor(sessionBandRuntime?.range.from ?? 0)) ?? -Infinity;
    const visibleTo =
      visibleTime(Math.ceil(sessionBandRuntime?.range.to ?? 0)) ?? Infinity;
    for (const pane of state.panes) {
      const rect = paneRects.get(pane.id) ?? chartBounds;
      for (const objectId of pane.objectIds) {
        const object = state.objects[objectId];
        if (!ChartStateModel.isVerticalProfileObject(object)) continue;
        const { profile, axisId } = object;
        if (!profile.visible) continue;
        // Rows hold raw values; percentage and indexed axes have no baseline for them.
        const mode = axisById.get(axisId)?.mode;
        if (mode === "percentage" || mode === "indexed") continue;
        const scale = coordForAxis(axisId).scales.y[axisId];
        if (!scale) continue;
        const box = profile.box;
        let bounds:
          { left: number; right: number; anchor: "left" | "right" } | undefined;
        if (box.kind === "edge") {
          const width = rect.width * box.width;
          bounds =
            box.side === "right"
              ? {
                  left: rect.x + rect.width - width,
                  right: rect.x + rect.width,
                  anchor: "right",
                }
              : { left: rect.x, right: rect.x + width, anchor: "left" };
        } else if (sessionBandSeries && sessionBandRuntime) {
          // Only boxes overlapping the visible bars are laid out.
          if (box.to < visibleFrom || box.from > visibleTo) continue;
          const left = projectedXForTime(
            sessionBandSeries,
            sessionBandRuntime,
            box.from,
            xField,
          );
          const right = projectedXForTime(
            sessionBandSeries,
            sessionBandRuntime,
            box.to,
            xField,
          );
          if (left !== undefined && right !== undefined && right > left) {
            bounds = { left, right, anchor: "left" };
          }
        }
        if (!bounds) continue;
        const geometry = layoutVerticalProfile(profile, {
          ...bounds,
          yToPixel: (y) => CoordSys.toPixel(y, scale),
        });
        clipToRect(rect, () => paintVerticalProfile(ctx, geometry));
      }
    }
  });

  time("line-band-fills", () =>
    renderLineBandFills({
      ctx,
      all,
      seriesMap,
      coordForAxis,
      modeTransforms,
      paneRectForSeries,
      clipToRect,
      isVisible,
    }),
  );

  const skipTransform = level === "cursor";
  // At light level, track which series' data actually changed by comparing
  // the data array reference to the previous frame.  SolidJS creates a new
  // array reference when store data changes, so reference equality is a safe
  // and cheap staleness check.  Series whose data didn't change can reuse
  // their cached render items, avoiding the expensive transform step.
  //
  // On 'full' renders (ticker switch, resize), discard all previous refs to
  // prevent stale geometry from the old ticker leaking through.  This is the
  // same class of bug documented in CLAUDE.md: "If any series data was cleared
  // between paints, cached geometry from the previous paint is stale."
  const prevDataRefs = level === "full" ? undefined : runtime.seriesDataRefs;
  const prevRenderSignatures =
    level === "full" ? undefined : runtime.seriesRenderSignatures;
  const nextDataRefs = new Map<string, unknown[]>();
  const nextRenderSignatures = new Map<string, string>();

  for (const s of all) {
    if (!isVisible(s)) continue;
    const def = SeriesRegistry.get(s.type);
    if (!def) continue;
    const yAxisId = Series.getYAxisId(s);
    const xRuntime = seriesMap.get(s.id);
    if (!xRuntime) continue;

    nextDataRefs.set(s.id, s.data);

    const axis = axisById.get(yAxisId);
    const transform = modeTransforms.get(s.id);
    const seriesCoord = coordForAxis(yAxisId);
    const yScale = seriesCoord.scales.y[yAxisId];
    const renderSignature = seriesRenderSignature(
      s,
      yAxisId,
      yScale,
      transform,
    );
    nextRenderSignatures.set(s.id, renderSignature);

    // cursor: always use cache (geometry reuse)
    // light:  use cache if this specific series' data ref is unchanged AND
    //         the data is non-empty (empty arrays during ticker switches must
    //         not match — stale geometry from the old ticker would paint)
    // full:   never use cache (structural change, extents may differ)
    const dataUnchanged =
      level === "light" &&
      canReuseXRuntimes &&
      s.data.length > 0 &&
      prevDataRefs?.get(s.id) === s.data &&
      prevRenderSignatures?.get(s.id) === renderSignature;
    const canUseCache = skipTransform || dataUnchanged;
    const cached = canUseCache
      ? RenderCache.get(runtime.renderCache, s.id, runtime.renderCache.version)
      : null;
    const hasCachedItems = !!cached;
    let items: unknown[];
    const seriesMetadata = {
      seriesId: s.id,
      type: s.type,
      totalPoints: s.data.length,
      visibleFrom: xRuntime.range.from,
      visibleTo: xRuntime.range.to,
      visiblePoints: Math.max(0, xRuntime.range.to - xRuntime.range.from),
      cacheHit: hasCachedItems,
    };

    if (hasCachedItems) {
      items = cached.items;
    } else {
      const buffer =
        s.type === "Line" || s.type === "Area" || s.type === "Baseline" ? 1 : 0;
      const view = DataView.create(
        s.type,
        s.data,
        { ...xRuntime.range, buffer },
        xRuntime.xFn,
      );
      const shouldTransformMode =
        !!axis &&
        (axis.mode === "percentage" || axis.mode === "indexed") &&
        !!transform;
      // Prefer folding the (affine) mode transform into the (linear) y-scale so
      // def.transform reads the raw data directly — no per-point allocation.
      // `__ocDisableComparisonScaleFold` forces the exact per-point path so the
      // two can be A/B compared (must be pixel-identical).
      const foldedCoord =
        shouldTransformMode &&
        !(globalThis as { __ocDisableComparisonScaleFold?: boolean })
          .__ocDisableComparisonScaleFold
          ? foldModeTransformIntoScale(seriesCoord, transform)
          : null;
      const transformedView =
        shouldTransformMode && !foldedCoord
          ? {
              ...view,
              item: (index: number) => {
                const point = view.item(index) as
                  Record<string, unknown> | undefined;
                if (!point) return point;
                return transform.point(point);
              },
              forEach: (
                fn: (item: unknown, index: number, x: number) => void,
              ) => {
                view.forEach((item, index, x) => {
                  const point = item as Record<string, unknown> | undefined;
                  if (!point) return;
                  fn(transform.point(point), index, x);
                });
              },
              map: <R>(fn: (item: unknown, index: number, x: number) => R) => {
                const out: R[] = [];
                view.forEach((item, index, x) => {
                  const point = item as Record<string, unknown> | undefined;
                  if (!point) return;
                  out.push(fn(transform.point(point), index, x));
                });
                return out;
              },
            }
          : view;
      items = time(
        "series.transform",
        () =>
          def.transform(
            transformedView,
            foldedCoord ?? seriesCoord,
            xRuntime.barWidth,
            s.options as Record<string, unknown>,
            s.fieldMap,
          ),
        seriesMetadata,
      );
    }

    if (!cached && items.length > 0) {
      RenderCache.set(runtime.renderCache, s.id, items, xRuntime.range);
    }

    const visRange = { from: 0, to: items.length };
    const renderOptions = (() => {
      const base = s.options as Record<string, unknown>;
      if (focusedSeriesId !== s.id || xRuntime.range.to <= xRuntime.range.from)
        return base;
      return focusedRenderOptions(s, base);
    })();
    const paneRect = paneRectForSeries(s.id);
    // The primitives' top layer runs only after every series contributes, so
    // each label sees other outputs and the price candles, not just its anchor.
    seriesInk?.add(s.type, items, renderOptions, paneRect);
    withSeriesContextAlpha(s, () => {
      clipToRect(paneRect, () => {
        time(
          "series.draw",
          () => def.render(ctx, items, visRange, renderOptions),
          { ...seriesMetadata, itemCount: items.length },
        );
      });
    });

    const primState = runtime.seriesPrimitives.get(s.id);
    if (primState) {
      if (skipTransform && hasCachedItems) {
        withSeriesContextAlpha(s, () => {
          clipToRect(paneRect, () => {
            PrimitiveWrapper.render(primState, ctx, "normal");
          });
        });
        continue;
      }
      withSeriesContextAlpha(s, () => {
        clipToRect(paneRect, () => {
          PrimitiveWrapper.render(primState, ctx, "normal");
        });
      });
    }
  }

  for (const v of paneViews) {
    if (v.zOrder() !== "normal") continue;
    const r = v.renderer();
    if (r) r.draw(ctx);
  }

  for (const s of all) {
    const primState = runtime.seriesPrimitives.get(s.id);
    if (!primState || !isVisible(s)) continue;
    withSeriesContextAlpha(s, () => {
      clipToRect(paneRectForSeries(s.id), () => {
        PrimitiveWrapper.render(primState, ctx, "top");
      });
    });
  }

  for (const v of paneViews) {
    if (v.zOrder() !== "top") continue;
    const r = v.renderer();
    if (r) r.draw(ctx);
  }

  const drawingOverlays: DrawingOverlayLabel[] = [];
  let chartEventRenderContext: RenderContext | undefined;
  let markerEventRenderContext: RenderContext | undefined;
  let strategyEventRenderContext: RenderContext | undefined;
  let paintDeferredChartAnnotations: (() => void) | undefined;
  if (activeSeries && activeSeriesRuntime) {
    const activeSeriesAxisId = Series.getYAxisId(activeSeries);
    const fallbackDrawingAxisId = axisById.has(activeSeriesAxisId)
      ? activeSeriesAxisId
      : defaultYScale;
    const drawingAxisId = (item: Drawing.Item): string => {
      const explicitAxisId = item.anchors.find(
        (anchor) => anchor.axisId,
      )?.axisId;
      if (explicitAxisId && axisById.has(explicitAxisId)) {
        return explicitAxisId;
      }
      return fallbackDrawingAxisId;
    };
    const drawingStateForAxis = (
      axisId: string,
    ): Drawing.RenderInput | undefined => {
      if (!drawingState) return undefined;
      const items = (drawingState.items ?? []).filter(
        (item) => drawingAxisId(item) === axisId,
      );
      const draft =
        drawingState.draft && drawingAxisId(drawingState.draft) === axisId
          ? drawingState.draft
          : undefined;
      if (items.length === 0 && !draft) return undefined;
      const next: Drawing.RenderInput = { ...drawingState, items };
      if (draft) next.draft = draft;
      else delete next.draft;
      return next;
    };
    const commonDrawingContext = {
      backgroundColor: layoutBackground,
      xPositions: activeSeriesRuntime.xPositions,
      xFn: activeSeriesRuntime.xFn,
      data: activeSeries.data,
      visibleRange: activeSeriesRuntime.range,
    };

    time(
      "drawings",
      () => {
        for (const axis of axes) {
          const axisDrawingState = drawingStateForAxis(axis.id);
          if (!axisDrawingState) continue;
          const area = axisScaleBounds.get(axis.id) ?? chartBounds;
          clipToRect(area, () => {
            drawingOverlays.push(
              ...renderDrawings(
                ctx,
                axisDrawingState,
                {
                  ...commonDrawingContext,
                  coord: coordForAxis(axis.id),
                  area,
                },
                drawingLabelPlacements,
              ),
            );
          });
        }
      },
      { axisCount: axes.length, itemCount: drawingState?.items?.length ?? 0 },
    );
  }

  if (eventSeries && eventSeriesRuntime) {
    const eventSeriesAxisId = Series.getYAxisId(eventSeries);
    chartEventRenderContext = {
      backgroundColor: layoutBackground,
      // Annotations follow the main listing, regardless of display-series order.
      // Raw OHLC and persisted prices also need its percentage/indexed transform.
      coord: coordForRawSeriesValues(
        coordForAxis(eventSeriesAxisId),
        axisById.get(eventSeriesAxisId),
        modeTransforms.get(eventSeries.id),
      ),
      xPositions: eventSeriesRuntime.xPositions,
      xFn: eventSeriesRuntime.xFn,
      data: eventSeries.data,
      visibleRange: eventSeriesRuntime.range,
      area: { x: areaX, y: 0, width: areaWidth, height: areaHeight },
    };
    markerEventRenderContext = {
      ...chartEventRenderContext,
      area: paneRectForSeries(eventSeries.id),
    };
    strategyEventRenderContext = markerEventRenderContext;
  }

  ctx.restore();

  if (chartEventRenderContext) {
    const progressBands = [
      ...agentSessionBands(drawingState.items, state.drawings.sessionProgress),
      ...(state.chartExplain?.progressBands ?? []),
    ];
    time(
      "events.span-bands",
      () =>
        renderSpanBands({
          ctx,
          render: chartEventRenderContext,
          draftBand: state.chartExplain?.draftBand,
          progressBands,
        }),
      { spanBandCount: progressBands.length },
    );
    if (markerEventRenderContext) {
      time(
        "events.markers",
        () =>
          renderMarkers({
            ctx,
            render: markerEventRenderContext,
            stripArea: SpanRenderUtils.eventLaneArea(markerEventRenderContext),
            markers: state.markers ?? [],
            hoveredMarkerId: state.hoveredMarkerId,
            activeMarkerId: state.activeMarkerId,
          }),
        { markerCount: state.markers?.length ?? 0 },
      );
    }
    if (strategyEventRenderContext) {
      time(
        "events.strategy",
        () =>
          renderStrategyExecutions({
            ctx,
            render: strategyEventRenderContext!,
            strategy: state.strategy,
          }),
        { tradeCount: state.strategy?.trades.length ?? 0 },
      );
    }
    const annotations = chartAnnotationsForRender(state);
    if (
      annotations.length === 0 &&
      state.annotationDebug?.view !== "occupancy"
    ) {
      const emptyPlacements: AnnotationPlacement[] = [];
      runtime.annotationLayoutCache = {
        solveKey: "empty",
        positionKey: "empty",
        placements: emptyPlacements,
        occupancySnapshot: undefined,
      };
      runtime.annotationOccupancySnapshot = undefined;
      runtime.annotationPlacements = emptyPlacements;
      runtime.annotationHitPlacements = emptyPlacements;
      runtime.annotationHitPlacementsSignature =
        annotationHitInteractionSignature(state);
      runtime.annotationHitPlacementsCache = {
        placements: emptyPlacements,
        ordered: emptyPlacements,
      };
    } else {
      const annotationSolveKey = time(
        "annotation:solve-signature",
        () =>
          annotationRenderSolveSignature(
            runtime,
            state,
            chartEventRenderContext,
            annotations,
          ),
        { annotations: annotations.length },
      );
      const annotationPositionKey = time(
        "annotation:position-signature",
        () => annotationRenderPositionSignature(chartEventRenderContext),
        { annotations: annotations.length },
      );
      let annotationPlacements = runtime.annotationLayoutCache?.placements;
      const layoutState =
        runtime.annotationLayoutState ??
        (runtime.annotationLayoutState = createChartAnnotationLayoutState());
      const needsAnnotationOccupancy =
        state.annotationDebug?.view === "occupancy" &&
        !runtime.annotationLayoutCache?.occupancySnapshot;
      if (
        !runtime.annotationLayoutCache ||
        runtime.annotationLayoutCache.solveKey !== annotationSolveKey ||
        needsAnnotationOccupancy
      ) {
        let occupancySnapshot: ChartAnnotationOccupancySnapshot | undefined;
        annotationPlacements = time(
          "annotation:layout",
          () =>
            layoutChartAnnotations({
              ctx,
              textCache: runtime.textCache,
              render: chartEventRenderContext,
              annotations,
              sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
              expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
              agentAnnotationIds: state.agentAnnotationIds,
              layoutState,
              layoutStateWritable: true,
              onOccupancySnapshot: (snapshot) => {
                occupancySnapshot = snapshot;
              },
            }),
          { annotations: annotations.length, reason: "solve" },
        );
        runtime.annotationLayoutCache = {
          solveKey: annotationSolveKey,
          positionKey: annotationPositionKey,
          placements: annotationPlacements,
          occupancySnapshot,
        };
        runtime.annotationOccupancySnapshot = occupancySnapshot;
      } else if (
        runtime.annotationLayoutCache.positionKey !== annotationPositionKey
      ) {
        const translated =
          state.annotationDebug?.view === "occupancy"
            ? null
            : translateChartAnnotationPlacements({
                ctx,
                textCache: runtime.textCache,
                render: chartEventRenderContext,
                annotations,
                sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
                expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
                agentAnnotationIds: state.agentAnnotationIds,
                layoutState,
                layoutStateWritable: false,
                previousPlacements: runtime.annotationLayoutCache.placements,
              });
        if (translated) {
          annotationPlacements = translated;
          runtime.annotationLayoutCache = {
            ...runtime.annotationLayoutCache,
            positionKey: annotationPositionKey,
            placements: annotationPlacements,
            occupancySnapshot: undefined,
          };
          runtime.annotationOccupancySnapshot = undefined;
        } else {
          let occupancySnapshot: ChartAnnotationOccupancySnapshot | undefined;
          annotationPlacements = time(
            "annotation:layout",
            () =>
              layoutChartAnnotations({
                ctx,
                textCache: runtime.textCache,
                render: chartEventRenderContext,
                annotations,
                sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
                expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
                agentAnnotationIds: state.agentAnnotationIds,
                layoutState,
                layoutStateWritable: true,
                onOccupancySnapshot: (snapshot) => {
                  occupancySnapshot = snapshot;
                },
              }),
            { annotations: annotations.length, reason: "position-fallback" },
          );
          runtime.annotationLayoutCache = {
            solveKey: annotationSolveKey,
            positionKey: annotationPositionKey,
            placements: annotationPlacements,
            occupancySnapshot,
          };
          runtime.annotationOccupancySnapshot = occupancySnapshot;
        }
      }
      const compactAnnotationPlacements = runtime.annotationDragPreview
        ? previewChartAnnotationDragPlacements(
            {
              ctx,
              textCache: runtime.textCache,
              render: chartEventRenderContext,
              annotations,
              sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
              expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
              agentAnnotationIds: state.agentAnnotationIds,
              layoutState,
              layoutStateWritable: false,
            },
            annotationPlacements ?? [],
            runtime.annotationDragPreview,
          )
        : (annotationPlacements ?? []);
      const paintedAnnotationPlacements = time(
        "annotation:expand",
        () =>
          expandChartAnnotationPlacements(
            {
              ctx,
              textCache: runtime.textCache,
              render: chartEventRenderContext,
              annotations,
              sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
              expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
              agentAnnotationIds: state.agentAnnotationIds,
              hoveredAnnotationId: state.hoveredAnnotationId,
              expandedAnnotation: state.expandedAnnotation,
              activeAnnotationId: state.activeAnnotationId,
              layoutState,
              layoutStateWritable: false,
            },
            compactAnnotationPlacements,
          ),
        { annotations: compactAnnotationPlacements.length },
      );
      runtime.annotationPlacements = compactAnnotationPlacements;
      runtime.annotationHitPlacements = annotationHitPlacementsForPaint(
        runtime,
        paintedAnnotationPlacements,
      );
      runtime.annotationHitPlacementsSignature =
        annotationHitInteractionSignature(state);
      const canvasAnnotationPlacements = animateAnnotationPillPlacements(
        runtime,
        paintedAnnotationPlacements,
      );
      const annotationRenderContext = chartEventRenderContext;
      paintDeferredChartAnnotations = () => {
        time(
          "annotation:paint",
          () =>
            paintChartAnnotationPlacements(
              {
                ctx,
                textCache: runtime.textCache,
                render: annotationRenderContext,
                stripArea: SpanRenderUtils.eventLaneArea(
                  annotationRenderContext,
                ),
                annotations,
                sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
                expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
                agentAnnotationIds: state.agentAnnotationIds,
                hoveredAnnotationId: state.hoveredAnnotationId,
                hoveredAnnotationPart: state.hoveredAnnotationPart,
                expandedAnnotation: state.expandedAnnotation,
                activeAnnotationId: state.activeAnnotationId,
                hiddenBodyAnnotationIds:
                  hiddenAnnotationBodyIdsForRender(state),
                hiddenTextAnnotationIds:
                  hiddenAnnotationTextIdsForRender(state),
                layoutState,
                layoutStateWritable: false,
              },
              canvasAnnotationPlacements,
            ),
          { annotations: paintedAnnotationPlacements.length },
        );
        if (state.annotationDebug?.view === "occupancy") {
          paintChartAnnotationOccupancyMap(
            ctx,
            runtime.annotationOccupancySnapshot,
          );
        }
      };
    }
  }

  if (paneRects.size > 1) {
    const separators = Array.from(paneRects.values())
      .sort((a, b) => a.y - b.y)
      .slice(0, -1)
      .map((paneRect) => paneRect.y + paneRect.height);

    if (separators.length > 0) {
      ctx.save();
      ctx.strokeStyle = withAlpha(layoutTextColor, 0.24);
      ctx.lineWidth = 1;
      for (const y of separators) {
        const yy = Math.round(y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(width, yy);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  const font = `${layout.fontSize}px ${layout.fontFamily}`;

  const axisMarksForBounds = (
    axis: Axis,
    yScale: CoordSys.Scale,
    axisBounds: { x: number; y: number; width: number; height: number },
  ) => {
    const segmentHeight = Math.max(2, axisBounds.height);
    const topValue = CoordSys.toValue(axisBounds.y, yScale);
    const bottomValue = CoordSys.toValue(
      axisBounds.y + axisBounds.height,
      yScale,
    );
    const tickSpacing = Math.max(24, axis.style.tickSpacing);
    const tickCount = Math.max(3, Math.floor(segmentHeight / tickSpacing));
    const marks = PriceAxis.generateTicks(
      [Math.min(topValue, bottomValue), Math.max(topValue, bottomValue)],
      segmentHeight,
      tickCount,
      2,
      (value) => formatAxisValue(axis, value),
    );
    // generateTicks places labels using linear interpolation, which is wrong
    // for log scales. Re-derive y from the actual coordinate scale so labels
    // align with the data (bars, lines, etc.).
    return marks.map((mark) => ({
      ...mark,
      y: CoordSys.toPixel(mark.value, yScale),
    }));
  };

  time(
    "axis.price",
    () => {
      leftAxes.forEach((axis) => {
        const yScale = coord.scales.y[axis.id];
        // Fixed pane axes must not borrow another scale; that visually fuses panes.
        if (!yScale) return;
        const paneBound = axisScaleBounds.get(axis.id) ?? chartBounds;
        const axisBounds = {
          x: axisXFor(axis),
          y: paneBound.y,
          width: axisWidth,
          height: paneBound.height,
        };
        const marks = axisMarksForBounds(axis, yScale, axisBounds);
        PriceAxis.render(
          ctx,
          marks,
          {
            visible: true,
            width: axisWidth,
            side: "left",
            textColor: resolveTextColor(axis.style.textColor),
            font,
            tickCount: 5,
            precision: 2,
            borderVisible: axis.style.borderVisible,
            borderColor: axis.style.borderColor,
            ticksVisible: axis.style.ticksVisible,
          },
          axisBounds,
        );
      });

      rightAxes.forEach((axis) => {
        const yScale = coord.scales.y[axis.id];
        // Fixed pane axes must not borrow another scale; that visually fuses panes.
        if (!yScale) return;
        const paneBound = axisScaleBounds.get(axis.id) ?? chartBounds;
        const axisBounds = {
          x: axisXFor(axis),
          y: paneBound.y,
          width: axisWidth,
          height: paneBound.height,
        };
        const marks = axisMarksForBounds(axis, yScale, axisBounds);
        PriceAxis.render(
          ctx,
          marks,
          {
            visible: true,
            width: axisWidth,
            side: "right",
            textColor: resolveTextColor(axis.style.textColor),
            font,
            tickCount: 5,
            precision: 2,
            borderVisible: axis.style.borderVisible,
            borderColor: axis.style.borderColor,
            ticksVisible: axis.style.ticksVisible,
          },
          axisBounds,
        );
      });
    },
    { axisCount: leftAxes.length + rightAxes.length },
  );

  if (drawingOverlays.length > 0) {
    for (const overlay of drawingOverlays) {
      const overlayAxis =
        axisById.get(overlay.axisId) ?? rightAxes[0] ?? leftAxes[0];
      if (!overlayAxis) continue;
      const overlaySide = effectiveAxisSide(overlayAxis);
      const overlayAxisX = axisXFor(overlayAxis);
      const overlayBounds = { x: overlayAxisX, width: axisWidth };
      const label = formatAxisValue(overlayAxis, overlay.price);
      const textColor = Color.contrast(overlay.color);
      Draw.crosshairYTag(
        ctx,
        overlay.y,
        label,
        overlayBounds,
        overlaySide,
        overlay.color,
        textColor,
        font,
      );
    }
  }

  runtime.floatingAxisOverlays = [];
  let floatingValueTagSeriesId: string | undefined;
  const focusedSeries = focusedSeriesId
    ? ChartStateModel.resolvedSeries(state, focusedSeriesId)
    : undefined;
  if (focusedSeries) {
    const focusedAxisId = Series.getYAxisId(focusedSeries);
    const focusedAxis = axes.find((axis) => axis.id === focusedAxisId);
    const yScale = focusedAxis ? coord.scales.y[focusedAxis.id] : undefined;
    const xRuntime = seriesMap.get(focusedSeries.id);
    if (
      focusedAxis &&
      yScale &&
      xRuntime &&
      (focusedAxis.fixed === false || !focusedAxis.visible)
    ) {
      const paneRect = (() => {
        const paneId = paneIdsBySeries.get(focusedSeries.id);
        return paneId ? paneRects.get(paneId) : undefined;
      })();
      const transform = modeTransforms.get(focusedSeries.id);
      const anchor = lastVisibleSeriesPoint(
        focusedSeries,
        xRuntime,
        focusedAxis,
        yScale,
        transform,
        chartBounds,
      );
      const bounds = (() => {
        if (!paneRect) return chartBounds;
        if (!anchor) return paneRect;
        const paneTop = paneRect.y - 2;
        const paneBottom = paneRect.y + paneRect.height + 2;
        if (anchor.y >= paneTop && anchor.y <= paneBottom) return paneRect;
        return chartBounds;
      })();
      const rawCenterY = anchor ? anchor.y : bounds.y + bounds.height / 2;
      const edgePadding = 6;
      const minY = bounds.y + edgePadding;
      const maxY = bounds.y + bounds.height - edgePadding;
      const centerY = Math.max(minY, Math.min(rawCenterY, maxY));

      const desiredHalf = Math.max(42, bounds.height * 0.15);
      const availableHalf = Math.max(
        0,
        Math.min(centerY - minY, maxY - centerY),
      );
      const half = Math.max(1, Math.min(desiredHalf, availableHalf));
      const top = centerY - half;
      const bottom = centerY + half;

      const maxAxisX = Math.max(
        bounds.x + FLOATING_AXIS_MIN_LEFT_PADDING_PX,
        bounds.x + bounds.width - FLOATING_AXIS_RIGHT_INSET_PX,
      );
      const lastX = anchor?.x ?? maxAxisX;
      const axisX = Math.max(
        bounds.x + FLOATING_AXIS_MIN_LEFT_PADDING_PX,
        Math.min(maxAxisX, lastX + FLOATING_AXIS_ANCHOR_GAP_PX),
      );
      const wouldOverlapFixed = axisX >= maxAxisX && rightAxes.length > 0;
      const equivalentHeight = Math.max(2, bottom - top);
      const topValue = CoordSys.toValue(top, yScale);
      const bottomValue = CoordSys.toValue(bottom, yScale);
      const tickSpacing = Math.max(30, focusedAxis.style.tickSpacing);
      const tickCount = Math.max(3, Math.floor(equivalentHeight / tickSpacing));
      const marks = PriceAxis.generateTicks(
        [Math.min(topValue, bottomValue), Math.max(topValue, bottomValue)],
        equivalentHeight,
        tickCount,
        2,
        (value) => formatAxisValue(focusedAxis, value),
      ).map((mark) => ({
        ...mark,
        y: CoordSys.toPixel(mark.value, yScale),
      }));
      if (!wouldOverlapFixed) {
        drawFloatingAxis(
          ctx,
          focusedAxis,
          marks,
          font,
          resolveTextColor(focusedAxis.style.textColor),
          focusedAxis.style.borderColor,
          { x: axisX, top, bottom },
        );
      }

      const floatingSide = effectiveAxisSide(focusedAxis);
      const overlayWidth = FLOATING_AXIS_OVERLAY_WIDTH_PX;
      const overlayX =
        floatingSide === "right" ? axisX - 2 : axisX - overlayWidth + 2;
      if (!wouldOverlapFixed) {
        runtime.floatingAxisOverlays.push({
          axisId: focusedAxis.id,
          seriesId: focusedSeries.id,
          x: overlayX,
          y: top,
          width: overlayWidth,
          height: Math.max(30, bottom - top),
        });
      }

      const fallbackValue = (() => {
        const needsBaseline =
          focusedAxis.mode === "percentage" || focusedAxis.mode === "indexed";
        if (needsBaseline && !transform) return undefined;
        for (let i = focusedSeries.data.length - 1; i >= 0; i--) {
          const point = focusedSeries.data[i] as
            Record<string, unknown> | undefined;
          if (!point) continue;
          const rawValue =
            readNumber(point, focusedSeries, "close", "close") ??
            readNumber(point, focusedSeries, "value", "value") ??
            readNumber(point, focusedSeries, "high", "high") ??
            readNumber(point, focusedSeries, "low", "low");
          if (rawValue === undefined) continue;
          const value = transform ? transform.value(rawValue) : rawValue;
          if (Number.isFinite(value)) return value;
        }
        return undefined;
      })();
      const tagValue = anchor?.value ?? fallbackValue;
      if (
        !wouldOverlapFixed &&
        tagValue !== undefined &&
        Number.isFinite(tagValue)
      ) {
        const focusedSeriesColor = getSeriesColor(focusedSeries);
        const focusedOptions = focusedSeries.options as Record<string, unknown>;
        const baseTagColor =
          (focusedOptions.lastValueTagColor as string | undefined) ??
          focusedAxis.labels?.tagColor ??
          Color.salient(focusedSeriesColor);
        const tagColor = baseTagColor;
        const baseTextColor =
          (focusedOptions.lastValueTextColor as string | undefined) ??
          focusedAxis.labels?.textColor ??
          Color.contrast(baseTagColor);
        const tagTextColor = baseTextColor;
        const borderColor = focusedValueTagBorderColor(tagTextColor);
        const tagFont = focusedValueTagFont(font);
        const tagLabel =
          focusedSeries.type === "Histogram"
            ? Locale.compact(tagValue)
            : formatAxisValue(focusedAxis, tagValue);
        const tagY = anchor?.y ?? centerY;
        const tagAxisX = floatingSide === "left" ? axisX - axisWidth : axisX;
        ctx.save();
        ctx.font = tagFont;
        const tagWidth = Draw.measureValueTagWidth(ctx, tagLabel, axisWidth);
        ctx.restore();
        const tagStartX =
          floatingSide === "right" ? tagAxisX + axisWidth - tagWidth : tagAxisX;
        const tagEndX =
          floatingSide === "right" ? tagAxisX + axisWidth : tagAxisX + tagWidth;
        Draw.valueTag(
          ctx,
          tagY,
          tagLabel,
          tagAxisX,
          axisWidth,
          floatingSide,
          tagColor,
          tagTextColor,
          tagFont,
          undefined,
          undefined,
          borderColor,
        );

        const floatingTicker = (
          focusedSeries.options as Record<string, unknown>
        ).title as string | undefined;
        if (floatingTicker) {
          ctx.save();
          ctx.font = tagFont;
          const floatingBadgeW =
            ctx.measureText(floatingTicker).width +
            Draw.TICKER_BADGE_PADDING * 2;
          ctx.restore();
          const floatingBadgeX =
            floatingSide === "right"
              ? tagStartX - floatingBadgeW - Draw.TICKER_BADGE_GAP
              : tagEndX + Draw.TICKER_BADGE_GAP;
          Draw.tickerBadge(
            ctx,
            tagY,
            floatingTicker,
            floatingBadgeX,
            floatingBadgeW,
            tagColor,
            tagTextColor,
            tagFont,
            borderColor,
          );
        }

        floatingValueTagSeriesId = focusedSeries.id;
      }
    }
  }

  if (config.xAxis.visible && activeSeries && activeSeriesRuntime) {
    time(
      "axis.time",
      () => {
        const xField = resolveField(
          activeSeries,
          "x",
          activeAxis.field || "time",
        );
        const data = activeSeries.data;
        const times: unknown[] = new Array(data.length);
        for (
          let i = activeSeriesRuntime.range.from;
          i < activeSeriesRuntime.range.to && i < data.length;
          i++
        ) {
          times[i] = (data[i] as Record<string, unknown> | undefined)?.[xField];
        }
        const timeMarks = TimeAxis.generateMarks(
          times,
          activeSeriesRuntime.xPositions,
          activeSeriesRuntime.range,
          areaWidth,
          activeTimeDisplayTimezone,
        );
        TimeAxis.render(
          ctx,
          timeMarks,
          {
            visible: true,
            height: timeAxisHeight,
            textColor: resolveTextColor(config.xAxis.style.textColor),
            font,
            borderVisible: config.xAxis.style.borderVisible,
            borderColor: config.xAxis.style.borderColor,
            ticksVisible: config.xAxis.style.ticksVisible,
            timeVisible: config.xAxis.timeDisplay.timeVisible,
            secondsVisible: config.xAxis.timeDisplay.secondsVisible,
          },
          { x: areaX, y: timeAxisY, width: areaWidth, height: timeAxisHeight },
        );
      },
      {
        totalPoints: activeSeries.data.length,
        visiblePoints: Math.max(
          0,
          activeSeriesRuntime.range.to - activeSeriesRuntime.range.from,
        ),
      },
    );
  }

  const firstRightAxis = rightAxes[0];

  const valueLine = config.series.defaults.valueLine;

  // --- Pass 1: collect value-tag entries and draw value lines (no tags yet) ---
  type PendingTag = {
    naturalY: number;
    adjustedY: number;
    axisId: string;
    paneTop: number;
    paneBottom: number;
    label: string;
    axisX: number;
    axisWidth: number;
    valueTagWidth: number;
    side: "left" | "right";
    tagColor: string;
    textColor: string;
    ticker: string | undefined;
    badgeX: number | undefined;
    badgeW: number;
    // live indicator fields
    liveIndicator: boolean;
    lastX: number | undefined;
    seriesColor: string;
    livePulseTime: number | undefined;
    dimmed: boolean;
    focused: boolean;
    font: string;
    borderColor: string | undefined;
    /** Countdown text (e.g. "32:43") drawn as a smaller second line. */
    subLabel?: string;
    stableOrder: number;
    sessionPairId?: string;
    sessionPairOrder?: number;
  };
  const pendingTags: PendingTag[] = [];

  const formatDuration = (total: number): string | undefined => {
    if (!Number.isFinite(total) || total < 0) return undefined;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    if (hours <= 0) return `${mm}:${ss}`;
    return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  };

  const formatCountdown = (targetSec: number): string | undefined => {
    const remainingMs = targetSec * 1000 - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return undefined;
    return formatDuration(Math.floor(remainingMs / 1000));
  };

  const isExtendedSession = (
    session: Chart.SessionInfo | undefined,
  ): session is Chart.SessionInfo & { phase: "pre" | "post" } =>
    session?.phase === "pre" || session?.phase === "post";

  for (const s of all) {
    if (!isVisible(s)) continue;
    const xRuntime = seriesMap.get(s.id);
    if (!xRuntime) continue;
    const seriesAxisId = Series.getYAxisId(s);
    const seriesAxis = axes.find((a) => a.id === seriesAxisId);
    const transform = modeTransforms.get(s.id);
    const yScale = coord.scales.y[seriesAxisId];
    const session = sessionMap?.[s.id];
    if (!yScale) continue;

    const point = lastVisibleSeriesPoint(
      s,
      xRuntime,
      seriesAxis,
      yScale,
      transform,
    );
    if (!point) continue;
    const { x: lastX } = point;
    let y = point.y;
    let value = point.value;
    if (isExtendedSession(session)) {
      const regularValue = sessionAxisValue(session.regularClose, transform);
      if (regularValue !== undefined) {
        const regularY = CoordSys.toPixel(regularValue, yScale);
        if (Number.isFinite(regularY)) {
          y = regularY;
          value = regularValue;
        }
      }
    }
    if (y < 0 || y > areaHeight) continue;

    const paneId = paneIdsBySeries.get(s.id) ?? ChartStateModel.MAIN_PANE_ID;
    const primarySeriesId = primarySeriesIdInPane(state, paneId);
    const isPrimarySeries = primarySeriesId === s.id;
    const isFocusedSeries = focusedSeriesId === s.id;
    const isFloatingFocusedSeries = floatingValueTagSeriesId === s.id;
    const axisIsFixed =
      !!seriesAxis && seriesAxis.visible && seriesAxis.fixed !== false;
    const seriesOptions = s.options as Record<string, unknown>;
    const lastValueVisible = hasLastValueVisible(s);
    const seriesValueLineVisible = hasValueLineVisible(s);
    const tagDimmed = isDimmedBySeriesContext(s);
    if (!lastValueVisible && !seriesValueLineVisible) continue;
    const floatingOverlay =
      !axisIsFixed && isFocusedSeries && runtime.floatingAxisOverlays?.length
        ? runtime.floatingAxisOverlays.find(
            (item) => item.axisId === seriesAxisId && item.seriesId === s.id,
          )
        : undefined;
    const hasFloatingOverlay = !!floatingOverlay;
    const labelsVisible = seriesAxis?.labels?.visible !== false;
    const shouldDrawLabel =
      lastValueVisible &&
      !isFloatingFocusedSeries &&
      (hasFloatingOverlay || labelsVisible) &&
      (isPrimarySeries ||
        isFocusedSeries ||
        axisIsFixed ||
        (s.type === "Histogram" && seriesOptions.lastValueVisible === true));
    const axisValueLineMode =
      (seriesOptions.valueLineMode as
        "off" | "partial" | "extended" | undefined) ??
      seriesAxis?.valueLine?.mode ??
      (valueLine.visible ? "extended" : "off");
    // The price line follows the per-series `valueLineVisible` toggle
    // exposed in the series-config modal (see Style → Price Line). It used
    // to be gated on `isPrimarySeries`, which silently overrode the toggle
    // for comparison tickers and overlay indicators — turning the switch
    // on did nothing visible. Trust the per-series option and the axis-
    // level mode; default-off series (indicators) stay off because their
    // creator code sets `valueLineVisible: false`.
    const shouldDrawValueLine =
      seriesValueLineVisible &&
      !isFloatingFocusedSeries &&
      !hasFloatingOverlay &&
      axisValueLineMode !== "off";

    const seriesColor = getSeriesColor(s);
    const defaultTagColor = Color.salient(seriesColor);
    const baseTagColor =
      (seriesOptions.lastValueTagColor as string | undefined) ??
      seriesAxis?.labels?.tagColor ??
      defaultTagColor;
    const tagColor = isFocusedSeries
      ? emphasizeColor(baseTagColor, {
          alphaBoost: 0.36,
          fallback: Color.resolve(SERIES_FOCUS_GLOW_COLOR),
          hexFactor: 0.32,
        })
      : baseTagColor;
    const explicitTextColor = seriesOptions.lastValueTextColor as
      string | undefined;
    const textColor =
      explicitTextColor ??
      seriesAxis?.labels?.textColor ??
      Color.contrast(baseTagColor);
    const borderColor = isFocusedSeries
      ? focusedValueTagBorderColor(textColor)
      : undefined;
    const tagFont = isFocusedSeries ? focusedValueTagFont(font) : font;

    const useAxis =
      seriesAxis && (seriesAxis.visible || isFocusedSeries)
        ? seriesAxis
        : firstRightAxis;
    if (!useAxis) continue;

    let axisX = axisXFor(useAxis);
    const useAxisSide = effectiveAxisSide(useAxis);
    const rightEdge = areaX + areaWidth;
    const spacing =
      activeAxis.mode === "ordinal"
        ? activeAxis.spacing.barSpacing
        : Math.max(1, xRuntime.barWidth);
    const isAdjacent = lastX !== undefined && lastX >= rightEdge - spacing;

    const label =
      s.type === "Histogram"
        ? Locale.compact(value)
        : formatAxisValue(seriesAxis, value);
    const countdown =
      session && typeof session.nextCloseAt === "number"
        ? formatCountdown(session.nextCloseAt)
        : undefined;
    ctx.save();
    ctx.font = tagFont;
    let extendedTag:
      | {
          label: string;
          ticker: string;
          axisValue: number;
          tagWidth: number;
          badgeW: number;
        }
      | undefined;
    if (
      session &&
      (session.phase === "post" || session.phase === "pre") &&
      typeof session.extendedPrice === "number" &&
      session.extendedLabel
    ) {
      const extendedAxisValue = sessionAxisValue(
        session.extendedPrice,
        transform,
      );
      if (extendedAxisValue !== undefined) {
        const extLabel = formatAxisValue(seriesAxis, extendedAxisValue);
        const extTicker = session.extendedLabel;
        extendedTag = {
          label: extLabel,
          ticker: extTicker,
          axisValue: extendedAxisValue,
          tagWidth: Draw.measureValueTagWidth(
            ctx,
            extLabel,
            axisWidth,
            countdown,
          ),
          badgeW:
            ctx.measureText(extTicker).width + Draw.TICKER_BADGE_PADDING * 2,
        };
      }
    }
    const isExtendedSessionTag = isExtendedSession(session);
    const tagSubLabel =
      isExtendedSessionTag && extendedTag ? undefined : countdown;
    const tagWidth = Draw.measureValueTagWidth(
      ctx,
      label,
      axisWidth,
      tagSubLabel,
    );
    let valueTagWidth = tagWidth;
    if (extendedTag) {
      valueTagWidth = Math.max(valueTagWidth, extendedTag.tagWidth);
    }
    ctx.restore();

    // Pre-compute ticker badge bounds so the value line can be clipped before it
    const ticker = shouldDrawLabel
      ? ((s.options as Record<string, unknown>).title as string | undefined)
      : undefined;
    let badgeX: number | undefined;
    let badgeW = 0;
    if (ticker) {
      ctx.save();
      ctx.font = tagFont;
      badgeW = ctx.measureText(ticker).width + Draw.TICKER_BADGE_PADDING * 2;
      ctx.restore();
      badgeX =
        useAxisSide === "right"
          ? axisX + axisWidth - valueTagWidth - badgeW - Draw.TICKER_BADGE_GAP
          : axisX + valueTagWidth + Draw.TICKER_BADGE_GAP;
    }

    // Draw value line immediately (only for primary series)
    if (shouldDrawValueLine && lastX !== undefined) {
      if (valueLine.showWhenAdjacent || !isAdjacent) {
        withSeriesContextAlpha(s, () => {
          const lineColor =
            (seriesOptions.valueLineColor as string | undefined) ??
            seriesAxis?.valueLine?.color ??
            valueLine.color ??
            seriesColor;
          const style =
            (seriesOptions.valueLineStyle as
              "dashed" | "dotted" | "solid" | undefined) ??
            seriesAxis?.valueLine?.style ??
            valueLine.style;
          const pattern =
            style === "dotted" ? [2, 2] : style === "solid" ? [] : [4, 4];
          let lineStartX = axisValueLineMode === "extended" ? areaX : lastX;
          let lineEndX =
            axisValueLineMode === "extended"
              ? rightEdge
              : useAxisSide === "left"
                ? areaX
                : rightEdge;

          // Clip line so it doesn't show through the badge-to-tag gap
          if (badgeX !== undefined) {
            if (useAxisSide === "right") lineEndX = Math.min(lineEndX, badgeX);
            else lineStartX = Math.max(lineStartX, badgeX + badgeW);
          }

          if (pattern.length === 0) {
            ctx.save();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lineStartX, y + 0.5);
            ctx.lineTo(lineEndX, y + 0.5);
            ctx.stroke();
            ctx.restore();
          } else {
            Draw.dashedLine(ctx, y, lineStartX, lineEndX, lineColor, pattern);
          }
        });
      }
    }

    // Collect tag entry for deferred anti-clutter rendering
    if (shouldDrawLabel) {
      if (floatingOverlay) {
        axisX =
          useAxisSide === "left"
            ? floatingOverlay.x + 8
            : floatingOverlay.x + floatingOverlay.width - axisWidth;
      }
      const isLive =
        (s.options as Record<string, unknown>).liveIndicator === true;
      const paneRect = paneRectForSeries(s.id);
      pendingTags.push({
        naturalY: y,
        adjustedY: y,
        axisId: useAxis.id,
        paneTop: paneRect.y,
        paneBottom: paneRect.y + paneRect.height,
        label,
        axisX,
        axisWidth,
        valueTagWidth,
        side: useAxisSide,
        tagColor,
        textColor,
        ticker,
        badgeX,
        badgeW,
        liveIndicator: isLive,
        lastX,
        seriesColor,
        livePulseTime: isLive
          ? ((s.options as Record<string, unknown>).livePulseTime as
              number | undefined)
          : undefined,
        dimmed: tagDimmed,
        focused: isFocusedSeries,
        font: tagFont,
        borderColor,
        subLabel: tagSubLabel,
        stableOrder: pendingTags.length,
        sessionPairId: isExtendedSessionTag ? s.id : undefined,
        sessionPairOrder: isExtendedSessionTag ? 0 : undefined,
      });

      // Extended-session secondary pill (e.g. "Post 88.16"). Drawn at the
      // extended price's pixel y with an accent color so it's visually
      // distinct from the regular-session pill.
      if (extendedTag) {
        const extY = CoordSys.toPixel(extendedTag.axisValue, yScale);
        if (
          Number.isFinite(extY) &&
          extY >= paneRect.y &&
          extY <= paneRect.y + paneRect.height
        ) {
          const extTagColor = "#2962FF";
          const extTextColor = "#FFFFFF";
          const extBadgeX =
            useAxisSide === "right"
              ? axisX +
                axisWidth -
                valueTagWidth -
                extendedTag.badgeW -
                Draw.TICKER_BADGE_GAP
              : axisX + valueTagWidth + Draw.TICKER_BADGE_GAP;
          pendingTags.push({
            naturalY: extY,
            adjustedY: extY,
            axisId: useAxis.id,
            paneTop: paneRect.y,
            paneBottom: paneRect.y + paneRect.height,
            label: extendedTag.label,
            axisX,
            axisWidth,
            valueTagWidth,
            side: useAxisSide,
            tagColor: extTagColor,
            textColor: extTextColor,
            ticker: extendedTag.ticker,
            badgeX: extBadgeX,
            badgeW: extendedTag.badgeW,
            liveIndicator: false,
            lastX: undefined,
            seriesColor,
            livePulseTime: undefined,
            dimmed: tagDimmed,
            focused: isFocusedSeries,
            font: tagFont,
            borderColor,
            subLabel: countdown,
            stableOrder: pendingTags.length,
            sessionPairId: s.id,
            sessionPairOrder: 1,
          });
        }
      }
    } else {
      // Still need live indicator even without a label
      const isLive =
        (s.options as Record<string, unknown>).liveIndicator === true;
      if (
        isLive &&
        lastX !== undefined &&
        lastX >= areaX &&
        lastX <= areaX + areaWidth
      ) {
        withSeriesContextAlpha(s, () => {
          drawLiveIndicatorDot(
            ctx,
            lastX,
            y,
            seriesColor,
            (s.options as Record<string, unknown>).livePulseTime as
              number | undefined,
          );
        });
      }
    }
  }

  // --- Pass 2: resolve overlapping tags on the same axis ---
  const TAG_GAP = 2; // minimum px between unrelated tags
  const SESSION_TAG_GAP = 0; // regular and extended-session tags should read as a stack
  const tagHeight = (tag: PendingTag): number =>
    tag.subLabel ? Draw.VALUE_TAG_HEIGHT_TALL : Draw.VALUE_TAG_HEIGHT;
  const isSessionPair = (a: PendingTag, b: PendingTag): boolean =>
    a.sessionPairId !== undefined && a.sessionPairId === b.sessionPairId;
  const tagSpacing = (a: PendingTag, b: PendingTag): number =>
    (tagHeight(a) + tagHeight(b)) / 2 +
    (isSessionPair(a, b) ? SESSION_TAG_GAP : TAG_GAP);

  // Group tags by axis id — only same-axis tags need anti-clutter
  const tagsByAxis = new Map<string, PendingTag[]>();
  for (const tag of pendingTags) {
    let group = tagsByAxis.get(tag.axisId);
    if (!group) {
      group = [];
      tagsByAxis.set(tag.axisId, group);
    }
    group.push(tag);
  }

  time(
    "value-tags.layout",
    () => {
      for (const group of tagsByAxis.values()) {
        if (group.length <= 1) continue;
        // Sort by natural y position (top to bottom), but keep the regular and
        // extended-session pills in a stable visual order while they are clustered.
        group.sort((a, b) => {
          if (isSessionPair(a, b)) {
            if (Math.abs(a.naturalY - b.naturalY) < tagSpacing(a, b)) {
              return (a.sessionPairOrder ?? 0) - (b.sessionPairOrder ?? 0);
            }
          }
          const natural = a.naturalY - b.naturalY;
          if (natural !== 0) return natural;
          return a.stableOrder - b.stableOrder;
        });
        // Iterative relaxation: push overlapping tags apart from center of cluster
        for (let iter = 0; iter < 3; iter++) {
          for (let i = 1; i < group.length; i++) {
            const prev = group[i - 1]!;
            const curr = group[i]!;
            const pairSpacing = tagSpacing(prev, curr);
            const overlap = pairSpacing - (curr.adjustedY - prev.adjustedY);
            if (overlap > 0) {
              const half = overlap / 2;
              prev.adjustedY -= half;
              curr.adjustedY += half;
            }
          }
          // Clamp to visible area
          for (const tag of group) {
            const h = tagHeight(tag);
            tag.adjustedY = Math.max(
              tag.paneTop + h / 2,
              Math.min(tag.paneBottom - h / 2, tag.adjustedY),
            );
          }
        }
      }
    },
    { tagCount: pendingTags.length, axisCount: tagsByAxis.size },
  );

  // --- Pass 3: draw tags and live indicator dots at adjusted positions ---
  time(
    "value-tags.draw",
    () => {
      for (const tag of [...pendingTags].sort(compareValueTagPaintOrder)) {
        const drawTag = () => {
          if (tag.borderColor) {
            Draw.valueTag(
              ctx,
              tag.adjustedY,
              tag.label,
              tag.axisX,
              tag.axisWidth,
              tag.side,
              tag.tagColor,
              tag.textColor,
              tag.font,
              tag.subLabel,
              tag.valueTagWidth,
              tag.borderColor,
            );
          } else {
            Draw.valueTag(
              ctx,
              tag.adjustedY,
              tag.label,
              tag.axisX,
              tag.axisWidth,
              tag.side,
              tag.tagColor,
              tag.textColor,
              tag.font,
              tag.subLabel,
              tag.valueTagWidth,
            );
          }

          if (tag.ticker && tag.badgeX !== undefined) {
            // When the paired value tag is two-line (label + countdown sub-label),
            // shift the single-line ticker pill up by half the height delta so its
            // top aligns with the tall pill's top — visually pinning the ticker to
            // the label row, with empty space (where the sub-label sits) below.
            const tickerY = tag.subLabel
              ? tag.adjustedY -
                (Draw.VALUE_TAG_HEIGHT_TALL - Draw.VALUE_TAG_HEIGHT) / 2
              : tag.adjustedY;
            if (tag.borderColor) {
              Draw.tickerBadge(
                ctx,
                tickerY,
                tag.ticker,
                tag.badgeX,
                tag.badgeW,
                tag.tagColor,
                tag.textColor,
                tag.font,
                tag.borderColor,
              );
            } else {
              Draw.tickerBadge(
                ctx,
                tickerY,
                tag.ticker,
                tag.badgeX,
                tag.badgeW,
                tag.tagColor,
                tag.textColor,
                tag.font,
              );
            }
          }
        };

        if (tag.dimmed) {
          ctx.save();
          ctx.globalAlpha *= SERIES_CONTEXT_DIM_ALPHA;
          drawTag();
          ctx.restore();
        } else {
          drawTag();
        }

        if (
          tag.liveIndicator &&
          tag.lastX !== undefined &&
          tag.lastX >= areaX &&
          tag.lastX <= areaX + areaWidth
        ) {
          const drawDot = () => {
            drawLiveIndicatorDot(
              ctx,
              tag.lastX!,
              tag.naturalY,
              tag.seriesColor,
              tag.livePulseTime,
            );
          };
          if (tag.dimmed) {
            ctx.save();
            ctx.globalAlpha *= SERIES_CONTEXT_DIM_ALPHA;
            drawDot();
            ctx.restore();
          } else {
            drawDot();
          }
        }
      }
    },
    { tagCount: pendingTags.length },
  );

  // Annotation hit/layout state is prepared near event overlays, but the
  // visible card paint must sit above drawings, alert/value lines, and tags.
  paintDeferredChartAnnotations?.();

  const plot = { x: areaX, y: 0, width: areaWidth, height: areaHeight };
  if (state.crosshair.visible && state.crosshair.x !== undefined) {
    const crosshairPaneId = state.crosshair.paneId;
    // Scope focus and the primary series to the pointer's pane before choosing an axis.
    const crosshairSeriesId =
      crosshairPaneId === undefined
        ? undefined
        : ([
            state.lockedSeriesId,
            state.hoveredSeriesId,
            state.focusedSeriesId,
          ].find(
            (id) =>
              id !== undefined && paneIdsBySeries.get(id) === crosshairPaneId,
          ) ?? primarySeriesIdInPane(state, crosshairPaneId));
    const crosshairSeries = crosshairSeriesId
      ? ChartStateModel.resolvedSeries(state, crosshairSeriesId)
      : undefined;
    const crosshairAxis = crosshairSeries
      ? axes.find(
          (axis) =>
            axis.id === Series.getYAxisId(crosshairSeries) &&
            axisPaneId.get(axis.id) === crosshairPaneId,
        )
      : undefined;
    const crosshairYScale = crosshairAxis
      ? coord.scales.y[crosshairAxis.id]
      : undefined;
    const anchorCrosshairSnap =
      state.crosshair.y === undefined
        ? undefined
        : fixedComparisonAnchorCrosshairSnap(
            state,
            crosshairAxis,
            crosshairYScale,
            state.crosshair.y,
          );
    const crosshairY = anchorCrosshairSnap?.y ?? state.crosshair.y;

    Draw.crosshair(ctx, state.crosshair.x, crosshairY, plot, crosshair.color);

    // Crosshair badges for prediction markets
    const badgesEnabled =
      (crosshair as Record<string, unknown>).crosshairBadges === true;
    if (badgesEnabled && state.crosshair.logicalIndex !== undefined) {
      type Badge = {
        y: number;
        title: string;
        value: string;
        color: string;
        textColor: string;
      };
      const badges: Badge[] = [];
      const cx = state.crosshair.x!;

      for (const s of all) {
        if (!isVisible(s)) continue;
        if (s.parentId) continue;
        if (s.type === "Histogram") continue;

        const xRuntime = seriesMap.get(s.id);
        if (!xRuntime) continue;

        const axisId = Series.getYAxisId(s);
        const seriesAxis = axisById.get(axisId);
        const transform = modeTransforms.get(s.id);
        const yScale = coord.scales.y[axisId];
        if (!yScale) continue;

        const readVal = (i: number): number | undefined => {
          if (i < 0 || i >= s.data.length) return undefined;
          const pt = s.data[i] as Record<string, unknown> | undefined;
          if (!pt) return undefined;
          const raw =
            readNumber(pt, s, "close", "close") ??
            readNumber(pt, s, "value", "value");
          if (raw === undefined) return undefined;
          const value = transform ? transform.value(raw) : raw;
          return Number.isFinite(value) ? value : undefined;
        };

        // Find the two data points bracketing the crosshair X and interpolate
        const idx =
          state.crosshair.logicalIndex! - Number(s.options.xOffset ?? 0);
        const idxX = xRuntime.xPositions[idx] ?? xRuntime.xFn(idx);
        let interpValue: number | undefined;
        if (cx < idxX && idx > 0) {
          const prevX = xRuntime.xPositions[idx - 1] ?? xRuntime.xFn(idx - 1);
          const v0 = readVal(idx - 1);
          const v1 = readVal(idx);
          if (v0 !== undefined && v1 !== undefined) {
            const span = idxX - prevX;
            const t = span > 0 ? (cx - prevX) / span : 1;
            interpValue = v0 + (v1 - v0) * t;
          }
        } else if (cx > idxX && idx < s.data.length - 1) {
          const nextX = xRuntime.xPositions[idx + 1] ?? xRuntime.xFn(idx + 1);
          const v0 = readVal(idx);
          const v1 = readVal(idx + 1);
          if (v0 !== undefined && v1 !== undefined) {
            const span = nextX - idxX;
            const t = span > 0 ? (cx - idxX) / span : 0;
            interpValue = v0 + (v1 - v0) * t;
          }
        } else {
          interpValue = readVal(idx);
        }

        if (interpValue === undefined || !Number.isFinite(interpValue))
          continue;

        const pixelY = CoordSys.toPixel(interpValue, yScale);
        if (pixelY < 0 || pixelY > areaHeight) continue;

        const color = getSeriesColor(s);
        badges.push({
          y: pixelY,
          title: ((s.options as Record<string, unknown>).title as string) || "",
          value: formatAxisValue(seriesAxis, interpValue),
          color,
          textColor: Color.contrast(color),
        });
      }

      // Resolve vertical overlaps
      badges.sort((a, b) => a.y - b.y);
      const badgeH = 22;
      for (let i = 1; i < badges.length; i++) {
        if (badges[i]!.y - badges[i - 1]!.y < badgeH) {
          badges[i]!.y = badges[i - 1]!.y + badgeH;
        }
      }

      // Clip to chart area and draw
      ctx.save();
      ctx.beginPath();
      ctx.rect(areaX, 0, areaWidth, areaHeight);
      ctx.clip();
      for (const b of badges) {
        Draw.crosshairBadge(
          ctx,
          cx,
          b.y,
          b.title,
          b.value,
          b.color,
          b.textColor,
          font,
        );
      }
      ctx.restore();
    }

    const crosshairBg = crosshair.color;
    const crosshairText = Color.contrast(crosshairBg);

    if (crosshairAxis && crosshairY !== undefined) {
      const yScale = crosshairYScale;
      if (yScale) {
        const value = CoordSys.toValue(crosshairY, yScale);
        const label =
          anchorCrosshairSnap?.label ?? formatAxisValue(crosshairAxis, value);
        const crosshairAxisSide = effectiveAxisSide(crosshairAxis);
        const fixedAxisX = axisXFor(crosshairAxis);
        let axisBounds = { x: fixedAxisX, width: axisWidth };
        if (
          crosshairAxis.fixed === false &&
          crosshairSeriesId &&
          runtime.floatingAxisOverlays?.length
        ) {
          const overlay = runtime.floatingAxisOverlays.find(
            (item) =>
              item.axisId === crosshairAxis.id &&
              item.seriesId === crosshairSeriesId,
          );
          if (overlay) {
            const axisLineX =
              crosshairAxisSide === "left"
                ? overlay.x + overlay.width - 2
                : overlay.x + 2;
            axisBounds = {
              x:
                crosshairAxisSide === "left"
                  ? axisLineX - axisWidth
                  : axisLineX,
              width: axisWidth,
            };
          }
        }
        Draw.crosshairYTag(
          ctx,
          crosshairY,
          label,
          axisBounds,
          crosshairAxisSide,
          crosshairBg,
          crosshairText,
          font,
        );
      }
    }

    if (config.xAxis.visible && state.crosshair.time !== undefined) {
      const xField = activeAxis.field ?? "time";
      let timeLabel: string;
      if (xField === "time" && activeSeries && activeSeriesRuntime) {
        const xf = resolveField(activeSeries, "x", xField);
        const tData = activeSeries.data;
        const tTimes: unknown[] = new Array(tData.length);
        for (
          let i = activeSeriesRuntime.range.from;
          i < activeSeriesRuntime.range.to && i < tData.length;
          i++
        ) {
          tTimes[i] = (tData[i] as Record<string, unknown> | undefined)?.[xf];
        }
        const barInterval = TimeAxis.inferBarInterval(
          tTimes,
          activeSeriesRuntime.range,
        );
        const unit =
          barInterval !== null
            ? TimeAxis.barIntervalToUnit(barInterval)
            : ("day" as const);
        timeLabel = TimeAxis.formatCrosshair(
          state.crosshair.time,
          unit,
          activeTimeDisplayTimezone,
        );
      } else {
        timeLabel = formatXValue(activeAxis, state.crosshair.time);
      }
      const axisBounds = {
        x: areaX,
        y: timeAxisY,
        width: areaWidth,
        height: timeAxisHeight,
      };
      Draw.crosshairXTag(
        ctx,
        state.crosshair.x!,
        timeLabel,
        axisBounds,
        crosshairBg,
        crosshairText,
        font,
      );
    }
  }

  // Persist per-series data refs for next frame's light-level cache check.
  runtime.seriesDataRefs = nextDataRefs;
  runtime.seriesRenderSignatures = nextRenderSignatures;

  return { from: activeRange.from, to: activeRange.to };
}

export const __testing = {
  buildSeriesXRuntimes,
  computeXRuntimeSignature,
  annotationRenderPositionSignature,
  annotationRenderSolveSignature,
  buildModeTransforms,
  compareValueTagPaintOrder,
  computeExtents,
  fixedComparisonAnchorCrosshairSnap,
  foldModeTransformIntoScale,
  projectedXForTime,
  sessionAxisValue,
  seriesRenderSignature,
};
