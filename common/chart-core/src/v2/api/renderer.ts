// Purpose: Create the stateless ChartRenderer — owns the canvas, render loop, perf tracking, and disposal
// Module:  @openchart/chart-core / v2 / api

import { Chart } from "@openchart/chart-core/chart/state";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import { RenderCache } from "@openchart/chart-core/render";
import { Invalidate } from "@openchart/chart-core/invalidate";
import {
  PrimitiveWrapper,
  type Primitive,
} from "@openchart/chart-core/primitive";
import type { HitTest } from "@openchart/chart-core/hit";
import {
  createRenderProfileFrame,
  repaint,
  type RenderProfileEvent,
} from "@openchart/chart-core/v2/paint";
import {
  setupEvents,
  type EventsConfig,
  type EventsController,
  type RuntimeState,
} from "./events";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { CoordSys } from "@openchart/chart-core/coord";
import { Series } from "@openchart/chart-core/series";
import { labelPlacementDistance } from "@openchart/chart-core/drawing/boundary-labels";
import type {
  LineLabelPlacement,
  Point,
} from "@openchart/chart-core/drawing/shared";

export type { RenderProfileEvent };

type SelectionGlowPerfConfig = {
  enabled?: boolean;
  sampleFrames?: number;
};

type PerfBucketKey = "on" | "off";

type PerfBucketStats = {
  frames: number;
  totalMs: number;
  maxMs: number;
  spanTotal: number;
  samples: number[];
};

const DEFAULT_PERF_SAMPLE_FRAMES = 120;

function createPerfBucketStats(): PerfBucketStats {
  return {
    frames: 0,
    totalMs: 0,
    maxMs: 0,
    spanTotal: 0,
    samples: [],
  };
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
  );
  return sorted[idx] ?? 0;
}

function selectionGlowSummary(state: Chart.State): {
  enabled: boolean;
  spanEstimate: number;
} {
  let enabled =
    state.chartExplain?.draftBand?.mode === "annotating" ||
    Boolean(state.chartExplain?.progressBands?.length) ||
    ChartStateModel.drawingItems(state).some(
      (item) =>
        item.type === "agent_session" &&
        !item.hidden &&
        state.drawings.sessionProgress?.[item.id] !== undefined,
    );
  let spanEstimate = 0;

  for (const series of ChartStateModel.seriesValues(state)) {
    const options = series.options as {
      selectionGlow?: {
        enabled?: boolean;
        fromIndex?: number;
        toIndex?: number;
      };
    };
    const glow = options.selectionGlow;
    if (glow?.enabled !== true) continue;
    enabled = true;

    if (!Number.isFinite(glow.fromIndex) || !Number.isFinite(glow.toIndex))
      continue;
    const from = Math.max(0, Math.floor(glow.fromIndex!));
    const to = Math.max(from, Math.floor(glow.toIndex!));
    spanEstimate = Math.max(spanEstimate, to - from + 1);
  }

  return { enabled, spanEstimate };
}

export interface RendererConfig {
  container: HTMLElement;
  getState: () => Chart.State;
  setState: (mutator: (state: Chart.State) => void) => void;
  onVisibleRangeChange?: (range: { from: number; to: number }) => void;
  onRenderComplete?: (event: {
    chartId: string;
    level: Invalidate.Level;
    startedAt: number;
    endedAt: number;
    durationMs: number;
  }) => void;
  onFocus?: () => void;
  selectionGlowPerf?: SelectionGlowPerfConfig;
  renderProfile?: {
    isEnabled: () => boolean;
    onFrame: (event: RenderProfileEvent) => void;
  };
  onDrawingToolAutoClear?: () => void;
  getDrawingItems?: (
    state: Chart.State,
  ) => import("@openchart/chart-core").Drawing.Item[];
  onAddDrawing?: EventsConfig["onAddDrawing"];
  onUpdateDrawing?: EventsConfig["onUpdateDrawing"];
  onUpdateChartAnnotation?: EventsConfig["onUpdateChartAnnotation"];
  hasLiveSeries?: () => boolean;
}

export interface ChartRenderer {
  /** Replace one source's primitives without replacing other owners. */
  setSeriesPrimitives(
    seriesId: string,
    ownerId: string,
    primitives: readonly Primitive.SeriesPrimitive[],
  ): void;
  /** Hit-test the most recently painted primitive geometry. */
  primitiveAt(x: number, y: number): HitTest.Result | null;
  /**
   * Convert a canvas-local Y coordinate to a series' raw value using the last
   * painted scale, including pane margins, log and comparison transforms.
   * Returns undefined before painting, after disposal, or without usable data.
   * @example const price = renderer.seriesValueAtY("main", pointerY);
   */
  seriesValueAtY(seriesId: string, y: number): number | undefined;
  /**
   * Project a raw series value through its last painted scale, including pane
   * margins, log and comparison transforms. Returns undefined without usable data.
   * @example const y = renderer.seriesYAtValue("main", alert.threshold);
   */
  seriesYAtValue(seriesId: string, value: number): number | undefined;
  /** Read centred label geometry from the last paint, selecting the channel boundary nearest `near`.
   * Returns a detached value, or undefined before paint, after disposal, or when not visible.
   * @example const label = renderer.drawingLabelPlacement("line", {x: mouseX, y: mouseY});
   */
  drawingLabelPlacement(
    drawingId: string,
    near: Point,
  ): LineLabelPlacement | undefined;
  render(level?: Invalidate.Level): void;
  scheduleResize(width: number, height: number): void;
  setSuspended(suspended: boolean): void;
  dispose(): void;
  /** Start a label drag from DOM card content. Core owns hit geometry, preview, commit and listener cleanup.
   * @example renderer.beginAnnotationDrag(id, { x: event.clientX, y: event.clientY });
   */
  beginAnnotationDrag: EventsController["beginAnnotationDrag"];
  readonly canvas: HTMLCanvasElement;
  readonly id: string;
}

export function createRenderer(config: RendererConfig): ChartRenderer {
  const { container, getState, setState, onVisibleRangeChange } = config;
  const perfConfig = config.selectionGlowPerf;
  const perfEnabled = perfConfig?.enabled === true;
  const perfSampleFrames = Math.max(
    1,
    Math.floor(perfConfig?.sampleFrames ?? DEFAULT_PERF_SAMPLE_FRAMES),
  );
  const perfStats = {
    on: createPerfBucketStats(),
    off: createPerfBucketStats(),
  } satisfies Record<PerfBucketKey, PerfBucketStats>;

  const initialState = getState();
  const { width, height } = initialState.config.chart.dimensions;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context");

  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  canvas.style.display = "block";
  ctx.scale(ratio, ratio);

  container.appendChild(canvas);

  const runtime: RuntimeState = {
    canvas,
    ctx,
    ratio,
    textCache: TextCache.create(),
    labelCache: LabelCache.create(),
    renderCache: RenderCache.create(),
    xCache: { positions: [], version: 0, offset: 0 },
    panePrimitives: PrimitiveWrapper.createPane(),
    seriesPrimitives: new Map(),
    disposed: false,
  };
  let suspended = false;
  let deferredCanvasSize: { width: number; height: number } | null = null;
  let pendingCanvasSize: { width: number; height: number } | null = null;

  function assertCanvasSize(width: number, height: number): void {
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return;
    }
    throw new Error(
      `Invariant violated: chart canvas resize requires positive finite dimensions, received ${width}x${height}`,
    );
  }

  function applyCanvasStyleSize(width: number, height: number): void {
    if (
      canvas.style.width === width + "px" &&
      canvas.style.height === height + "px"
    ) {
      return;
    }
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }

  function applyCanvasBackingSize(width: number, height: number): void {
    const nextPixelWidth = width * runtime.ratio;
    const nextPixelHeight = height * runtime.ratio;
    if (
      canvas.width === nextPixelWidth &&
      canvas.height === nextPixelHeight &&
      canvas.style.width === width + "px" &&
      canvas.style.height === height + "px"
    ) {
      return;
    }

    canvas.width = nextPixelWidth;
    canvas.height = nextPixelHeight;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    runtime.ctx.scale(runtime.ratio, runtime.ratio);
  }

  function assertPendingResizeMatchesState(
    state: Chart.State,
    size: { width: number; height: number },
  ): void {
    const dims = state.config.chart.dimensions;
    if (dims.width === size.width && dims.height === size.height) return;
    throw new Error(
      `Invariant violated: chart ${state.id} pending canvas resize ${size.width}x${size.height} does not match render state dimensions ${dims.width}x${dims.height}`,
    );
  }

  const eventsConfig: EventsConfig = {
    canvas,
    getState,
    setState,
    getRuntime: () => runtime,
    scheduleRender: (level) => scheduleRender(level),
    onFocus: config.onFocus,
    onDrawingToolAutoClear: config.onDrawingToolAutoClear,
    getDrawingItems: config.getDrawingItems,
    onAddDrawing: config.onAddDrawing,
    onUpdateDrawing: config.onUpdateDrawing,
    onUpdateChartAnnotation: config.onUpdateChartAnnotation,
  };
  const eventsController = setupEvents(eventsConfig);

  function recordSelectionGlowPerf(
    state: Chart.State,
    bucket: PerfBucketKey,
    durationMs: number,
    spanEstimate: number,
  ): void {
    const stats = perfStats[bucket];
    stats.frames += 1;
    stats.totalMs += durationMs;
    stats.maxMs = Math.max(stats.maxMs, durationMs);
    stats.spanTotal += spanEstimate;
    stats.samples.push(durationMs);

    if (stats.frames % perfSampleFrames !== 0) return;

    const avg = stats.totalMs / stats.frames;
    const spanAvg = stats.spanTotal / stats.frames;
    console.info(
      `[SelectionGlowPerf][chart:${state.id}][glow:${bucket}] frames=${stats.frames} avg=${avg.toFixed(3)}ms p95=${p95(stats.samples).toFixed(3)}ms max=${stats.maxMs.toFixed(3)}ms spanAvg=${spanAvg.toFixed(1)}`,
    );

    stats.frames = 0;
    stats.totalMs = 0;
    stats.maxMs = 0;
    stats.spanTotal = 0;
    stats.samples = [];
  }

  function scheduleRender(level: Invalidate.Level = "full"): void {
    if (runtime.disposed) return;

    const newMask = Invalidate.chart(Invalidate.create(), level);
    runtime.pendingMask = runtime.pendingMask
      ? Invalidate.merge(runtime.pendingMask, newMask)
      : newMask;

    if (suspended) return;

    if (runtime.pendingFrame !== undefined) return;

    runtime.pendingFrame = requestAnimationFrame(() => {
      runtime.pendingFrame = undefined;
      const mask =
        runtime.pendingMask ?? Invalidate.chart(Invalidate.create(), "full");
      runtime.pendingMask = undefined;
      doRender(mask);
    });
  }

  function doRender(mask: Invalidate.Mask): void {
    if (runtime.disposed) return;

    const profileEnabled = config.renderProfile?.isEnabled() === true;
    const startedAt =
      perfEnabled || config.onRenderComplete || profileEnabled
        ? performance.now()
        : 0;
    const state = getState();
    ChartStateModel.assertModelReady(state);
    if (pendingCanvasSize) {
      assertPendingResizeMatchesState(state, pendingCanvasSize);
      applyCanvasBackingSize(pendingCanvasSize.width, pendingCanvasSize.height);
      pendingCanvasSize = null;
    }
    const glowSummary = selectionGlowSummary(state);

    for (const seriesId of ChartStateModel.seriesIds(state)) {
      if (!runtime.seriesPrimitives.has(seriesId)) {
        runtime.seriesPrimitives.set(seriesId, PrimitiveWrapper.create());
      }
    }

    for (const seriesId of runtime.seriesPrimitives.keys()) {
      if (!ChartStateModel.getSeries(state, seriesId)) {
        PrimitiveWrapper.detachAll(runtime.seriesPrimitives.get(seriesId)!);
        runtime.seriesPrimitives.delete(seriesId);
      }
    }

    const profile = profileEnabled
      ? createRenderProfileFrame(() => performance.now())
      : undefined;
    const newRange = repaint(state, runtime, mask, profile);
    eventsController.refreshExpandedAnnotationHoverGeometry();
    const level = Invalidate.get(mask, 0);
    if (level === "light" || level === "full") {
      Bus.publish(ChartEvent.Invalidated, { id: state.id, level });
    }

    if (newRange && onVisibleRangeChange) {
      const lastRange = runtime.lastRange;
      if (
        !lastRange ||
        lastRange.from !== newRange.from ||
        lastRange.to !== newRange.to
      ) {
        runtime.lastRange = newRange;
        onVisibleRangeChange(newRange);
      }
    }

    if (perfEnabled) {
      const elapsed = performance.now() - startedAt;
      const bucket: PerfBucketKey = glowSummary.enabled ? "on" : "off";
      recordSelectionGlowPerf(state, bucket, elapsed, glowSummary.spanEstimate);
    }

    if (config.onRenderComplete) {
      const endedAt = performance.now();
      config.onRenderComplete({
        chartId: state.id,
        level,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      });
    }

    if (profile && config.renderProfile) {
      const endedAt = performance.now();
      config.renderProfile.onFrame({
        chartId: state.id,
        level,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        stages: profile.stages,
      });
    }

    // Selection glow is a frame-local animation — keep the render loop going
    // only while it is active.
    // Live series do NOT need a continuous loop: the SolidJS series-data effect
    // already calls render('light') when /hose replaces a series data reference.
    // The old hasLiveSeries() auto-loop burned ~16ms/frame of CPU even when idle.
    if (glowSummary.enabled || runtime.annotationPillMotionActive === true) {
      scheduleRender("light");
    }
  }

  function queueCanvasResize(width: number, height: number): void {
    if (runtime.disposed) return;
    assertCanvasSize(width, height);
    if (suspended) {
      deferredCanvasSize = { width, height };
      return;
    }

    deferredCanvasSize = null;
    pendingCanvasSize = { width, height };
    applyCanvasStyleSize(width, height);
    scheduleRender("full");
  }

  const renderer: ChartRenderer = {
    drawingLabelPlacement(drawingId, near) {
      const candidates = runtime.disposed
        ? undefined
        : runtime.drawingLabelPlacements?.get(drawingId);
      if (!candidates?.length) return undefined;
      const point = candidates.reduce((nearest, candidate) =>
        labelPlacementDistance(candidate, near) <
        labelPlacementDistance(nearest, near)
          ? candidate
          : nearest,
      );
      return { x: point.x, y: point.y, angle: point.angle };
    },
    seriesYAtValue(seriesId, value) {
      const series = ChartStateModel.resolvedSeries(getState(), seriesId);
      const scale =
        series && runtime.coord?.scales.y[Series.getYAxisId(series)];
      if (runtime.disposed || !series?.data.length || !scale) return undefined;
      const displayed =
        runtime.modeCache?.modeTransforms.get(seriesId)?.value(value) ?? value;
      if (scale.mode === "log" && displayed <= 0) return undefined;
      const y = CoordSys.toPixel(displayed, scale);
      return Number.isFinite(y) ? y : undefined;
    },
    seriesValueAtY(seriesId, y) {
      const series = ChartStateModel.resolvedSeries(getState(), seriesId);
      const scale =
        series && runtime.coord?.scales.y[Series.getYAxisId(series)];
      if (runtime.disposed || !series?.data.length || !scale) return undefined;
      const displayed = CoordSys.toValue(y, scale);
      const transform = runtime.modeCache?.modeTransforms.get(seriesId);
      // Percentage, indexed and comparison transforms are affine in raw price.
      const offset = transform?.value(0) ?? 0;
      const slope = transform ? transform.value(1) - offset : 1;
      const value = (displayed - offset) / slope;
      return Number.isFinite(value) ? value : undefined;
    },

    beginAnnotationDrag: eventsController.beginAnnotationDrag,
    setSeriesPrimitives(seriesId, ownerId, primitives) {
      if (runtime.disposed) return;
      let target = runtime.seriesPrimitives.get(seriesId);
      if (!target) {
        if (!primitives.length) return;
        target = PrimitiveWrapper.create();
        runtime.seriesPrimitives.set(seriesId, target);
      }
      PrimitiveWrapper.replaceOwned(target, ownerId, primitives);
      scheduleRender("full");
    },
    primitiveAt(x, y) {
      if (runtime.disposed) return null;
      let result: HitTest.Result | null = null;
      for (const [seriesId, primitives] of runtime.seriesPrimitives) {
        if (
          ChartStateModel.getSeries(getState(), seriesId)?.options.visible ===
          false
        )
          continue;
        const hit = PrimitiveWrapper.hit(primitives, x, y);
        if (
          hit &&
          (!result ||
            hit.zOrder > result.zOrder ||
            (hit.zOrder === result.zOrder && hit.distance < result.distance))
        )
          result = hit;
      }
      return result;
    },
    render(level: Invalidate.Level = "full"): void {
      scheduleRender(level);
    },

    scheduleResize(width: number, height: number): void {
      queueCanvasResize(width, height);
    },

    setSuspended(nextSuspended: boolean): void {
      if (runtime.disposed || suspended === nextSuspended) return;
      suspended = nextSuspended;

      if (suspended) {
        if (runtime.pendingFrame !== undefined) {
          cancelAnimationFrame(runtime.pendingFrame);
          runtime.pendingFrame = undefined;
        }
        return;
      }

      if (deferredCanvasSize) {
        queueCanvasResize(deferredCanvasSize.width, deferredCanvasSize.height);
        deferredCanvasSize = null;
        return;
      }

      scheduleRender("full");
    },

    dispose(): void {
      if (runtime.disposed) return;
      runtime.disposed = true;
      runtime.drawingLabelPlacements?.clear();

      if (runtime.pendingFrame !== undefined) {
        cancelAnimationFrame(runtime.pendingFrame);
      }

      eventsController();
      canvas.remove();

      runtime.textCache = TextCache.create();
      runtime.labelCache = LabelCache.create();
      runtime.renderCache = RenderCache.create();
      for (const state of runtime.seriesPrimitives.values())
        PrimitiveWrapper.detachAll(state);
      runtime.seriesPrimitives.clear();
    },

    get canvas(): HTMLCanvasElement {
      return canvas;
    },

    get id(): string {
      return getState().id;
    },
  };

  return renderer;
}
