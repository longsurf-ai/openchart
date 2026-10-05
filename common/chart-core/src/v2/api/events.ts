// Purpose: Attach all canvas DOM event listeners (mouse, wheel, keyboard) and translate them into state mutations and render calls
// Module:  @openchart/chart-core / v2 / api

import { Chart } from "@openchart/chart-core/chart/state";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { Series } from "@openchart/chart-core/series";
import { Data } from "@openchart/chart-core/data/schema";
import { computeVisibleExtent } from "./helpers";
import {
  Action,
  Effect,
  Mapping,
  Drag,
  Input,
  Cursor,
} from "@openchart/chart-core/interaction";
import { Invalidate } from "@openchart/chart-core/invalidate";
import {
  Drawing,
  DrawingRenderUtils,
  hitTestDrawings,
} from "@openchart/chart-core/drawing";
import { continuousDrawingTime } from "@openchart/chart-core/drawing/geometry";
import { SpanRenderUtils } from "@openchart/chart-core/span";
import { hitMarkers, type MarkerHit } from "@openchart/chart-core/marker";
import {
  ChartAnnotation,
  createDraftAnnotationRecord,
  expandChartAnnotationPlacements,
  hitChartAnnotationPlacements,
  hitChartAnnotations,
  hitFromPlacement,
  layoutChartAnnotations,
  type ChartAnnotationHit,
} from "@openchart/chart-core/annotation";
import { CoordSys } from "@openchart/chart-core/coord";
import { Color, UUID } from "@openchart/chart-core/util";
import type {
  YAxisConfig,
  XAxisConfig,
} from "@openchart/chart-core/scale/config";
import { type RuntimeState as PaintRuntimeState } from "@openchart/chart-core/v2/paint";
import {
  axisDataLength,
  axisSeries,
  deriveLinearDomain,
  getAxis,
  linearNearestIndex,
  linearSeriesValues,
  linearValueToX,
  linearVisibleRange,
  linearXToValue,
  ordinalIndexToX,
  ordinalVisibleRange,
  ordinalXToIndex,
  setAxisDomain,
  setAxisSpacing,
} from "@openchart/chart-core/v2/x-scale";
import {
  readNumber,
  resolveField,
} from "@openchart/chart-core/v2/series/fields";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import * as ChartPaneLayout from "@openchart/chart-core/v2/state/pane-layout";
import {
  modeBaseline,
  modeTransformValue,
} from "@openchart/chart-core/v2/scale-mode";
import { resolveDrawingDefaultColor } from "./drawing-default-color";

type Axis = YAxisConfig.Axis;
const PANE_SEPARATOR_HIT_PX = 5;

/** Events need the full HTMLCanvasElement (for DOM listeners), narrowing paint's generic canvas type. */
export interface RuntimeState extends Omit<PaintRuntimeState, "canvas"> {
  canvas: HTMLCanvasElement;
}

export interface EventsConfig {
  canvas: HTMLCanvasElement;
  getState: () => Chart.State;
  setState: (mutator: (state: Chart.State) => void) => void;
  getRuntime: () => RuntimeState;
  scheduleRender: (level: Invalidate.Level) => void;
  onFocus?: () => void;
  onDrawingToolAutoClear?: () => void;
  getDrawingItems?: (state: Chart.State) => Drawing.Item[];
  onAddDrawing?: (state: Chart.State, item: Drawing.Item) => void;
  onUpdateDrawing?: (
    state: Chart.State,
    itemId: string,
    update: (prev: Drawing.Item) => Drawing.Item,
  ) => void;
  onUpdateChartAnnotation?: (
    state: Chart.State,
    annotationId: string,
    patch: {
      label?: string;
      sentiment?: ChartAnnotation.Sentiment;
      priorityScore?: number;
      anchor?: ChartAnnotation.Anchor;
      style?: ChartAnnotation.Style;
      visibility?: ChartAnnotation.Visibility;
      revision: number;
    },
  ) => void;
}

export interface EventsController {
  (): void;
  refreshExpandedAnnotationHoverGeometry(): void;
  /** Begin dragging DOM-projected card content using client coordinates. Window listeners end on release or disposal.
   * @example events.beginAnnotationDrag(id, { x: event.clientX, y: event.clientY });
   */
  beginAnnotationDrag(id: string, clientPoint: Action.Point): void;
}

export function setupEvents(config: EventsConfig): EventsController {
  const {
    canvas,
    getState,
    setState,
    getRuntime,
    scheduleRender,
    onDrawingToolAutoClear,
  } = config;
  const seriesValues = (state: Chart.State) =>
    ChartStateModel.resolvedSeriesValues(state);
  const getSeries = (state: Chart.State, seriesId: string) =>
    ChartStateModel.resolvedSeries(state, seriesId);

  type DragState = Drag.State | null;
  let drag: DragState = null;
  let dragActivated = false;
  type PaneResizeDragState = {
    topPaneId: string;
    bottomPaneId: string;
    startY: number;
    topStartHeight: number;
    bottomStartHeight: number;
    totalStartHeight: number;
    layoutAreaStartHeight: number;
  } | null;
  let paneResizeDrag: PaneResizeDragState = null;
  type ChartExplainDragState = {
    start: Action.Point;
    current: Action.Point;
    color: string;
    mode: "thinking" | "fast";
  } | null;
  let chartExplainDrag: ChartExplainDragState = null;

  const CHART_EXPLAIN_SCAN_COLORS = [
    "174 86% 62%",
    "256 90% 72%",
    "38 94% 66%",
    "326 88% 70%",
    "204 94% 66%",
    "116 76% 64%",
  ];

  function nextChartExplainColor(state: Chart.State): string {
    const used = new Set(
      state.chartExplain?.progressBands?.map((band) => band.color) ?? [],
    );
    return (
      CHART_EXPLAIN_SCAN_COLORS.find((color) => !used.has(color)) ??
      CHART_EXPLAIN_SCAN_COLORS[
        (state.chartExplain?.progressBands?.length ?? 0) %
          CHART_EXPLAIN_SCAN_COLORS.length
      ]!
    );
  }

  function getDrawCursor(): string {
    const textColor = Color.resolve(
      getState().config.chart.layout.textColor ?? "#d1d5db",
    );
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 12h6M14 12h6M12 10V4M12 20v-6" stroke="${textColor}" stroke-linecap="round"/><circle cx="12" cy="12" r="1" fill="${textColor}"/></svg>`,
    )}") 12 12, crosshair`;
  }

  type DrawingDrag =
    | { mode: "draft"; tool: Drawing.Type; startAnchor: Drawing.Anchor }
    | { mode: "draft_multi"; tool: Drawing.Type; anchors: Drawing.Anchor[] }
    | {
        mode: "freehand";
        anchors: Drawing.Anchor[];
        lastPoint: Action.Point;
      }
    | {
        mode: "handle";
        id: string;
        handleIndex: number;
        startAnchors: Drawing.Anchor[];
        startPoint: Action.Point;
      }
    | {
        mode: "body";
        id: string;
        startAnchors: Drawing.Anchor[];
        startPoint: Action.Point;
      }
    | null;

  let drawingDrag: DrawingDrag = null;
  type AnnotationHandleDrag = {
    id: string;
    handle: "targetAnchor" | "labelAnchor";
    pointerOffset?: Action.Point;
    startPoint: Action.Point;
    movable: boolean;
    expandOnClick: boolean;
    moved: boolean;
    previewAnchor?: ChartAnnotation.Anchor;
  } | null;
  let annotationHandleDrag: AnnotationHandleDrag = null;
  let canvasHoveredAnnotationId: string | undefined;
  let lastExpandedAnnotationHoverGeometrySignature: string | undefined;
  let suppressNextClick = false;
  const setCanvasCursor = (value: string) => {
    if (canvas.style.cursor !== value) {
      canvas.style.cursor = value;
    }
  };
  const clientAnchor = (
    rect: DOMRect,
    anchor: { x: number; y: number },
  ): { x: number; y: number } => ({
    x: rect.left + anchor.x,
    y: rect.top + anchor.y,
  });
  const clientAnnotationRect = (
    rect: DOMRect,
    pill: { x: number; y: number; width: number; height: number },
  ): { x: number; y: number; width: number; height: number } => ({
    x: rect.left + pill.x,
    y: rect.top + pill.y,
    width: pill.width,
    height: pill.height,
  });
  const clientAnnotationHit = (
    rect: DOMRect,
    hit: MarkerHit | ChartAnnotationHit,
  ) => ({
    ...hit,
    anchor: clientAnchor(rect, hit.anchor),
    ...(hit.kind === "chart_annotation"
      ? {
          pill: clientAnnotationRect(rect, hit.pill),
          ...(hit.compactPill
            ? { compactPill: clientAnnotationRect(rect, hit.compactPill) }
            : {}),
          ...(hit.actionButton
            ? { actionButton: clientAnnotationRect(rect, hit.actionButton) }
            : {}),
        }
      : {}),
  });
  const clientChartAnnotationHit = (
    rect: DOMRect,
    hit: ChartAnnotationHit,
  ) => ({
    ...hit,
    anchor: clientAnchor(rect, hit.anchor),
    pill: clientAnnotationRect(rect, hit.pill),
    ...(hit.compactPill
      ? { compactPill: clientAnnotationRect(rect, hit.compactPill) }
      : {}),
    ...(hit.actionButton
      ? { actionButton: clientAnnotationRect(rect, hit.actionButton) }
      : {}),
  });

  function annotationAnchorWithChartPoint(
    base: ChartAnnotation.Anchor,
    handle: "targetAnchor" | "labelAnchor",
    anchor: Drawing.Anchor,
    options?: { preserveTargetTime?: boolean },
  ): ChartAnnotation.Anchor {
    if (handle === "labelAnchor") {
      return { ...base, labelAnchor: anchor };
    }
    if (options?.preserveTargetTime) {
      return {
        ...base,
        targetAnchor: {
          ...anchor,
          time: base.targetAnchor?.time ?? base.start,
        },
      };
    }
    return {
      ...base,
      start: anchor.time,
      targetAnchor: anchor,
    };
  }

  function annotationRecord(
    state: Chart.State,
    annotationId: string,
  ): ChartAnnotation.Renderable | undefined {
    return ChartStateModel.annotationItems(state).find(
      (annotation) => annotation.id === annotationId,
    );
  }

  type AnnotationCreateDraft = Exclude<
    NonNullable<Chart.State["annotationCreate"]>,
    { phase: "armed" }
  >;

  function clientDraftPill(
    state: Chart.State,
    entry: ReturnType<typeof createFakeEntry>,
    rect: DOMRect,
    draft: AnnotationCreateDraft,
  ): { x: number; y: number; width: number; height: number } | undefined {
    const render = buildDrawingContext(entry);
    if (!render) return undefined;
    const placement = layoutChartAnnotations({
      ctx: entry.ctx,
      textCache: entry.textCache,
      render,
      annotations: [
        ...ChartStateModel.annotationItems(state),
        createDraftAnnotationRecord({
          id: draft.id,
          label: draft.label,
          anchor: draft.anchor,
        }),
      ],
      activeAnnotationId: draft.id,
    }).find((item) => item.annotation.id === draft.id);
    return placement ? clientAnnotationRect(rect, placement.pill) : undefined;
  }

  const createFakeEntry = (stateOverride?: Chart.State) => {
    const state = stateOverride ?? getState();
    const runtime = getRuntime();
    return {
      state,
      container: runtime.canvas.parentElement ?? runtime.canvas,
      canvas: runtime.canvas,
      ctx: runtime.ctx,
      ratio: runtime.ratio,
      textCache: runtime.textCache,
      labelCache: runtime.labelCache,
      renderCache: runtime.renderCache,
      annotationLayoutState: runtime.annotationLayoutState,
      xCache: runtime.xCache,
      coord: runtime.coord,
      panePrimitives: runtime.panePrimitives,
      seriesPrimitives: runtime.seriesPrimitives,
      annotationPlacements: runtime.annotationPlacements,
      annotationHitPlacements: runtime.annotationHitPlacements,
      annotationHitPlacementsSignature:
        runtime.annotationHitPlacementsSignature,
    };
  };

  const floatingAxisAtPoint = (pt: Action.Point) => {
    const overlays = getRuntime().floatingAxisOverlays ?? [];
    return overlays.find(
      (overlay) =>
        pt.x >= overlay.x &&
        pt.x <= overlay.x + overlay.width &&
        pt.y >= overlay.y &&
        pt.y <= overlay.y + overlay.height,
    );
  };

  function getPrimarySeries(state: Chart.State, xAxisId?: string) {
    const requested = xAxisId ?? getActiveXAxis(state).id;
    const main = ChartStateModel.mainSeries(state);
    if (main && Series.getXAxisId(main) === requested) return main;
    return (
      seriesValues(state).find(
        (series) => Series.getXAxisId(series) === requested,
      ) ??
      seriesValues(state)[0] ??
      null
    );
  }

  function getActiveXAxis(state: Chart.State) {
    return getAxis(state.config.xAxis, state.config.xAxis.activeId);
  }

  function drawingItems(state: Chart.State): Drawing.Item[] {
    return (
      config.getDrawingItems?.(state) ?? ChartStateModel.drawingItems(state)
    );
  }

  function drawingState(state: Chart.State): Drawing.RenderInput | undefined {
    if (!state.drawings) return undefined;
    return { ...state.drawings, items: drawingItems(state) };
  }

  function addDrawing(state: Chart.State, item: Drawing.Item): void {
    const normalized = Drawing.normalize(item);
    if (config.onAddDrawing) {
      config.onAddDrawing(state, normalized);
      return;
    }
    ChartStateModel.upsertDrawingObject(state, normalized);
  }

  function updateDrawing(
    state: Chart.State,
    itemId: string,
    update: (prev: Drawing.Item) => Drawing.Item,
  ): void {
    if (config.onUpdateDrawing) {
      config.onUpdateDrawing(state, itemId, update);
      return;
    }
    const item = ChartStateModel.drawingItems(state).find(
      (item) => item.id === itemId,
    );
    if (item) ChartStateModel.upsertDrawingObject(state, update(item));
  }

  function getSeriesVisibleRange(
    state: Chart.State,
    series: Series.State,
    layout: ReturnType<typeof Chart.computeLayout>,
  ) {
    const axis = getAxis(state.config.xAxis, Series.getXAxisId(series));
    if (axis.mode === "ordinal") {
      const len = axisDataLength(seriesValues(state), axis.id);
      const { valid } = ordinalVisibleRange(
        state.config,
        axis,
        layout.areaWidth,
        len,
      );
      return {
        from: Math.max(0, valid.from),
        to: Math.min(series.data.length, valid.to),
      };
    }
    const values = linearSeriesValues(series, axis);
    const domain = deriveLinearDomain(
      axis,
      axisSeries(seriesValues(state), axis.id),
    );
    return linearVisibleRange(values, domain);
  }

  function xToSeriesIndex(
    state: Chart.State,
    series: Series.State,
    x: number,
    layout: ReturnType<typeof Chart.computeLayout>,
  ): number {
    const axis = getAxis(state.config.xAxis, Series.getXAxisId(series));
    const localX = x - layout.areaX;
    if (axis.mode === "ordinal") {
      const len = Math.max(1, axisDataLength(seriesValues(state), axis.id));
      return Math.round(
        ordinalXToIndex(state.config, axis, layout.areaWidth, len, localX),
      );
    }
    const values = linearSeriesValues(series, axis);
    const domain = deriveLinearDomain(
      axis,
      axisSeries(seriesValues(state), axis.id),
    );
    const target = linearXToValue(localX, domain, layout.areaWidth);
    return linearNearestIndex(values, target);
  }

  // Build an index→x mapper with the axis, length, domain, and series-values
  // walk computed ONCE up front. The per-index closure then does only the
  // arithmetic that actually depends on the index. Callers that map many
  // indices (e.g. buildDrawingContext, which positions every visible bar) must
  // use this instead of calling `indexToSeriesX` in a loop, otherwise the
  // invariant `seriesValues(state)` walk re-runs for every bar — O(bars ×
  // series) through the SolidJS store proxies.
  function makeIndexToSeriesX(
    state: Chart.State,
    series: Series.State,
    layout: ReturnType<typeof Chart.computeLayout>,
  ): (index: number) => number {
    const axis = getAxis(state.config.xAxis, Series.getXAxisId(series));
    if (axis.mode === "ordinal") {
      const len = Math.max(1, axisDataLength(seriesValues(state), axis.id));
      return (index: number) =>
        layout.areaX +
        ordinalIndexToX(state.config, axis, layout.areaWidth, len, index);
    }
    const values = linearSeriesValues(series, axis);
    const domain = deriveLinearDomain(
      axis,
      axisSeries(seriesValues(state), axis.id),
    );
    return (index: number) => {
      const value = values[index];
      if (!Number.isFinite(value)) return layout.areaX;
      return layout.areaX + linearValueToX(value!, domain, layout.areaWidth);
    };
  }

  function projectedTimeForX(input: {
    state: Chart.State;
    series: Series.State;
    x: number;
    layout: ReturnType<typeof Chart.computeLayout>;
    xField: string;
  }): Drawing.Anchor["time"] | null {
    const xForIndex = makeIndexToSeriesX(
      input.state,
      input.series,
      input.layout,
    );
    const length = input.series.data.length;
    const before = length > 0 && input.x < xForIndex(0);
    const after = length > 0 && input.x > xForIndex(length - 1);
    const points: Array<{ x: number; seconds: number }> = [];
    // Margin projection only needs its edge pair, including on every point of a dragged pencil stroke.
    for (
      let index = after ? Math.max(0, length - 2) : 0;
      index < (before ? Math.min(2, length) : length);
      index++
    ) {
      const row = input.series.data[index] as
        Record<string, unknown> | undefined;
      const raw = row?.[input.xField] ?? row?.time;
      const seconds = Data.readTime(raw);
      if (seconds === undefined) continue;
      const x = xForIndex(index);
      if (!Number.isFinite(x)) continue;
      points.push({ x, seconds });
    }
    if (points.length === 0) return null;
    if (points.length === 1) {
      return before || after ? null : points[0]!.seconds;
    }

    let left = points[0]!;
    let right = points[1]!;
    if (input.x <= points[0]!.x) {
      left = points[0]!;
      right = points[1]!;
    } else if (input.x >= points[points.length - 1]!.x) {
      left = points[points.length - 2]!;
      right = points[points.length - 1]!;
    } else {
      for (let index = 1; index < points.length; index++) {
        const point = points[index]!;
        if (input.x > point.x) {
          left = point;
          right = points[index + 1] ?? point;
          continue;
        }
        right = point;
        break;
      }
    }

    const span = right.x - left.x;
    if ((before || after) && (span <= 0 || right.seconds <= left.seconds))
      return null;
    if (span === 0) return right.seconds;
    const seconds =
      left.seconds +
      ((input.x - left.x) / span) * (right.seconds - left.seconds);
    return seconds;
  }

  function resolveChartExplainSelection(
    state: Chart.State,
    start: Action.Point,
    end: Action.Point,
  ) {
    const series = getPrimarySeries(state);
    if (!series || series.data.length === 0) return null;
    const layout = Chart.computeLayout(state.config);
    const fromRaw = xToSeriesIndex(state, series, start.x, layout);
    const toRaw = xToSeriesIndex(state, series, end.x, layout);
    const fromIndex = Math.max(
      0,
      Math.min(series.data.length - 1, Math.min(fromRaw, toRaw)),
    );
    const toIndex = Math.max(
      0,
      Math.min(series.data.length - 1, Math.max(fromRaw, toRaw)),
    );
    if (toIndex < fromIndex) return null;
    const axis = getAxis(state.config.xAxis, Series.getXAxisId(series));
    const xField = resolveField(series, "x", axis.field || "time");
    const fromTs = Data.readTime(
      (series.data[fromIndex] as Record<string, unknown> | undefined)?.[xField],
    );
    const toTs = Data.readTime(
      (series.data[toIndex] as Record<string, unknown> | undefined)?.[xField],
    );
    if (fromTs === undefined || toTs === undefined) return null;
    return {
      fromIndex,
      toIndex,
      fromTs,
      toTs,
    };
  }

  function pointToAnchor(
    pt: Action.Point,
    entry: ReturnType<typeof createFakeEntry>,
    options?: {
      projectX?: boolean;
      axisId?: string;
      drawingType?: Drawing.Type;
    },
  ): Drawing.Anchor | null {
    const series = getPrimarySeries(entry.state);
    const coord = entry.coord;
    if (!series || !coord) return null;
    if (!series.data.length) return null;

    const layout = Chart.computeLayout(entry.state.config);
    const idx = xToSeriesIndex(entry.state, series, pt.x, layout);
    const clamped = Math.max(0, Math.min(series.data.length - 1, idx));
    const axis = getAxis(entry.state.config.xAxis, Series.getXAxisId(series));
    const xField = resolveField(series, "x", axis.field || "time");
    const point = series.data[clamped] as Record<string, unknown> | undefined;
    if (!point || point[xField] === undefined) return null;

    const scaleId = options?.axisId ?? coord.defaultYScale;
    const scale = coord.scales.y[scaleId] ?? Object.values(coord.scales.y)[0];
    if (!scale) return null;

    const price = CoordSys.toValue(pt.y, scale);
    const xAt = makeIndexToSeriesX(entry.state, series, layout);
    const outside = pt.x < xAt(0) || pt.x > xAt(series.data.length - 1);
    if (outside && series.data.length < 2) return null;
    const continuous = continuousDrawingTime(options?.drawingType);
    const projectedTime =
      options?.projectX || continuous || outside
        ? projectedTimeForX({
            state: entry.state,
            series,
            x: pt.x,
            layout,
            xField,
          })
        : null;
    if ((continuous || outside) && projectedTime === null) return null;
    return {
      time: projectedTime ?? (point[xField] as Drawing.Anchor["time"]),
      price,
      axisId: scaleId,
    };
  }

  function primarySeriesPaneArea(
    state: Chart.State,
    seriesId: string,
    layout: ReturnType<typeof Chart.computeLayout>,
  ) {
    const paneId =
      ChartStateModel.paneForSeries(state, seriesId)?.id ??
      ChartStateModel.MAIN_PANE_ID;
    const paneRect = paneRectsInLayout(state, layout).find(
      (rect) => rect.id === paneId,
    );
    return {
      x: layout.areaX,
      y: paneRect?.y ?? 0,
      width: layout.areaWidth,
      height: paneRect?.height ?? layout.areaHeight,
    };
  }

  function buildDrawingContext(
    entry: ReturnType<typeof createFakeEntry>,
    options?: { area: "chart" | "primary-pane" },
  ) {
    const coord = entry.coord;
    if (!coord) return null;
    const series = getPrimarySeries(entry.state);
    if (!series) return null;

    const layout = Chart.computeLayout(entry.state.config);
    const visible = getSeriesVisibleRange(entry.state, series, layout);
    // Hoist the loop-invariant axis/length/domain/series-values work out of the
    // per-bar mapping; positioning every visible bar otherwise re-walks every
    // series for every bar.
    const xFn = makeIndexToSeriesX(entry.state, series, layout);

    const xPositions: number[] = [];
    const xFrom = Math.max(0, visible.from - 1);
    const xTo = Math.min(series.data.length, visible.to + 2);
    for (let i = xFrom; i < xTo; i++) xPositions[i] = xFn(i);

    const area =
      options?.area === "primary-pane"
        ? primarySeriesPaneArea(entry.state, series.id, layout)
        : {
            x: layout.areaX,
            y: 0,
            width: layout.areaWidth,
            height: layout.areaHeight,
          };

    return {
      coord,
      xPositions,
      xFn,
      data: series.data,
      visibleRange: visible,
      area,
    };
  }

  function hitEventStrip(
    state: Chart.State,
    entry: ReturnType<typeof createFakeEntry>,
    pt: Action.Point,
    interaction?: Pick<
      Chart.State,
      | "hoveredAnnotationId"
      | "expandedAnnotation"
      | "activeAnnotationId"
      | "hoveredMarkerId"
      | "activeMarkerId"
    >,
  ): MarkerHit | ChartAnnotationHit | null {
    // The event strip only hit-tests chart annotations and earnings markers.
    // When the chart has neither, there is nothing to hit, so
    // skip building the drawing context (an x-position table over every visible
    // bar, plus two `Chart.computeLayout` passes) entirely. This is the
    // dominant per-pointer-move cost on a plain chart with no overlays: it ran
    // unconditionally on every crosshair move just to test empty arrays.
    const hasAnnotations = ChartStateModel.annotationItems(state).some(
      (item) => item.visibility !== "hidden",
    );
    const hasMarkers = (state.markers?.length ?? 0) > 0;
    // An in-progress annotation draft is painted even with no committed
    // annotations (see paint's chartAnnotationsForRender), so keep this guard's
    // "could there be something to hit" predicate aligned with what paint
    // places. Draft *placement* is currently handled upstream in
    // handleAnnotationMove before this runs, so this is defensive, not hot.
    const hasDraft =
      state.annotationCreate !== undefined &&
      state.annotationCreate.phase !== "armed";
    if (!hasAnnotations && !hasMarkers && !hasDraft) {
      return null;
    }

    const chartRender = buildDrawingContext(entry);
    if (!chartRender) return null;
    const markerRender = buildDrawingContext(entry, { area: "primary-pane" });
    const hoveredAnnotationId =
      interaction?.hoveredAnnotationId ?? state.hoveredAnnotationId;
    const activeAnnotationId =
      interaction?.activeAnnotationId ?? state.activeAnnotationId;
    const expandedAnnotation =
      interaction?.expandedAnnotation ?? state.expandedAnnotation;
    const canUsePaintedHitOrder =
      entry.annotationHitPlacements !== undefined &&
      entry.annotationHitPlacementsSignature !== undefined &&
      entry.annotationHitPlacementsSignature?.hoveredAnnotationId ===
        hoveredAnnotationId &&
      entry.annotationHitPlacementsSignature?.activeAnnotationId ===
        activeAnnotationId &&
      entry.annotationHitPlacementsSignature.expandedAnnotation?.id ===
        expandedAnnotation?.id &&
      entry.annotationHitPlacementsSignature.expandedAnnotation?.body ===
        expandedAnnotation?.body;
    const placements = canUsePaintedHitOrder
      ? entry.annotationHitPlacements
      : entry.annotationPlacements
        ? expandChartAnnotationPlacements(
            {
              ctx: entry.ctx,
              textCache: entry.textCache,
              render: chartRender,
              annotations: ChartStateModel.annotationItems(state),
              agentAnnotationIds: state.agentAnnotationIds,
              sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
              expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
              layoutState: entry.annotationLayoutState,
              hoveredAnnotationId,
              expandedAnnotation,
              activeAnnotationId,
            },
            entry.annotationPlacements,
          )
        : null;
    const chartAnnotationHit = placements
      ? hitChartAnnotationPlacements({
          pointer: pt,
          placements,
          hoveredAnnotationId,
          expandedAnnotation,
          activeAnnotationId,
          zSorted: canUsePaintedHitOrder,
        })
      : hitChartAnnotations({
          pointer: pt,
          ctx: entry.ctx,
          textCache: entry.textCache,
          render: chartRender,
          annotations: ChartStateModel.annotationItems(state),
          agentAnnotationIds: state.agentAnnotationIds,
          sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
          expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
          layoutState: entry.annotationLayoutState,
          hoveredAnnotationId,
          expandedAnnotation,
          activeAnnotationId,
        });
    if (chartAnnotationHit) return chartAnnotationHit;
    if (markerRender) {
      const markerStripArea = SpanRenderUtils.eventLaneArea(markerRender);
      const markerHit = hitMarkers({
        pointer: pt,
        render: markerRender,
        stripArea: markerStripArea,
        markers: state.markers ?? [],
        expandedMarkerId:
          interaction?.hoveredMarkerId ??
          interaction?.activeMarkerId ??
          state.hoveredMarkerId ??
          state.activeMarkerId,
      });
      if (markerHit) return markerHit;
    }
    return null;
  }

  function chartAnnotationHitById(
    state: Chart.State,
    entry: ReturnType<typeof createFakeEntry>,
    annotationId: string,
    interaction?: Pick<
      Chart.State,
      "hoveredAnnotationId" | "expandedAnnotation" | "activeAnnotationId"
    >,
  ): ChartAnnotationHit | null {
    const render = buildDrawingContext(entry);
    if (!render) return null;
    const hoveredAnnotationId =
      interaction?.hoveredAnnotationId ?? state.hoveredAnnotationId;
    const activeAnnotationId =
      interaction?.activeAnnotationId ?? state.activeAnnotationId;
    const expandedAnnotation =
      interaction?.expandedAnnotation ?? state.expandedAnnotation;
    const placements = entry.annotationPlacements
      ? expandChartAnnotationPlacements(
          {
            ctx: entry.ctx,
            textCache: entry.textCache,
            render,
            annotations: ChartStateModel.annotationItems(state),
            agentAnnotationIds: state.agentAnnotationIds,
            sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
            expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
            layoutState: entry.annotationLayoutState,
            hoveredAnnotationId,
            expandedAnnotation,
            activeAnnotationId,
          },
          entry.annotationPlacements,
        )
      : layoutChartAnnotations({
          ctx: entry.ctx,
          textCache: entry.textCache,
          render,
          annotations: ChartStateModel.annotationItems(state),
          agentAnnotationIds: state.agentAnnotationIds,
          sourceBadgesByAnnotationId: state.sourceBadgesByAnnotationId,
          expandedCardsByAnnotationId: state.expandedCardsByAnnotationId,
          layoutState: entry.annotationLayoutState,
          hoveredAnnotationId,
          expandedAnnotation,
          activeAnnotationId,
        });
    const placement = placements.find(
      (item) => item.annotation.id === annotationId,
    );
    if (!placement) return null;
    return hitFromPlacement(placement, "body", placement.handles.label);
  }

  function expandedAnnotationHoverGeometrySignature(
    hit: ReturnType<typeof clientChartAnnotationHit>,
  ): string {
    const compact = hit.compactPill;
    return [
      hit.id,
      hit.anchor.x,
      hit.anchor.y,
      hit.pill.x,
      hit.pill.y,
      hit.pill.width,
      hit.pill.height,
      compact?.x ?? "",
      compact?.y ?? "",
      compact?.width ?? "",
      compact?.height ?? "",
      hit.bodyExpanded === true ? 1 : 0,
      hit.bodyTruncated === true ? 1 : 0,
    ].join("|");
  }

  function immediateAnnotationInteraction(
    state: Chart.State,
  ): Pick<
    Chart.State,
    "hoveredAnnotationId" | "expandedAnnotation" | "activeAnnotationId"
  > {
    return {
      hoveredAnnotationId:
        canvasHoveredAnnotationId ?? state.hoveredAnnotationId,
      expandedAnnotation: state.expandedAnnotation,
      activeAnnotationId: state.activeAnnotationId,
    };
  }

  function annotationHitOwnsHover(hit: ChartAnnotationHit): boolean {
    return hit.part === "body" || hit.part === "expand_button";
  }

  function annotationHasSourceBadges(
    state: Chart.State,
    annotation: ChartAnnotation.Renderable,
  ): boolean {
    const badges =
      state.sourceBadgesByAnnotationId?.[annotation.id] ??
      (annotation.eventId
        ? state.sourceBadgesByAnnotationId?.[annotation.eventId]
        : undefined) ??
      annotation.sourceBadges;
    return (badges?.length ?? 0) > 0;
  }

  function annotationIsAgentOwned(
    state: Chart.State,
    annotation: ChartAnnotation.Renderable,
  ): boolean {
    return Boolean(
      annotation.content ??
      state.agentAnnotationIds?.[annotation.id] ??
      (annotation.eventId
        ? state.agentAnnotationIds?.[annotation.eventId]
        : undefined),
    );
  }

  function annotationHasExpandedCard(
    state: Chart.State,
    annotation: ChartAnnotation.Renderable,
  ): boolean {
    return Boolean(
      annotation.content ??
      state.expandedCardsByAnnotationId?.[annotation.id] ??
      (annotation.eventId
        ? state.expandedCardsByAnnotationId?.[annotation.eventId]
        : undefined),
    );
  }

  function expandAnnotationCard(
    id: string,
    hoveredPart: "body" | "expand_button" = "body",
  ): void {
    const rect = canvas.getBoundingClientRect();
    canvasHoveredAnnotationId = id;
    setState((s) => {
      s.activeAnnotationId = id;
      s.hoveredAnnotationId = id;
      s.hoveredAnnotationPart = hoveredPart;
      if (s.expandedAnnotation?.id !== id)
        s.expandedAnnotation = { id, body: "preview" };
      s.activeMarkerId = undefined;
      s.hoveredMarkerId = undefined;
      if (s.drawings) {
        s.drawings.selectedId = undefined;
        s.drawings.contextMenu = undefined;
        s.drawings.configId = undefined;
      }
      s.crosshair.visible = false;
      s.crosshair.paneId = undefined;
      s.crosshair.time = undefined;
    });
    const nextState = getState();
    const nextEntry = createFakeEntry(nextState);
    const nextHit = chartAnnotationHitById(nextState, nextEntry, id, {
      activeAnnotationId: id,
      hoveredAnnotationId: id,
      expandedAnnotation: nextState.expandedAnnotation,
    });
    if (nextHit) {
      const hit = clientChartAnnotationHit(rect, nextHit);
      Bus.publish(ChartEvent.AnnotationHit, { id: nextState.id, hit });
      Bus.publish(ChartEvent.AnnotationHover, { id: nextState.id, hit });
    }
    setCanvasCursor("pointer");
    scheduleRender("light");
  }

  function paneRectsInLayout(
    state: Chart.State,
    layout: ReturnType<typeof Chart.computeLayout>,
  ): Array<{ id: string; index: number; y: number; height: number }> {
    const panes =
      state.panes.length > 0
        ? state.panes
        : [
            {
              id: ChartStateModel.MAIN_PANE_ID,
              index: 0,
              height: layout.areaHeight,
              objectIds: [],
            },
          ];
    return ChartPaneLayout.paneLayouts(panes, layout.areaHeight).map(
      (paneLayout) => ({
        id: paneLayout.pane.id,
        index: paneLayout.pane.index,
        y: paneLayout.top,
        height: paneLayout.height,
      }),
    );
  }

  function axisPaneIdForAxis(state: Chart.State, axis: Axis): string {
    const panes =
      state.panes.length > 0
        ? state.panes
        : [
            {
              id: ChartStateModel.MAIN_PANE_ID,
              index: 0,
              height: 1,
              objectIds: [],
            },
          ];
    const paneIdSet = new Set(panes.map((pane) => pane.id));
    if (axis.paneId && paneIdSet.has(axis.paneId)) return axis.paneId;

    for (const pane of panes) {
      const ids = paneSeriesIds(state, pane.id);
      for (const seriesId of ids) {
        const series = getSeries(state, seriesId);
        if (!series) continue;
        if (Series.getYAxisId(series) === axis.id) return pane.id;
      }
    }
    return ChartStateModel.MAIN_PANE_ID;
  }

  function axisBoundsById(
    state: Chart.State,
    layout: ReturnType<typeof Chart.computeLayout>,
  ): Map<string, { x: number; y: number; width: number; height: number }> {
    const axes = (state.config.yAxis.axes as Axis[]).filter(
      (axis) => axis.visible && axis.fixed !== false,
    );
    const paneRects = paneRectsInLayout(state, layout);
    const paneRectById = new Map<string, { y: number; height: number }>();
    for (const paneRect of paneRects) {
      paneRectById.set(paneRect.id, { y: paneRect.y, height: paneRect.height });
    }

    const leftByPane = new Map<string, Axis[]>();
    const rightByPane = new Map<string, Axis[]>();
    for (const axis of axes) {
      const paneId = axisPaneIdForAxis(state, axis);
      if (axis.side === "left") {
        const list = leftByPane.get(paneId) ?? [];
        list.push(axis);
        leftByPane.set(paneId, list);
      } else {
        const list = rightByPane.get(paneId) ?? [];
        list.push(axis);
        rightByPane.set(paneId, list);
      }
    }

    const axisWidth = state.config.yAxis.width;
    const boundsById = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    for (const [paneId, axesInPane] of leftByPane.entries()) {
      const paneRect = paneRectById.get(paneId) ?? {
        y: 0,
        height: layout.areaHeight,
      };
      for (let slot = 0; slot < axesInPane.length; slot++) {
        const axis = axesInPane[slot]!;
        boundsById.set(axis.id, {
          x: layout.areaX - axisWidth * (slot + 1),
          y: paneRect.y,
          width: axisWidth,
          height: paneRect.height,
        });
      }
    }
    for (const [paneId, axesInPane] of rightByPane.entries()) {
      const paneRect = paneRectById.get(paneId) ?? {
        y: 0,
        height: layout.areaHeight,
      };
      for (let slot = 0; slot < axesInPane.length; slot++) {
        const axis = axesInPane[slot]!;
        boundsById.set(axis.id, {
          x: layout.areaX + layout.areaWidth + axisWidth * slot,
          y: paneRect.y,
          width: axisWidth,
          height: paneRect.height,
        });
      }
    }

    return boundsById;
  }

  function axisAtPoint(
    state: Chart.State,
    layout: ReturnType<typeof Chart.computeLayout>,
    point: Action.Point,
  ): Axis | null {
    if (point.y < 0 || point.y > layout.areaHeight) return null;
    const paneId = paneIdAtY(state, layout, point.y);
    const boundsById = axisBoundsById(state, layout);
    const axes = (state.config.yAxis.axes as Axis[]).filter(
      (axis) => axis.visible && axis.fixed !== false,
    );
    for (const axis of axes) {
      const axisPaneId = axisPaneIdForAxis(state, axis);
      if (axisPaneId !== paneId) continue;
      const bounds = boundsById.get(axis.id);
      if (!bounds) continue;
      if (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      ) {
        return axis;
      }
    }
    return null;
  }

  function paneSeparatorAtPoint(
    state: Chart.State,
    layout: ReturnType<typeof Chart.computeLayout>,
    point: Action.Point,
  ): { topPaneId: string; bottomPaneId: string } | undefined {
    if (state.panes.length <= 1) return undefined;
    if (point.y < 0 || point.y > layout.areaHeight) return undefined;
    const rects = paneRectsInLayout(state, layout);
    for (let i = 0; i < rects.length - 1; i++) {
      const top = rects[i]!;
      const bottom = rects[i + 1]!;
      const boundaryY = top.y + top.height;
      if (Math.abs(point.y - boundaryY) <= PANE_SEPARATOR_HIT_PX) {
        return {
          topPaneId: top.id,
          bottomPaneId: bottom.id,
        };
      }
    }
    return undefined;
  }

  function paneIdAtY(
    state: Chart.State,
    layout: ReturnType<typeof Chart.computeLayout>,
    y: number,
  ): string {
    const rects = paneRectsInLayout(state, layout);
    for (const pane of rects) {
      if (y >= pane.y && y <= pane.y + pane.height) {
        return pane.id;
      }
    }
    return rects[0]?.id ?? ChartStateModel.MAIN_PANE_ID;
  }

  function paneSeriesIds(state: Chart.State, paneId: string): string[] {
    const pane = state.panes.find((item) => item.id === paneId);
    if (!pane) return [];
    const idsFromObjects = (pane.objectIds ?? [])
      .map((objectId) => {
        const object = state.objects?.[objectId] as
          { kind?: string; seriesId?: string } | undefined;
        return object?.kind === "series" ? object.seriesId : undefined;
      })
      .filter((id): id is string => !!id);
    return idsFromObjects;
  }

  function focusedSeriesAtPoint(
    state: Chart.State,
    paneId: string,
    point: Action.Point,
    layout: ReturnType<typeof Chart.computeLayout>,
    coord?: import("@openchart/chart-core/coord").CoordSys.State,
  ): string | undefined {
    const ids = paneSeriesIds(state, paneId);
    if (ids.length === 0) return undefined;
    const candidates = ids
      .map((id) => getSeries(state, id))
      .filter(
        (series): series is Series.State =>
          !!series && (series.options.visible ?? true) !== false,
      )
      .filter((series) => !series.parentId && series.type !== "Histogram");
    if (candidates.length === 0) return undefined;

    let bestId: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const series of candidates) {
      const distance = distanceToSeriesAtPoint(
        state,
        series,
        point,
        layout,
        coord,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = series.id;
      }
    }

    if (bestDistance <= 30) return bestId;
    return undefined;
  }

  const SERIES_HIT_PX = 30;

  function nearestSeriesAtPoint(
    state: Chart.State,
    point: Action.Point,
    layout: ReturnType<typeof Chart.computeLayout>,
    coord?: import("@openchart/chart-core/coord").CoordSys.State,
  ): string | undefined {
    const paneId = paneIdAtY(state, layout, point.y);
    const ids = paneSeriesIds(state, paneId);
    if (ids.length === 0) return undefined;
    const candidates = ids
      .map((id) => getSeries(state, id))
      .filter(
        (series): series is Series.State =>
          !!series && (series.options.visible ?? true) !== false,
      )
      .filter((series) => !series.parentId && series.type !== "Histogram");
    if (candidates.length === 0) return undefined;

    let bestId: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const series of candidates) {
      const distance = distanceToSeriesAtPoint(
        state,
        series,
        point,
        layout,
        coord,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = series.id;
      }
    }

    return bestDistance <= SERIES_HIT_PX ? bestId : undefined;
  }

  function distanceToSeriesAtPoint(
    state: Chart.State,
    series: Series.State,
    point: Action.Point,
    layout: ReturnType<typeof Chart.computeLayout>,
    coord?: import("@openchart/chart-core/coord").CoordSys.State,
  ): number {
    if (!series.data.length) return Number.POSITIVE_INFINITY;
    const index =
      xToSeriesIndex(state, series, point.x, layout) -
      Number(series.options.xOffset ?? 0);
    if (index < 0 || index >= series.data.length)
      return Number.POSITIVE_INFINITY;

    const item = series.data[index] as Record<string, unknown> | undefined;
    if (!item) return Number.POSITIVE_INFINITY;

    const axis = (state.config.yAxis.axes as Axis[]).find(
      (a) => a.id === Series.getYAxisId(series),
    );
    const yScale =
      coord?.scales.y[axis?.id ?? "right"] ?? coord?.scales.y.right;
    if (!yScale) return Number.POSITIVE_INFINITY;
    const needsModeTransform =
      axis?.mode === "percentage" || axis?.mode === "indexed";
    const axisForBaseline =
      axis && state.comparison?.enabled && state.comparison.axisId === axis.id
        ? axis
        : axis && axis.modeAnchor
          ? ({ ...axis, modeAnchor: undefined } as typeof axis)
          : axis;
    const baseline = needsModeTransform
      ? modeBaseline(
          series,
          getSeriesVisibleRange(state, series, layout),
          axisForBaseline,
        )
      : undefined;
    const toScaledValue = (value: number) =>
      baseline !== undefined
        ? modeTransformValue(axis, value, baseline)
        : value;

    if (series.type === "Candlestick" || series.type === "Bar") {
      const high = readNumber(item, series, "high", "high");
      const low = readNumber(item, series, "low", "low");
      if (high !== undefined && low !== undefined) {
        const highY = CoordSys.toPixel(toScaledValue(high), yScale);
        const lowY = CoordSys.toPixel(toScaledValue(low), yScale);
        const top = Math.min(highY, lowY);
        const bottom = Math.max(highY, lowY);
        if (point.y >= top && point.y <= bottom) return 0;
        return Math.min(Math.abs(point.y - top), Math.abs(point.y - bottom));
      }
    }

    const value =
      readNumber(item, series, "close", "close") ??
      readNumber(item, series, "value", "value") ??
      readNumber(item, series, "high", "high") ??
      readNumber(item, series, "low", "low");
    if (value === undefined) return Number.POSITIVE_INFINITY;

    const y = CoordSys.toPixel(toScaledValue(value), yScale);
    return Math.abs(y - point.y);
  }

  function resolveFocusedSeriesId(
    state: Chart.State,
    hoveredSeriesId?: string,
  ): string | undefined {
    return state.lockedSeriesId ?? hoveredSeriesId;
  }

  function updateDraftAnchor(
    state: Chart.State,
    tool: Drawing.Type,
    startAnchor: Drawing.Anchor,
    current: Drawing.Anchor,
  ) {
    const drawings = state.drawings;
    const existing = drawings.draft;
    const count = Drawing.requiredAnchors(tool);
    const anchors = count === 1 ? [current] : [startAnchor, current];
    const baseOptions = {
      id: existing?.id,
      style: existing?.style,
      locked: existing?.locked,
      hidden: existing?.hidden,
    };
    const options =
      tool === "text"
        ? {
            ...baseOptions,
            text: (existing as Drawing.TextItem | undefined)?.text,
          }
        : baseOptions;
    drawings.draft = Drawing.create(tool, anchors, options);
  }

  function updateDraftMulti(
    state: Chart.State,
    tool: Drawing.Type,
    anchors: Drawing.Anchor[],
    preview: Drawing.Anchor,
    defaultColor?: string,
    required: number = Drawing.requiredAnchors(tool),
  ) {
    const drawings = state.drawings;
    const existing = drawings.draft;
    let nextAnchors: Drawing.Anchor[] = anchors;
    if (required === 2) {
      if (anchors.length === 1) {
        nextAnchors = [anchors[0]!, preview];
      } else if (anchors.length >= 2) {
        nextAnchors = [anchors[0]!, anchors[1]!];
      }
    } else {
      if (anchors.length === 1) {
        nextAnchors = [anchors[0]!, preview, preview];
      } else if (anchors.length === 2) {
        nextAnchors = [anchors[0]!, anchors[1]!, preview];
      }
    }
    const baseStyle =
      existing?.style ??
      (defaultColor
        ? {
            lineColor: defaultColor,
            textColor: defaultColor,
          }
        : undefined);
    const baseOptions = {
      id: existing?.id,
      style: baseStyle,
      locked: existing?.locked,
      hidden: existing?.hidden,
    };
    const options =
      tool === "text"
        ? {
            ...baseOptions,
            text: (existing as Drawing.TextItem | undefined)?.text,
          }
        : baseOptions;
    drawings.draft = Drawing.create(tool, nextAnchors, options);
  }

  function updateFreehandDraft(
    state: Chart.State,
    anchors: Drawing.Anchor[],
    defaultColor?: string,
  ) {
    const drawings = state.drawings;
    const existing = drawings.draft;
    drawings.draft = Drawing.create("freehand", anchors, {
      id: existing?.id,
      style:
        existing?.style ??
        (defaultColor
          ? {
              lineColor: defaultColor,
              textColor: defaultColor,
            }
          : undefined),
      locked: existing?.locked,
      hidden: existing?.hidden,
    });
  }

  function finalizeDraft(
    state: Chart.State,
    tool: Drawing.Type,
    anchors: Drawing.Anchor[],
  ): boolean {
    const drawings = state.drawings;
    const existing = drawings.draft;
    const baseOptions = {
      id: existing?.id,
      style: existing?.style,
      locked: existing?.locked,
      hidden: existing?.hidden,
    };
    const options =
      tool === "text"
        ? {
            ...baseOptions,
            text: (existing as Drawing.TextItem | undefined)?.text,
          }
        : baseOptions;
    const item = Drawing.create(tool, anchors, options);
    addDrawing(state, item);
    drawings.selectedId = item.id;
    drawings.draft = undefined;
    drawings.contextMenu = undefined;
    if (!drawings.toolLocked) {
      drawings.activeTool = null;
      return true;
    }
    return false;
  }

  function updateDrawingAnchor(
    state: Chart.State,
    id: string,
    index: number,
    anchor: Drawing.Anchor,
  ) {
    const items = drawingItems(state);
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) return;
    const item = items[idx]!;
    const anchors = [...item.anchors];
    anchors[index] = anchor;
    updateDrawing(state, id, () =>
      Drawing.create(item.type, anchors, { ...item }),
    );
  }

  function translateDrawing(
    state: Chart.State,
    id: string,
    startPoint: Action.Point,
    current: Action.Point,
    startAnchors: Drawing.Anchor[],
    entry: ReturnType<typeof createFakeEntry>,
  ) {
    const items = drawingItems(state);
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) return;
    const item = items[idx]!;
    const context = buildDrawingContext(entry);
    if (!context) return;

    // Translate the geometry we painted, including future anchors, through the
    // same inverse as creation/handle dragging. Never clamp each anchor to an edge bar.
    const nextAnchors: Drawing.Anchor[] = [];
    for (const anchor of startAnchors) {
      const point = DrawingRenderUtils.anchorToPoint(
        anchor,
        context,
        item.type,
      );
      if (!point) return;
      const moved = pointToAnchor(
        {
          x: point.x + current.x - startPoint.x,
          y: point.y + current.y - startPoint.y,
        },
        entry,
        { axisId: anchor.axisId, drawingType: item.type },
      );
      if (!moved) return;
      nextAnchors.push({
        ...anchor,
        time: moved.time,
        price: moved.price,
      });
    }

    updateDrawing(state, id, () =>
      Drawing.create(item.type, nextAnchors, { ...item }),
    );
  }

  function handleDrag(e: MouseEvent) {
    const state = getState();
    ChartStateModel.assertModelReady(state);
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);

    if (paneResizeDrag) {
      const next = ChartPaneLayout.resizeAdjacentPaneHeights({
        topPaneId: paneResizeDrag.topPaneId,
        bottomPaneId: paneResizeDrag.bottomPaneId,
        startY: paneResizeDrag.startY,
        currentY: pt.y,
        topStartHeight: paneResizeDrag.topStartHeight,
        bottomStartHeight: paneResizeDrag.bottomStartHeight,
        totalStartHeight: paneResizeDrag.totalStartHeight,
        layoutAreaStartHeight: paneResizeDrag.layoutAreaStartHeight,
      });
      let changed = false;
      setState((s) => {
        const topPane = s.panes.find(
          (pane) => pane.id === paneResizeDrag?.topPaneId,
        );
        const bottomPane = s.panes.find(
          (pane) => pane.id === paneResizeDrag?.bottomPaneId,
        );
        if (!topPane || !bottomPane) return;
        if (
          Math.abs(topPane.height - next.topHeight) < 0.5 &&
          Math.abs(bottomPane.height - next.bottomHeight) < 0.5
        ) {
          return;
        }
        topPane.height = next.topHeight;
        bottomPane.height = next.bottomHeight;
        changed = true;
      });
      if (changed) scheduleRender("full");
      return;
    }

    if (!drag) return;
    if (!dragActivated) {
      const dx = Math.abs(pt.x - drag.start.x);
      const dy = Math.abs(pt.y - drag.start.y);
      if (dx < 1 && dy < 1) return;
      dragActivated = true;
    }

    const chartConfig = state.config;

    drag = Drag.update(drag, pt);

    if (drag.region.type === "yscale") {
      const axisId = drag.region.scale;
      const axes = chartConfig.yAxis.axes as Axis[];
      const axis = axes.find((a) => a.id === axisId);
      if (!axis || !drag.extent || axis.autoScale) return;

      const timeAxisHeight = chartConfig.xAxis.visible
        ? chartConfig.xAxis.height
        : 0;
      const chartHeight = chartConfig.chart.dimensions.height - timeAxisHeight;

      const action = Action.drag(drag.region, pt, drag.start, drag.mods);
      const ctx: Mapping.Context = {
        config: Mapping.defaults,
        height: chartHeight,
        locked: axis.lockZero,
        start: { y: drag.start.y, extent: drag.extent },
      };
      const cmds = Mapping.map(action, ctx);
      let nextExtent: { min: number; max: number } | undefined;

      for (const cmd of cmds) {
        if (cmd.effect === "zoomY") {
          const update = Effect.zoomY(drag.extent, cmd.factor, axis.lockZero);
          if (update.extent) {
            nextExtent = update.extent;
          }
        }
        if (cmd.effect === "translateY") {
          const update = Effect.translateY(
            drag.extent,
            cmd.dy,
            chartHeight,
            axis.lockZero,
          );
          if (update.extent) {
            nextExtent = update.extent;
          }
        }
      }
      if (!nextExtent) return;
      let changed = false;
      setState((s) => {
        const nextAxes = s.config.yAxis.axes as Axis[];
        const idx = nextAxes.findIndex((a) => a.id === axisId);
        if (idx < 0) return;
        const currentAxis = nextAxes[idx]!;
        const currentExtent = currentAxis.visibleExtent;
        if (
          currentExtent &&
          currentExtent.min === nextExtent!.min &&
          currentExtent.max === nextExtent!.max
        ) {
          return;
        }
        nextAxes[idx] = { ...currentAxis, visibleExtent: nextExtent! };
        changed = true;
      });
      if (changed) scheduleRender("full");
      return;
    }

    if (
      drag.region.type === "canvas" &&
      chartConfig.interaction.toggles.scroll
    ) {
      const action = Action.drag(drag.region, pt, drag.start, drag.mods);
      const cmds = Mapping.map(action, { config: Mapping.defaults });
      const activeXAxis = getActiveXAxis(state);
      const layout = Chart.computeLayout(chartConfig);

      const timeAxisHeight = chartConfig.xAxis.visible
        ? chartConfig.xAxis.height
        : 0;
      const chartHeight = chartConfig.chart.dimensions.height - timeAxisHeight;
      const nextExtents = new Map<string, { min: number; max: number }>();
      let nextRightOffset: number | undefined;
      let nextLinearDomain:
        { min: number; max: number; minSpan: number } | undefined;

      for (const cmd of cmds) {
        if (cmd.effect === "translateX" && drag.offset !== undefined) {
          if (activeXAxis.mode === "ordinal") {
            const update = Effect.translateX(drag.offset, cmd.dx);
            if (update.offset !== undefined) {
              nextRightOffset = update.offset;
            }
          } else {
            const baseDomain =
              drag.domain ??
              (() => {
                const bound = axisSeries(seriesValues(state), activeXAxis.id);
                return deriveLinearDomain(activeXAxis, bound);
              })();
            const span = Math.max(
              baseDomain.max - baseDomain.min,
              baseDomain.minSpan,
            );
            const delta = (cmd.dx / Math.max(1, layout.areaWidth)) * span;
            nextLinearDomain = {
              min: baseDomain.min - delta,
              max: baseDomain.max - delta,
              minSpan: baseDomain.minSpan,
            };
          }
        }
        if (cmd.effect === "translateY" && drag.extents) {
          const axes = chartConfig.yAxis.axes as Axis[];
          const targets = cmd.scale
            ? axes.filter((a) => a.id === cmd.scale && !a.autoScale)
            : axes.filter((a) => a.visible && !a.lockZero && !a.autoScale);

          for (const axis of targets) {
            const initial = drag.extents[axis.id];
            if (!initial) continue;
            const update = Effect.translateY(
              initial,
              cmd.dy,
              chartHeight,
              axis.lockZero,
            );
            if (update.extent) {
              nextExtents.set(axis.id, update.extent);
            }
          }
        }
      }
      let changed = false;
      setState((s) => {
        if (nextRightOffset !== undefined && activeXAxis.mode === "ordinal") {
          const axis = getAxis(s.config.xAxis, activeXAxis.id);
          if (axis.spacing.rightOffset !== nextRightOffset) {
            setAxisSpacing(s.config.xAxis, activeXAxis.id, {
              rightOffset: nextRightOffset,
            });
            changed = true;
          }
        }

        if (nextLinearDomain && activeXAxis.mode !== "ordinal") {
          const axis = getAxis(s.config.xAxis, activeXAxis.id);
          const currentDomain =
            axis.domain ??
            (() => {
              const bound = axisSeries(seriesValues(s), axis.id);
              return deriveLinearDomain(axis, bound);
            })();
          if (
            currentDomain.min !== nextLinearDomain.min ||
            currentDomain.max !== nextLinearDomain.max ||
            currentDomain.minSpan !== nextLinearDomain.minSpan
          ) {
            setAxisDomain(s.config.xAxis, axis.id, nextLinearDomain);
            changed = true;
          }
        }

        if (nextExtents.size > 0) {
          const stateAxes = s.config.yAxis.axes as Axis[];
          for (const [axisId, extent] of nextExtents.entries()) {
            const idx = stateAxes.findIndex((a) => a.id === axisId);
            if (idx < 0) continue;
            const currentAxis = stateAxes[idx]!;
            const currentExtent = currentAxis.visibleExtent;
            if (
              currentExtent &&
              currentExtent.min === extent.min &&
              currentExtent.max === extent.max
            ) {
              continue;
            }
            stateAxes[idx] = { ...currentAxis, visibleExtent: extent };
            changed = true;
          }
        }
      });
      if (changed) scheduleRender("full");
    }
  }

  function handleDrawingMove(e: MouseEvent): boolean {
    const drag = drawingDrag;
    if (!drag) return false;

    const entry = createFakeEntry();
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    if (drag.mode === "handle" || drag.mode === "body") {
      setCanvasCursor("grabbing");
    } else {
      setCanvasCursor(getDrawCursor());
    }

    if (drag.mode === "draft") {
      const anchor = pointToAnchor(pt, entry, { drawingType: drag.tool });
      if (!anchor) return true;
      setState((s) =>
        updateDraftAnchor(s, drag.tool, drag.startAnchor, anchor),
      );
      scheduleRender("light");
      return true;
    }

    if (drag.mode === "draft_multi") {
      const anchor = pointToAnchor(pt, entry, { drawingType: drag.tool });
      if (!anchor) return true;
      setState((s) => updateDraftMulti(s, drag.tool, drag.anchors, anchor));
      scheduleRender("light");
      return true;
    }

    if (drag.mode === "freehand") {
      const dx = pt.x - drag.lastPoint.x;
      const dy = pt.y - drag.lastPoint.y;
      if (Math.hypot(dx, dy) < 3) return true;
      const anchor = pointToAnchor(pt, entry, { drawingType: "freehand" });
      if (!anchor) return true;
      const nextAnchors = [...drag.anchors, anchor];
      drawingDrag = {
        mode: "freehand",
        anchors: nextAnchors,
        lastPoint: pt,
      };
      setState((s) => updateFreehandDraft(s, nextAnchors));
      scheduleRender("light");
      return true;
    }

    if (drag.mode === "handle") {
      const item = drawingItems(entry.state).find(
        (item) => item.id === drag.id,
      );
      const anchor = pointToAnchor(pt, entry, { drawingType: item?.type });
      if (!anchor) return true;
      setState((s) =>
        updateDrawingAnchor(s, drag.id, drag.handleIndex, anchor),
      );
      scheduleRender("light");
      return true;
    }

    if (drag.mode === "body") {
      setState((s) =>
        translateDrawing(
          s,
          drag.id,
          drag.startPoint,
          pt,
          drag.startAnchors,
          entry,
        ),
      );
      scheduleRender("light");
      return true;
    }

    return false;
  }

  function beginAnnotationInteraction(
    annotationHit: ChartAnnotationHit,
    pt: Action.Point,
  ): void {
    const state = getState();
    const rect = canvas.getBoundingClientRect();
    const ownsHover = annotationHitOwnsHover(annotationHit);
    canvasHoveredAnnotationId = ownsHover ? annotationHit.id : undefined;
    const pointerOffset =
      annotationHit.kind === "chart_annotation" &&
      (annotationHit.part === "body" ||
        annotationHit.part === "label_handle") &&
      annotationHit.dragAnchor
        ? {
            x: annotationHit.dragAnchor.x - pt.x,
            y: annotationHit.dragAnchor.y - pt.y,
          }
        : undefined;
    const hitAnnotation = annotationRecord(state, annotationHit.id);
    const drawing = drawingItems(state).find(
      (item) => item.id === annotationHit.id,
    );
    const movable =
      !drawing?.locked &&
      (drawing?.type !== "annotation" ||
        annotationHit.part !== "target_handle");
    annotationHandleDrag = {
      id: annotationHit.id,
      handle:
        annotationHit.part === "target_handle" ? "targetAnchor" : "labelAnchor",
      pointerOffset,
      startPoint: pt,
      movable,
      expandOnClick:
        annotationHit.part === "body" &&
        Boolean(
          hitAnnotation && annotationHasExpandedCard(state, hitAnnotation),
        ),
      moved: false,
    };
    setState((s) => {
      s.activeAnnotationId = annotationHit.id;
      s.hoveredAnnotationId = ownsHover ? annotationHit.id : undefined;
      s.hoveredAnnotationPart = ownsHover ? annotationHit.part : undefined;
      s.activeMarkerId = undefined;
      s.hoveredMarkerId = undefined;
      if (s.drawings) {
        s.drawings.selectedId = undefined;
        s.drawings.contextMenu = undefined;
        s.drawings.configId = undefined;
      }
      s.crosshair.visible = false;
      s.crosshair.paneId = undefined;
      s.crosshair.time = undefined;
    });
    const nextState = getState();
    const nextEntry = createFakeEntry(nextState);
    const nextHit = chartAnnotationHitById(
      nextState,
      nextEntry,
      annotationHit.id,
      {
        activeAnnotationId: annotationHit.id,
        hoveredAnnotationId: ownsHover ? annotationHit.id : undefined,
        expandedAnnotation:
          nextState.expandedAnnotation?.id === annotationHit.id
            ? nextState.expandedAnnotation
            : undefined,
      },
    );
    if (nextHit) {
      Bus.publish(ChartEvent.AnnotationHit, {
        id: nextState.id,
        hit: clientChartAnnotationHit(rect, nextHit),
      });
    }
    window.addEventListener("mousemove", handleAnnotationWindowMove);
    window.addEventListener("mouseup", endAnnotationDrag);
    setCanvasCursor(movable ? "grabbing" : "pointer");
    scheduleRender("light");
  }

  function handleAnnotationMove(e: MouseEvent): boolean {
    const state = getState();
    const draft = state.annotationCreate;
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    const entry = createFakeEntry(state);

    if (draft?.phase === "placing") {
      const anchor = pointToAnchor(pt, entry, { projectX: true });
      if (!anchor) return true;
      canvasHoveredAnnotationId = undefined;
      setState((s) => {
        const current = s.annotationCreate;
        if (!current || current.phase !== "placing") return;
        s.annotationCreate = {
          ...current,
          anchor: { ...current.anchor, labelAnchor: anchor },
          clientAnchor: clientAnchor(rect, pt),
        };
        s.activeAnnotationId = current.id;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.crosshair.visible = false;
        s.crosshair.paneId = undefined;
        s.crosshair.time = undefined;
      });
      setCanvasCursor("crosshair");
      scheduleRender("light");
      return true;
    }

    if (!annotationHandleDrag) return false;
    if (
      !annotationHandleDrag.moved &&
      Math.hypot(
        pt.x - annotationHandleDrag.startPoint.x,
        pt.y - annotationHandleDrag.startPoint.y,
      ) < 3
    )
      return true;
    annotationHandleDrag.moved = true;
    if (!annotationHandleDrag.movable) return true;
    const dragPoint = annotationHandleDrag.pointerOffset
      ? {
          x: pt.x + annotationHandleDrag.pointerOffset.x,
          y: pt.y + annotationHandleDrag.pointerOffset.y,
        }
      : pt;
    const anchor = pointToAnchor(dragPoint, entry, {
      projectX: annotationHandleDrag.handle === "labelAnchor",
    });
    if (!anchor) return true;
    const { id, handle } = annotationHandleDrag;
    const current = annotationRecord(state, id);
    if (!current) {
      annotationHandleDrag.moved = true;
      return true;
    }
    const nextAnchor = annotationAnchorWithChartPoint(
      current.anchor,
      handle,
      anchor,
      {
        preserveTargetTime:
          handle === "targetAnchor" &&
          (annotationIsAgentOwned(state, current) ||
            annotationHasSourceBadges(state, current)),
      },
    );
    annotationHandleDrag.moved = true;
    annotationHandleDrag.previewAnchor = nextAnchor;
    getRuntime().annotationDragPreview = { id, anchor: nextAnchor };
    canvasHoveredAnnotationId = handle === "labelAnchor" ? id : undefined;
    if (
      state.activeAnnotationId !== id ||
      state.hoveredAnnotationId !==
        (handle === "labelAnchor" ? id : undefined) ||
      (state.expandedAnnotation !== undefined &&
        state.expandedAnnotation.id !== id) ||
      state.crosshair.visible ||
      state.crosshair.paneId !== undefined ||
      state.crosshair.time !== undefined
    ) {
      setState((s) => {
        s.activeAnnotationId = id;
        s.hoveredAnnotationId = handle === "labelAnchor" ? id : undefined;
        s.hoveredAnnotationPart =
          handle === "labelAnchor" ? "label_handle" : undefined;
        if (s.expandedAnnotation?.id !== id) s.expandedAnnotation = undefined;
        s.crosshair.visible = false;
        s.crosshair.paneId = undefined;
        s.crosshair.time = undefined;
      });
    }
    const nextHit = chartAnnotationHitById(state, entry, id, {
      activeAnnotationId: id,
      hoveredAnnotationId: handle === "labelAnchor" ? id : undefined,
      expandedAnnotation:
        state.expandedAnnotation?.id === id
          ? state.expandedAnnotation
          : undefined,
    });
    if (nextHit) {
      Bus.publish(ChartEvent.AnnotationHover, {
        id: state.id,
        hit: clientChartAnnotationHit(rect, nextHit),
      });
    }
    setCanvasCursor("grabbing");
    scheduleRender("light");
    return true;
  }

  function endAnnotationDrag() {
    if (!annotationHandleDrag) return;
    const state = getState();
    const { id, moved, expandOnClick } = annotationHandleDrag;
    const anchor = annotationHandleDrag.previewAnchor;
    if (moved && anchor) {
      const drawing = drawingItems(state).find((item) => item.id === id);
      if (drawing?.type === "annotation" && !drawing.locked) {
        setState((s) =>
          updateDrawing(s, id, (item) =>
            item.type === "annotation"
              ? { ...item, labelAnchor: anchor.labelAnchor }
              : item,
          ),
        );
      } else if (!drawing) {
        const record = state.annotations.find((item) => item.id === id);
        if (record)
          config.onUpdateChartAnnotation?.(state, id, {
            anchor,
            revision: record.revision,
          });
      }
    }
    releaseAnnotationDrag();
    if (!moved && expandOnClick) {
      expandAnnotationCard(id);
      return;
    }
    setCanvasCursor("default");
    scheduleRender("light");
  }

  function releaseAnnotationDrag() {
    getRuntime().annotationDragPreview = undefined;
    annotationHandleDrag = null;
    window.removeEventListener("mousemove", handleAnnotationWindowMove);
    window.removeEventListener("mouseup", endAnnotationDrag);
    setCanvasCursor("default");
  }

  function handleAnnotationWindowMove(e: MouseEvent) {
    handleAnnotationMove(e);
  }

  function endDrawing() {
    if (!drawingDrag) return;

    if (drawingDrag.mode === "freehand") {
      const anchors = drawingDrag.anchors;
      let autoCleared = false;
      setState((s) => {
        const drawings = s.drawings;
        if (anchors.length >= Drawing.requiredAnchors("freehand")) {
          autoCleared = finalizeDraft(s, "freehand", anchors);
        } else {
          drawings.draft = undefined;
        }
      });
      if (autoCleared) onDrawingToolAutoClear?.();
      suppressNextClick = true;
      scheduleRender("light");
    }

    if (drawingDrag.mode === "draft") {
      const tool = drawingDrag.tool;
      let autoCleared = false;
      setState((s) => {
        const drawings = s.drawings;
        const draft = drawings.draft;
        if (!draft) return;
        const required = Drawing.requiredAnchors(tool);
        if (draft.anchors.length >= required) {
          autoCleared = finalizeDraft(s, tool, draft.anchors);
        } else {
          drawings.draft = undefined;
        }
      });
      if (autoCleared) onDrawingToolAutoClear?.();
      scheduleRender("light");
    }

    drawingDrag = null;
    setCanvasCursor("default");
    window.removeEventListener("mouseup", endDrawing);
  }

  function releaseChartExplainDrag() {
    chartExplainDrag = null;
    window.removeEventListener("mousemove", handleChartExplainDrag);
    window.removeEventListener("mouseup", endChartExplainDrag);
    setCanvasCursor("default");
  }

  function cancelChartExplainDrag() {
    releaseChartExplainDrag();
    setState((s) => {
      delete s.chartExplain?.draftBand;
    });
    scheduleRender("light");
  }

  function handleChartExplainDrag(e: MouseEvent) {
    if (!chartExplainDrag) return;
    if (getState().drawings.activeTool !== "agent_session") {
      cancelChartExplainDrag();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const current = Input.point(e, rect);
    chartExplainDrag = { ...chartExplainDrag, current };
    canvasHoveredAnnotationId = undefined;
    setState((s) => {
      s.chartExplain ??= {};
      s.chartExplain.draftBand = {
        xStart: chartExplainDrag!.start.x,
        xEnd: current.x,
        color: chartExplainDrag!.color,
        translucent: true,
        mode: "dragging",
      };
      s.hoveredMarkerId = undefined;
      s.hoveredAnnotationId = undefined;
      s.hoveredAnnotationPart = undefined;
      s.expandedAnnotation = undefined;
      s.crosshair.visible = false;
    });
    scheduleRender("light");
  }

  function endChartExplainDrag(e: MouseEvent) {
    if (!chartExplainDrag) return;
    if (getState().drawings.activeTool !== "agent_session") {
      cancelChartExplainDrag();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const end = Input.point(e, rect);
    const start = chartExplainDrag.start;
    const state = getState();
    const selection = resolveChartExplainSelection(state, start, end);
    const hasSelection = selection !== null && Math.abs(end.x - start.x) >= 4;
    const color = chartExplainDrag.color;
    const mode = chartExplainDrag.mode;
    releaseChartExplainDrag();
    let autoCleared = false;
    setState((s) => {
      s.chartExplain ??= {};
      if (
        hasSelection &&
        s.drawings.activeTool === "agent_session" &&
        !s.drawings.toolLocked
      ) {
        s.drawings.activeTool = null;
        autoCleared = true;
      }
      s.chartExplain.draftBand = hasSelection
        ? {
            xStart: start.x,
            xEnd: end.x,
            tStart: selection.fromTs,
            tEnd: selection.toTs,
            color,
            translucent: true,
            mode: "annotating",
            startedAtMs:
              typeof performance !== "undefined"
                ? performance.now()
                : Date.now(),
          }
        : undefined;
    });
    if (hasSelection) {
      Bus.publish(ChartEvent.ChartExplainRange, {
        id: state.id,
        selection,
        mode,
        color,
        anchor: { x: end.x, y: end.y },
      });
    }
    if (autoCleared) onDrawingToolAutoClear?.();
    scheduleRender("light");
  }

  function endDrag() {
    if (!drag && !paneResizeDrag) return;
    drag = null;
    dragActivated = false;
    paneResizeDrag = null;
    window.removeEventListener("mousemove", handleDrag);
    window.removeEventListener("mouseup", endDrag);
    setCanvasCursor("default");
  }

  const onMouseMove = (e: MouseEvent) => {
    if (chartExplainDrag) return handleChartExplainDrag(e);
    if (handleAnnotationMove(e)) return;
    if (handleDrawingMove(e)) return;
    if (drag || paneResizeDrag) return handleDrag(e);

    const state = getState();
    ChartStateModel.assertModelReady(state);
    const entry = createFakeEntry(state);
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    const layout = Chart.computeLayout(state.config);

    if (
      state.drawings.activeTool === "agent_session" ||
      state.annotationCreate?.phase === "armed"
    ) {
      if (
        state.hoveredMarkerId ||
        state.hoveredAnnotationId ||
        state.hoveredAnnotationPart ||
        state.expandedAnnotation
      ) {
        canvasHoveredAnnotationId = undefined;
        setState((s) => {
          s.hoveredMarkerId = undefined;
          s.hoveredAnnotationId = undefined;
          s.hoveredAnnotationPart = undefined;
          s.expandedAnnotation = undefined;
          s.crosshair.visible = false;
        });
        scheduleRender("light");
      }
      setCanvasCursor("crosshair");
      return;
    }

    let drawingHit: ReturnType<typeof hitTestDrawings> = null;
    const drawings = state.drawings;
    const hasDrawableItems =
      !!drawings && (drawingItems(state).length > 0 || !!drawings.draft);
    if (hasDrawableItems) {
      const drawingContext = buildDrawingContext(entry);
      if (drawingContext) {
        drawingHit = hitTestDrawings(
          drawingState(state),
          { ...drawingContext, mouse: pt },
          entry.ctx,
        );
        const prevDrawingHover = state.drawings?.hoveredId;
        if (drawingHit?.id !== prevDrawingHover) {
          setState((s) => {
            const nextDrawings = s.drawings;
            nextDrawings.hoveredId = drawingHit?.id;
          });
          scheduleRender("light");
        }
      }
    }

    const annotationHit =
      !drawingHit && !drawings?.activeTool
        ? hitEventStrip(state, entry, pt, immediateAnnotationInteraction(state))
        : null;
    if (annotationHit) {
      const nextMarkerId =
        annotationHit.kind === "marker" ? annotationHit.id : undefined;
      const nextAnnotationId =
        annotationHit.kind === "chart_annotation"
          ? annotationHitOwnsHover(annotationHit)
            ? annotationHit.id
            : undefined
          : undefined;
      const nextAnnotationPart =
        annotationHit.kind === "chart_annotation" &&
        annotationHitOwnsHover(annotationHit)
          ? annotationHit.part
          : undefined;
      const nextExpandedAnnotation =
        annotationHit.kind === "chart_annotation" &&
        state.expandedAnnotation?.id === annotationHit.id
          ? state.expandedAnnotation
          : undefined;
      canvasHoveredAnnotationId = nextAnnotationId;
      const changed =
        state.hoveredMarkerId !== nextMarkerId ||
        state.hoveredAnnotationId !== nextAnnotationId ||
        state.hoveredAnnotationPart !== nextAnnotationPart ||
        state.expandedAnnotation !== nextExpandedAnnotation ||
        state.crosshair.visible ||
        state.crosshair.paneId !== undefined ||
        state.crosshair.time !== undefined;
      if (changed) {
        setState((s) => {
          s.hoveredMarkerId = nextMarkerId;
          s.hoveredAnnotationId = nextAnnotationId;
          s.hoveredAnnotationPart = nextAnnotationPart;
          s.expandedAnnotation = nextExpandedAnnotation;
          s.crosshair.visible = false;
          s.crosshair.paneId = undefined;
          s.crosshair.time = undefined;
          s.hoveredSeriesId = undefined;
          s.focusedSeriesId = s.lockedSeriesId;
        });
        scheduleRender("light");
      }
      const hoverHit =
        annotationHit.kind === "chart_annotation" &&
        annotationHitOwnsHover(annotationHit)
          ? (hitEventStrip(state, entry, pt, {
              hoveredAnnotationId: annotationHit.id,
              expandedAnnotation: nextExpandedAnnotation,
            }) ?? annotationHit)
          : annotationHit;
      Bus.publish(ChartEvent.AnnotationHover, {
        id: state.id,
        hit: clientAnnotationHit(rect, hoverHit),
      });
      setCanvasCursor("pointer");
      return;
    }

    if (
      state.hoveredMarkerId ||
      state.hoveredAnnotationId ||
      state.hoveredAnnotationPart ||
      state.expandedAnnotation ||
      canvasHoveredAnnotationId
    ) {
      canvasHoveredAnnotationId = undefined;
      setState((s) => {
        s.hoveredMarkerId = undefined;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.expandedAnnotation = undefined;
      });
      Bus.publish(ChartEvent.AnnotationHover, {
        id: state.id,
        hit: null,
      });
      scheduleRender("light");
    }

    if (drawingHit) {
      if (drawingHit.part === "handle") {
        setCanvasCursor("pointer");
      } else {
        setCanvasCursor("grab");
      }
    } else if (drawings?.activeTool) {
      setCanvasCursor(getDrawCursor());
    } else {
      setCanvasCursor("default");
    }

    // Only fixed side axes participate in hover quick-controls.
    // Floating contextual axes are right-click targets, but should not churn hover state.
    const axis = axisAtPoint(state, layout, pt);
    const prevHovered = state.hoveredAxisId;

    if (prevHovered !== axis?.id) {
      setState((s) => {
        s.hoveredAxisId = axis?.id;
      });
      scheduleRender("light");
    }

    const inPlot =
      pt.x >= layout.areaX &&
      pt.x <= layout.areaX + layout.areaWidth &&
      pt.y >= 0 &&
      pt.y <= layout.areaHeight;

    const separatorHit = paneSeparatorAtPoint(state, layout, pt);
    if (!drawingHit && !drawings?.activeTool && separatorHit) {
      setCanvasCursor("row-resize");
      if (
        state.crosshair.visible ||
        state.crosshair.paneId !== undefined ||
        state.crosshair.time !== undefined
      ) {
        setState((s) => {
          s.crosshair.visible = false;
          s.crosshair.paneId = undefined;
          s.crosshair.time = undefined;
        });
        scheduleRender("light");
      }
      return;
    }

    // When cursor exits horizontally into the y-axis zone but stays within
    // vertical bounds, keep the crosshair visible and update Y so it
    // continues tracking the mouse vertically (used by the alert "+" button).
    const inAxisZone =
      !inPlot &&
      pt.x > layout.areaX + layout.areaWidth &&
      pt.y >= 0 &&
      pt.y <= layout.areaHeight;

    if (!inPlot && !inAxisZone) {
      const shouldUpdate =
        state.crosshair.visible ||
        state.hoveredSeriesId !== undefined ||
        state.crosshair.paneId !== undefined ||
        state.crosshair.time !== undefined;
      if (shouldUpdate) {
        setState((s) => {
          s.crosshair.visible = false;
          s.crosshair.paneId = undefined;
          s.crosshair.time = undefined;
          s.hoveredSeriesId = undefined;
          s.focusedSeriesId = s.lockedSeriesId;
        });
        scheduleRender("full");
      }
      return;
    }

    if (inPlot && !drawingHit && !drawings?.activeTool) {
      setCanvasCursor("grab");
    }

    const paneId = paneIdAtY(state, layout, pt.y);
    const hoveredSeriesId = focusedSeriesAtPoint(
      state,
      paneId,
      pt,
      layout,
      entry.coord,
    );
    const focusedSeriesId = resolveFocusedSeriesId(state, hoveredSeriesId);
    const focusedSeries = focusedSeriesId
      ? getSeries(state, focusedSeriesId)
      : null;
    const primary = focusedSeries ?? getPrimarySeries(state);
    if (!primary) return;
    const index = xToSeriesIndex(state, primary, pt.x, layout);

    const magnetTarget = state.magnetSeriesId
      ? (getSeries(state, state.magnetSeriesId) ?? primary)
      : null;
    // Compute the magnet index from the target series' own x-mapping,
    // not from primary — they may differ for compare series with gaps
    // or different resolutions.
    const magnetIndex = magnetTarget
      ? xToSeriesIndex(state, magnetTarget, pt.x, layout) -
        Number(magnetTarget.options.xOffset ?? 0)
      : index;
    const y = magnetTarget
      ? (Cursor.magnetY(entry, magnetIndex, pt.y, magnetTarget) ?? pt.y)
      : pt.y;

    const clampedX = Math.max(
      layout.areaX,
      Math.min(layout.areaX + layout.areaWidth, pt.x),
    );
    const clampedY = Math.max(0, Math.min(layout.areaHeight, y));

    const firstSeries = primary;
    let time: Chart.CrosshairState["time"];
    if (firstSeries && index >= 0 && index < firstSeries.data.length) {
      const axis = getAxis(state.config.xAxis, Series.getXAxisId(firstSeries));
      const xField = resolveField(firstSeries, "x", axis.field || "time");
      const point = firstSeries.data[index] as
        Record<string, unknown> | undefined;
      if (point?.[xField] !== undefined) {
        time = point[xField] as Chart.CrosshairState["time"];
      }
    }

    const prev = state.crosshair;
    const sameTime =
      prev.time === time || (prev.time === undefined && time === undefined);
    const unchanged =
      prev.visible &&
      prev.x === clampedX &&
      prev.y === clampedY &&
      prev.logicalIndex === index &&
      sameTime &&
      prev.paneId === paneId &&
      state.hoveredSeriesId === hoveredSeriesId &&
      state.focusedSeriesId === focusedSeriesId;

    if (unchanged) return;

    setState((s) => {
      s.crosshair.visible = true;
      s.crosshair.x = clampedX;
      s.crosshair.y = clampedY;
      s.crosshair.logicalIndex = index;
      s.crosshair.paneId = paneId;
      s.hoveredSeriesId = hoveredSeriesId;
      s.focusedSeriesId = resolveFocusedSeriesId(s, hoveredSeriesId);
      if (time !== undefined) {
        s.crosshair.time = time;
      } else {
        s.crosshair.time = undefined;
      }
    });

    Bus.publish(ChartEvent.Crosshair, {
      id: state.id,
      point: { x: pt.x, y: pt.y },
      logicalIndex: index,
      values: {},
    });

    // Use "light" instead of "cursor" to prevent xRuntimeCache from
    // compositing stale series geometry when data was cleared.
    scheduleRender("light");
  };

  const onMouseLeave = (event: MouseEvent) => {
    const state = getState();
    const relatedTarget = event.relatedTarget;
    const interactionRoot =
      canvas.closest(".oc-chart-canvas-root") ?? canvas.parentElement ?? canvas;
    if (
      relatedTarget instanceof Node &&
      interactionRoot.contains(relatedTarget)
    ) {
      return;
    }
    const rootRect = interactionRoot.getBoundingClientRect();
    if (
      event.clientX >= rootRect.left &&
      event.clientX <= rootRect.right &&
      event.clientY >= rootRect.top &&
      event.clientY <= rootRect.bottom
    ) {
      return;
    }
    if (
      !drag &&
      !paneResizeDrag &&
      !chartExplainDrag &&
      !annotationHandleDrag &&
      state.annotationCreate?.phase !== "placing"
    ) {
      canvasHoveredAnnotationId = undefined;
      setState((s) => {
        s.crosshair.visible = false;
        s.crosshair.paneId = undefined;
        s.crosshair.time = undefined;
        s.hoveredSeriesId = undefined;
        s.focusedSeriesId = s.lockedSeriesId;
        s.hoveredAxisId = undefined;
        s.hoveredMarkerId = undefined;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.expandedAnnotation = undefined;
        if (s.drawings) s.drawings.hoveredId = undefined;
      });
      Bus.publish(ChartEvent.AnnotationHover, {
        id: state.id,
        hit: null,
      });
      scheduleRender("full");
    }
    setCanvasCursor("default");
  };

  const onMouseDown = (e: MouseEvent) => {
    config.onFocus?.();

    const state = getState();
    ChartStateModel.assertModelReady(state);
    if (e.button !== 0) return;
    const entry = createFakeEntry();
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    const mods = Action.mods(e);
    const chartConfig = state.config;
    const activeXAxis = getActiveXAxis(state);
    const toggles = chartConfig.interaction.toggles;
    const layout = Chart.computeLayout(chartConfig);
    const inPlot =
      pt.x >= layout.areaX &&
      pt.x <= layout.areaX + layout.areaWidth &&
      pt.y >= 0 &&
      pt.y <= layout.areaHeight;
    const inSelectableX =
      pt.x >= layout.areaX && pt.x <= layout.areaX + layout.areaWidth;

    if (state.drawings.activeTool === "agent_session" && inSelectableX) {
      e.preventDefault();
      suppressNextClick = true;
      const color = nextChartExplainColor(state);
      const mode = state.chartExplain?.mode ?? "thinking";
      chartExplainDrag = { start: pt, current: pt, color, mode };
      setState((s) => {
        s.chartExplain ??= {};
        s.chartExplain.mode = mode;
        s.chartExplain.draftBand = {
          xStart: pt.x,
          xEnd: pt.x,
          color,
          translucent: true,
          mode: "dragging",
        };
        s.hoveredMarkerId = undefined;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.crosshair.visible = false;
        s.crosshair.paneId = undefined;
        s.crosshair.time = undefined;
      });
      window.addEventListener("mousemove", handleChartExplainDrag);
      window.addEventListener("mouseup", endChartExplainDrag);
      setCanvasCursor("crosshair");
      scheduleRender("light");
      return;
    }

    if (state.annotationCreate?.phase === "placing" && inPlot) {
      e.preventDefault();
      suppressNextClick = true;
      const labelAnchor = pointToAnchor(pt, entry, { projectX: true });
      if (!labelAnchor) return;
      const nextDraft = {
        ...state.annotationCreate,
        phase: "editing" as const,
        anchor: { ...state.annotationCreate.anchor, labelAnchor },
        clientAnchor: clientAnchor(rect, pt),
      };
      const clientPill = clientDraftPill(state, entry, rect, nextDraft);
      setState((s) => {
        const current = s.annotationCreate;
        if (!current || current.phase !== "placing") return;
        s.annotationCreate = {
          ...nextDraft,
          clientPill,
        };
        s.activeAnnotationId = current.id;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.crosshair.visible = false;
        s.crosshair.paneId = undefined;
        s.crosshair.time = undefined;
      });
      setCanvasCursor("default");
      scheduleRender("light");
      return;
    }

    if (state.annotationCreate?.phase === "armed" && inPlot) {
      e.preventDefault();
      suppressNextClick = true;
      const targetAnchor = pointToAnchor(pt, entry);
      const start = targetAnchor ? targetAnchor.time : null;
      if (!targetAnchor || start === null) {
        setState((s) => {
          s.annotationCreate = {
            phase: "error",
            id: `annotation-draft-${UUID.random()}`,
            anchor: {
              start: Date.now() / 1000,
            },
            label: "Annotation",
            clientAnchor: clientAnchor(rect, pt),
            message: "Click inside the chart time range to add an annotation.",
          };
        });
        scheduleRender("light");
        return;
      }
      const id = `annotation-draft-${UUID.random()}`;
      setState((s) => {
        s.annotationCreate = {
          phase: "placing",
          id,
          anchor: {
            start,
            targetAnchor,
            labelAnchor: targetAnchor,
          },
          label: "Annotation",
          clientAnchor: clientAnchor(rect, pt),
        };
        s.activeAnnotationId = id;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.activeMarkerId = undefined;
        s.hoveredMarkerId = undefined;
        s.crosshair.visible = false;
        s.crosshair.paneId = undefined;
        s.crosshair.time = undefined;
        if (s.drawings) {
          s.drawings.selectedId = undefined;
          s.drawings.draft = undefined;
          s.drawings.contextMenu = undefined;
          s.drawings.configId = undefined;
        }
      });
      setCanvasCursor("default");
      scheduleRender("light");
      return;
    }

    if (state.drawings?.contextMenu || state.drawings?.configId) {
      setState((s) => {
        if (s.drawings) s.drawings.contextMenu = undefined;
        if (s.drawings) s.drawings.configId = undefined;
      });
    }

    if (state.seriesContextMenu) {
      setState((s) => {
        s.seriesContextMenu = undefined;
      });
    }

    const separatorHit = paneSeparatorAtPoint(state, layout, pt);
    if (separatorHit) {
      const topPane = state.panes.find(
        (pane) => pane.id === separatorHit.topPaneId,
      );
      const bottomPane = state.panes.find(
        (pane) => pane.id === separatorHit.bottomPaneId,
      );
      if (topPane && bottomPane) {
        const totalStartHeight = state.panes.reduce(
          (sum, pane) => sum + Math.max(1, pane.height),
          0,
        );
        paneResizeDrag = {
          topPaneId: topPane.id,
          bottomPaneId: bottomPane.id,
          startY: pt.y,
          topStartHeight: topPane.height,
          bottomStartHeight: bottomPane.height,
          totalStartHeight,
          layoutAreaStartHeight: Math.max(1, layout.areaHeight),
        };
        window.addEventListener("mousemove", handleDrag);
        window.addEventListener("mouseup", endDrag);
        setCanvasCursor("row-resize");
        return;
      }
    }

    if (inPlot) {
      const paneId = paneIdAtY(state, layout, pt.y);
      const nearestSeriesId = focusedSeriesAtPoint(
        state,
        paneId,
        pt,
        layout,
        entry.coord,
      );
      if (nearestSeriesId) {
        if (
          nearestSeriesId !== state.hoveredSeriesId ||
          nearestSeriesId !== state.lockedSeriesId ||
          nearestSeriesId !== state.focusedSeriesId
        ) {
          setState((s) => {
            s.hoveredSeriesId = nearestSeriesId;
            s.lockedSeriesId = nearestSeriesId;
            s.focusedSeriesId = nearestSeriesId;
          });
          scheduleRender("light");
        }
      } else if (state.lockedSeriesId || state.focusedSeriesId) {
        setState((s) => {
          s.hoveredSeriesId = undefined;
          s.lockedSeriesId = undefined;
          s.focusedSeriesId = undefined;
        });
        scheduleRender("light");
      }
    }

    const drawingContext = buildDrawingContext(entry);
    if (drawingContext) {
      const hit = hitTestDrawings(
        drawingState(state),
        { ...drawingContext, mouse: pt },
        entry.ctx,
      );
      if (hit) {
        const hitItem = drawingItems(state).find((item) => item.id === hit.id);
        canvasHoveredAnnotationId = undefined;
        setState((s) => {
          const drawings = s.drawings;
          drawings.selectedId = hit.id;
          drawings.draft = undefined;
          drawings.contextMenu = undefined;
          s.activeAnnotationId = undefined;
          s.hoveredAnnotationId = undefined;
          s.hoveredAnnotationPart = undefined;
          s.expandedAnnotation = undefined;
          if (drawings.configId && drawings.configId !== hit.id) {
            drawings.configId = undefined;
          }
        });
        if (hitItem && !hitItem.locked) {
          const anchors = hitItem.anchors.map((a) => ({ ...a }));
          if (hit.part === "handle" && hit.handleIndex !== undefined) {
            drawingDrag = {
              mode: "handle",
              id: hit.id,
              handleIndex: hit.handleIndex,
              startAnchors: anchors,
              startPoint: pt,
            };
          } else {
            drawingDrag = {
              mode: "body",
              id: hit.id,
              startAnchors: anchors,
              startPoint: pt,
            };
          }
          window.addEventListener("mouseup", endDrawing);
          setCanvasCursor("grabbing");
        }
        scheduleRender("light");
        return;
      }

      if (state.drawings?.selectedId) {
        setState((s) => {
          const drawings = s.drawings;
          drawings.selectedId = undefined;
          drawings.configId = undefined;
        });
        scheduleRender("light");
      }
    }

    if (
      !state.drawings?.activeTool &&
      state.annotationCreate?.phase !== "armed"
    ) {
      const annotationHit = hitEventStrip(
        state,
        entry,
        pt,
        immediateAnnotationInteraction(state),
      );
      if (annotationHit) {
        e.preventDefault();
        suppressNextClick = true;
        if (
          annotationHit.kind === "chart_annotation" &&
          annotationHit.part === "expand_button"
        ) {
          expandAnnotationCard(annotationHit.id, "expand_button");
          return;
        }
        if (
          annotationHit.kind === "chart_annotation" &&
          (annotationHit.part === "target_handle" ||
            annotationHit.part === "label_handle" ||
            annotationHit.part === "body")
        ) {
          beginAnnotationInteraction(annotationHit, pt);
          return;
        }
        if (
          annotationHit.kind === "marker" &&
          annotationHit.stacked &&
          !annotationHit.expanded
        ) {
          setState((s) => {
            s.hoveredMarkerId = annotationHit.id;
            s.hoveredAnnotationId = undefined;
            s.hoveredAnnotationPart = undefined;
            s.expandedAnnotation = undefined;
            s.crosshair.visible = false;
            s.crosshair.paneId = undefined;
            s.crosshair.time = undefined;
          });
          scheduleRender("light");
          return;
        }
        setState((s) => {
          if (annotationHit.kind === "marker") {
            canvasHoveredAnnotationId = undefined;
            s.activeMarkerId = annotationHit.id;
            s.activeAnnotationId = undefined;
            s.hoveredMarkerId = annotationHit.id;
            s.hoveredAnnotationId = undefined;
            s.hoveredAnnotationPart = undefined;
            s.expandedAnnotation = undefined;
          } else {
            const ownsHover = annotationHitOwnsHover(annotationHit);
            canvasHoveredAnnotationId = ownsHover
              ? annotationHit.id
              : undefined;
            s.activeAnnotationId = annotationHit.id;
            s.hoveredAnnotationId = ownsHover ? annotationHit.id : undefined;
            s.hoveredAnnotationPart = ownsHover
              ? annotationHit.part
              : undefined;
            if (s.expandedAnnotation?.id !== annotationHit.id) {
              s.expandedAnnotation = undefined;
            }
            s.activeMarkerId = undefined;
            s.hoveredMarkerId = undefined;
          }
          if (annotationHit.kind === "chart_annotation" && s.drawings) {
            s.drawings.selectedId = undefined;
            s.drawings.contextMenu = undefined;
            s.drawings.configId = undefined;
          }
          s.crosshair.visible = false;
          s.crosshair.paneId = undefined;
          s.crosshair.time = undefined;
        });
        const activeHit =
          annotationHit.kind === "chart_annotation"
            ? (hitEventStrip(state, entry, pt, {
                activeAnnotationId: annotationHit.id,
                hoveredAnnotationId: annotationHitOwnsHover(annotationHit)
                  ? annotationHit.id
                  : undefined,
                expandedAnnotation:
                  state.expandedAnnotation?.id === annotationHit.id
                    ? state.expandedAnnotation
                    : undefined,
              }) ?? annotationHit)
            : annotationHit;
        Bus.publish(ChartEvent.AnnotationHit, {
          id: state.id,
          hit: clientAnnotationHit(rect, activeHit),
        });
        scheduleRender("light");
        return;
      }
    }

    if (
      state.activeMarkerId ||
      state.activeAnnotationId ||
      state.expandedAnnotation
    ) {
      setState((s) => {
        s.activeMarkerId = undefined;
        s.activeAnnotationId = undefined;
        s.expandedAnnotation = undefined;
      });
      scheduleRender("light");
    }

    const activeTool = state.drawings?.activeTool;
    if (activeTool && activeTool !== "agent_session" && !mods.alt) {
      const anchor = pointToAnchor(pt, entry, { drawingType: activeTool });
      if (!anchor) return;
      const defaultColor = resolveDrawingDefaultColor(state.config.chart);
      const required = Drawing.requiredAnchors(activeTool);
      if (activeTool === "freehand") {
        setState((s) => {
          const drawings = s.drawings;
          updateFreehandDraft(s, [anchor], defaultColor);
          drawings.selectedId = undefined;
        });
        drawingDrag = { mode: "freehand", anchors: [anchor], lastPoint: pt };
        window.addEventListener("mouseup", endDrawing);
        setCanvasCursor("grabbing");
        scheduleRender("light");
        return;
      }
      const clickPreview =
        activeTool === "trend_line" ||
        activeTool === "ray" ||
        activeTool === "extended_line";
      if (required >= 3 || clickPreview) {
        if (
          !drawingDrag ||
          drawingDrag.mode !== "draft_multi" ||
          drawingDrag.tool !== activeTool
        ) {
          drawingDrag = {
            mode: "draft_multi",
            tool: activeTool,
            anchors: [anchor],
          };
          setState((s) => {
            const drawings = s.drawings;
            updateDraftMulti(
              s,
              activeTool,
              [anchor],
              anchor,
              defaultColor,
              required,
            );
            drawings.selectedId = undefined;
          });
          scheduleRender("light");
          return;
        }

        const nextAnchors = [...drawingDrag.anchors, anchor];
        if (nextAnchors.length >= required) {
          let autoCleared = false;
          setState((s) => {
            autoCleared = finalizeDraft(s, activeTool, nextAnchors);
          });
          if (autoCleared) onDrawingToolAutoClear?.();
          drawingDrag = null;
        } else {
          drawingDrag = {
            mode: "draft_multi",
            tool: activeTool,
            anchors: nextAnchors,
          };
          setState((s) =>
            updateDraftMulti(
              s,
              activeTool,
              nextAnchors,
              anchor,
              defaultColor,
              required,
            ),
          );
        }
        scheduleRender("light");
        return;
      }

      setState((s) => {
        const drawings = s.drawings;
        drawings.draft = Drawing.create(activeTool, [anchor], {
          style: {
            lineColor: drawings.draft?.style?.lineColor ?? defaultColor,
            textColor: drawings.draft?.style?.textColor ?? defaultColor,
          },
        });
        drawings.selectedId = undefined;
      });
      drawingDrag = { mode: "draft", tool: activeTool, startAnchor: anchor };
      window.addEventListener("mouseup", endDrawing);
      setCanvasCursor("grabbing");
      scheduleRender("light");
      return;
    }

    const axis = axisAtPoint(state, layout, pt);
    if (axis) {
      if (toggles.drag) {
        const region: Action.Region = { type: "yscale", scale: axis.id };
        const extent = computeVisibleExtent(entry, axis.id);
        drag = Drag.begin(region, pt, mods, { extent });
        dragActivated = false;
        window.addEventListener("mousemove", handleDrag);
        window.addEventListener("mouseup", endDrag);
        return;
      }
    }

    if (!toggles.scroll) return;

    const region: Action.Region = { type: "canvas" };
    const extents: Record<string, { min: number; max: number }> = {};
    if (mods.shift) {
      const activePaneId = paneIdAtY(state, layout, pt.y);
      const axes = chartConfig.yAxis.axes as Axis[];
      for (const a of axes) {
        if (
          a.visible &&
          !a.lockZero &&
          !a.autoScale &&
          axisPaneIdForAxis(state, a) === activePaneId
        ) {
          extents[a.id] = computeVisibleExtent(entry, a.id);
        }
      }
    }
    drag = Drag.begin(region, pt, mods, {
      offset:
        activeXAxis.mode === "ordinal" ? activeXAxis.spacing.rightOffset : 0,
      domain:
        activeXAxis.mode === "ordinal"
          ? undefined
          : (activeXAxis.domain ??
            deriveLinearDomain(
              activeXAxis,
              axisSeries(seriesValues(state), activeXAxis.id),
            )),
      extents: mods.shift ? extents : undefined,
    });
    dragActivated = false;
    window.addEventListener("mousemove", handleDrag);
    window.addEventListener("mouseup", endDrag);
    setCanvasCursor("grabbing");
  };

  const onContextMenu = (e: MouseEvent) => {
    const state = getState();
    ChartStateModel.assertModelReady(state);
    const entry = createFakeEntry();
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);

    const floatingOverlay = floatingAxisAtPoint(pt);
    const axis = floatingOverlay
      ? ((state.config.yAxis.axes as Axis[]).find(
          (item) => item.id === floatingOverlay.axisId,
        ) ?? null)
      : axisAtPoint(state, Chart.computeLayout(state.config), pt);
    if (axis) {
      e.preventDefault();
      setState((s) => {
        s.yAxisContextMenu = {
          axisId: axis.id,
          floating: !!floatingOverlay,
          x: pt.x,
          y: pt.y,
          clientX: e.clientX,
          clientY: e.clientY,
        };
        if (s.drawings) {
          s.drawings.contextMenu = undefined;
          s.drawings.configId = undefined;
        }
        s.seriesContextMenu = undefined;
      });
      scheduleRender("light");
      return;
    }

    const drawingContext = buildDrawingContext(entry);
    if (!drawingContext) {
      if (state.yAxisContextMenu || state.seriesContextMenu) {
        setState((s) => {
          s.yAxisContextMenu = undefined;
          s.seriesContextMenu = undefined;
        });
        scheduleRender("light");
      }
      return;
    }

    const hit = hitTestDrawings(
      drawingState(state),
      { ...drawingContext, mouse: pt },
      entry.ctx,
    );
    if (hit) {
      e.preventDefault();
      setState((s) => {
        const drawings = s.drawings;
        drawings.selectedId = hit.id;
        drawings.contextMenu = { id: hit.id, x: pt.x, y: pt.y };
        s.activeAnnotationId = undefined;
        s.hoveredAnnotationId = undefined;
        s.hoveredAnnotationPart = undefined;
        s.expandedAnnotation = undefined;
        s.yAxisContextMenu = undefined;
        s.seriesContextMenu = undefined;
      });
      scheduleRender("light");
      return;
    }

    const annotationHit = hitEventStrip(
      state,
      entry,
      pt,
      immediateAnnotationInteraction(state),
    );
    if (annotationHit) {
      e.preventDefault();
      setState((s) => {
        if (annotationHit.kind === "marker") {
          canvasHoveredAnnotationId = undefined;
          s.hoveredMarkerId = annotationHit.id;
          s.activeMarkerId = annotationHit.id;
          s.hoveredAnnotationId = undefined;
          s.hoveredAnnotationPart = undefined;
          s.activeAnnotationId = undefined;
          s.expandedAnnotation = undefined;
        } else {
          const ownsHover = annotationHitOwnsHover(annotationHit);
          canvasHoveredAnnotationId = ownsHover ? annotationHit.id : undefined;
          s.hoveredAnnotationId = ownsHover ? annotationHit.id : undefined;
          s.hoveredAnnotationPart = ownsHover ? annotationHit.part : undefined;
          s.activeAnnotationId = annotationHit.id;
          if (s.expandedAnnotation?.id !== annotationHit.id) {
            s.expandedAnnotation = undefined;
          }
          s.hoveredMarkerId = undefined;
          s.activeMarkerId = undefined;
        }
        if (s.drawings) {
          s.drawings.selectedId = undefined;
          s.drawings.contextMenu = undefined;
          s.drawings.configId = undefined;
        }
        s.yAxisContextMenu = undefined;
        s.seriesContextMenu = undefined;
      });
      if (
        annotationHit.kind === "chart_annotation" &&
        drawingItems(state).some(
          (item) => item.id === annotationHit.id && item.type === "annotation",
        )
      ) {
        setState((s) => {
          s.drawings.selectedId = annotationHit.id;
          s.drawings.contextMenu = { id: annotationHit.id, x: pt.x, y: pt.y };
        });
      }
      Bus.publish(ChartEvent.AnnotationContextMenu, {
        id: state.id,
        hit: {
          ...annotationHit,
          anchor: { x: e.clientX, y: e.clientY },
        },
      });
      scheduleRender("light");
      return;
    }

    const layout = Chart.computeLayout(state.config);
    const inPlot =
      pt.x >= layout.areaX &&
      pt.x <= layout.areaX + layout.areaWidth &&
      pt.y >= 0 &&
      pt.y <= layout.areaHeight;
    if (inPlot) {
      const seriesId = nearestSeriesAtPoint(state, pt, layout, entry.coord);
      if (seriesId) {
        e.preventDefault();
        setState((s) => {
          s.seriesContextMenu = {
            seriesId,
            x: pt.x,
            y: pt.y,
            clientX: e.clientX,
            clientY: e.clientY,
          };
          if (s.drawings) {
            s.drawings.contextMenu = undefined;
            s.drawings.configId = undefined;
          }
          s.hoveredSeriesId = seriesId;
          s.lockedSeriesId = seriesId;
          s.focusedSeriesId = seriesId;
          s.yAxisContextMenu = undefined;
          s.expandedAnnotation = undefined;
          s.hoveredAnnotationPart = undefined;
        });
        scheduleRender("light");
        return;
      }
    }

    if (state.drawings?.contextMenu) {
      setState((s) => {
        if (s.drawings) s.drawings.contextMenu = undefined;
      });
      scheduleRender("light");
    }

    if (state.yAxisContextMenu) {
      setState((s) => {
        s.yAxisContextMenu = undefined;
      });
      scheduleRender("light");
    }

    if (state.seriesContextMenu) {
      setState((s) => {
        s.seriesContextMenu = undefined;
      });
      scheduleRender("light");
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();

    const state = getState();
    ChartStateModel.assertModelReady(state);
    const entry = createFakeEntry();
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    const mods = Action.mods(e);
    const chartConfig = state.config;
    const activeXAxis = getActiveXAxis(state);
    const layout = Chart.computeLayout(chartConfig);
    const toggles = chartConfig.interaction.toggles;

    const speed = Input.wheelSpeed(e.deltaMode);
    const delta: Action.Point = { x: e.deltaX * speed, y: e.deltaY * speed };

    const axis = axisAtPoint(state, layout, pt);
    if (axis && toggles.zoom && !axis.autoScale) {
      const region: Action.Region = { type: "yscale", scale: axis.id };
      const action = Action.wheel(region, pt, delta, mods);
      const cmds = Mapping.map(action, { config: Mapping.defaults });

      for (const cmd of cmds) {
        if (cmd.effect === "zoomY") {
          const extent = computeVisibleExtent(entry, cmd.scale);
          const update = Effect.zoomY(extent, cmd.factor, axis.lockZero);
          if (update.extent) {
            setState((s) => {
              const axes = s.config.yAxis.axes as Axis[];
              const idx = axes.findIndex((a) => a.id === axis.id);
              if (idx >= 0) {
                axes[idx] = { ...axes[idx]!, visibleExtent: update.extent };
              }
            });
          }
        }
      }
      scheduleRender("full");
      return;
    }

    const region: Action.Region = { type: "canvas" };
    const action = Action.wheel(region, pt, delta, mods);
    const cmds = Mapping.map(action, { config: Mapping.defaults });

    for (const cmd of cmds) {
      if (cmd.effect === "zoomX" && toggles.zoom) {
        if (activeXAxis.mode === "ordinal") {
          const update = Effect.zoomX(
            activeXAxis.spacing.barSpacing,
            activeXAxis.spacing.rightOffset,
            layout.areaWidth,
            cmd.dy,
            cmd.x - layout.areaX,
            activeXAxis.spacing.minBarSpacing,
            activeXAxis.spacing.maxBarSpacing,
          );
          setState((s) => {
            const updates: Partial<XAxisConfig.Spacing> = {};
            if (update.spacing !== undefined)
              updates.barSpacing = update.spacing;
            if (update.offset !== undefined)
              updates.rightOffset = update.offset;
            setAxisSpacing(s.config.xAxis, activeXAxis.id, updates);
          });
        } else {
          setState((s) => {
            const axis = getAxis(s.config.xAxis, activeXAxis.id);
            const bound = axisSeries(seriesValues(s), axis.id);
            const domain = axis.domain ?? deriveLinearDomain(axis, bound);
            const span = Math.max(domain.max - domain.min, domain.minSpan);
            const factor = cmd.dy > 0 ? 1.1 : 0.9;
            const nextSpan = Math.max(domain.minSpan, span * factor);
            const anchor = linearXToValue(
              cmd.x - layout.areaX,
              domain,
              layout.areaWidth,
            );
            const ratio = span > 0 ? (anchor - domain.min) / span : 0.5;
            const nextMin = anchor - ratio * nextSpan;
            const nextMax = nextMin + nextSpan;
            setAxisDomain(s.config.xAxis, axis.id, {
              min: nextMin,
              max: nextMax,
              minSpan: domain.minSpan,
            });
          });
        }
      }
      if (cmd.effect === "translateX" && toggles.scroll) {
        if (activeXAxis.mode === "ordinal") {
          const scrollDelta = cmd.dx / 100;
          const update = Effect.translateX(
            activeXAxis.spacing.rightOffset,
            -scrollDelta * 80,
          );
          if (update.offset !== undefined) {
            setState((s) => {
              setAxisSpacing(s.config.xAxis, activeXAxis.id, {
                rightOffset: update.offset!,
              });
            });
          }
        } else {
          setState((s) => {
            const axis = getAxis(s.config.xAxis, activeXAxis.id);
            const bound = axisSeries(seriesValues(s), axis.id);
            const domain = axis.domain ?? deriveLinearDomain(axis, bound);
            const span = Math.max(domain.max - domain.min, domain.minSpan);
            const delta = (cmd.dx / Math.max(1, layout.areaWidth)) * span;
            setAxisDomain(s.config.xAxis, axis.id, {
              min: domain.min + delta,
              max: domain.max + delta,
              minSpan: domain.minSpan,
            });
          });
        }
      }
    }

    scheduleRender("full");
  };

  const onClick = (e: MouseEvent) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault();
      return;
    }
    const state = getState();
    ChartStateModel.assertModelReady(state);
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    const entry = createFakeEntry(state);
    const anchor = pointToAnchor(pt, entry);

    Bus.publish(ChartEvent.Click, {
      id: state.id,
      point: { x: pt.x, y: pt.y },
      time: anchor?.time,
      price: anchor?.price,
    });
  };

  const onDblClick = (e: MouseEvent) => {
    e.preventDefault();
    const state = getState();
    ChartStateModel.assertModelReady(state);
    const rect = canvas.getBoundingClientRect();
    const pt = Input.point(e, rect);
    const entry = createFakeEntry(state);
    const annotationHit = hitEventStrip(
      state,
      entry,
      pt,
      immediateAnnotationInteraction(state),
    );
    if (
      annotationHit?.kind === "chart_annotation" &&
      (annotationHit.part === "body" || annotationHit.part === "label_handle")
    ) {
      setState((s) => {
        s.activeAnnotationId = annotationHit.id;
        s.hoveredAnnotationId = annotationHit.id;
        s.hoveredAnnotationPart = annotationHit.part;
        s.expandedAnnotation = undefined;
        s.activeMarkerId = undefined;
        s.hoveredMarkerId = undefined;
        if (s.drawings) {
          s.drawings.selectedId = undefined;
          s.drawings.contextMenu = undefined;
          s.drawings.configId = undefined;
        }
      });
      Bus.publish(ChartEvent.AnnotationEdit, {
        id: state.id,
        hit: clientChartAnnotationHit(rect, annotationHit),
      });
      scheduleRender("light");
      return;
    }
    Bus.publish(ChartEvent.DblClick, {
      id: state.id,
      point: { x: pt.x, y: pt.y },
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest?.('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    if (annotationHandleDrag) {
      releaseAnnotationDrag();
      scheduleRender("light");
      return;
    }
    const state = getState();
    ChartStateModel.assertModelReady(state);
    if (
      state.drawings.activeTool === "agent_session" ||
      state.chartExplain?.draftBand
    ) {
      setState((s) => {
        if (s.drawings.activeTool === "agent_session")
          s.drawings.activeTool = null;
      });
      cancelChartExplainDrag();
      return;
    }
    if (!state.lockedSeriesId) return;
    setState((s) => {
      s.lockedSeriesId = undefined;
      s.focusedSeriesId = s.hoveredSeriesId;
    });
    scheduleRender("light");
  };

  // Attach listeners
  // mousemove/mouseleave listen on the root wrapper (ancestor of both canvas
  // and DOM overlays) so overlay elements with pointer-events:auto don't
  // block crosshair tracking. Coordinate calculations still use canvas.getBoundingClientRect().
  const root = canvas.parentElement?.parentElement ?? canvas;
  root.addEventListener("mousemove", onMouseMove);
  root.addEventListener("mouseleave", onMouseLeave);
  root.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDblClick);
  window.addEventListener("keydown", onKeyDown);

  const controller = (() => {
    root.removeEventListener("mousemove", onMouseMove);
    root.removeEventListener("mouseleave", onMouseLeave);
    root.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("dblclick", onDblClick);
    window.removeEventListener("keydown", onKeyDown);
    if (chartExplainDrag) cancelChartExplainDrag();
    endDrag();
    endDrawing();
    // Disposal cancels an unfinished annotation gesture; it must not save or expand.
    releaseAnnotationDrag();
  }) as EventsController;
  controller.beginAnnotationDrag = (id, clientPoint) => {
    const state = getState();
    if (
      getRuntime().disposed ||
      state.drawings.activeTool ||
      state.annotationCreate ||
      annotationHandleDrag
    )
      return;
    const hit = chartAnnotationHitById(
      state,
      createFakeEntry(state),
      id,
      immediateAnnotationInteraction(state),
    );
    if (!hit) return;
    const rect = canvas.getBoundingClientRect();
    config.onFocus?.();
    beginAnnotationInteraction(
      { ...hit, part: "body" },
      { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top },
    );
  };
  controller.refreshExpandedAnnotationHoverGeometry = () => {
    const state = getState();
    const annotationId = state.expandedAnnotation?.id;
    if (!annotationId || state.hoveredAnnotationId !== annotationId) {
      lastExpandedAnnotationHoverGeometrySignature = undefined;
      return;
    }
    const hit = chartAnnotationHitById(
      state,
      createFakeEntry(state),
      annotationId,
      {
        activeAnnotationId: state.activeAnnotationId,
        hoveredAnnotationId: annotationId,
        expandedAnnotation: state.expandedAnnotation,
      },
    );
    if (!hit?.expanded) return;
    const clientHit = clientChartAnnotationHit(
      canvas.getBoundingClientRect(),
      hit,
    );
    const signature = expandedAnnotationHoverGeometrySignature(clientHit);
    if (signature === lastExpandedAnnotationHoverGeometrySignature) return;
    lastExpandedAnnotationHoverGeometrySignature = signature;
    Bus.publish(ChartEvent.AnnotationHover, { id: state.id, hit: clientHit });
  };
  return controller;
}
