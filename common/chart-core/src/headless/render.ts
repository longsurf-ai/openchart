// Purpose: Headless chart renderer — produces PNG/JPEG buffers via @napi-rs/canvas without a browser
// Module:  @openchart/chart-core / headless

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { Chart } from "@openchart/chart-core/chart/state";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import { RenderCache } from "@openchart/chart-core/render";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { PrimitiveWrapper } from "@openchart/chart-core/primitive";
import {
  createRenderProfileFrame,
  repaint,
  type RenderProfileEvent,
  type RuntimeState,
} from "@openchart/chart-core/v2/paint";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";

export interface HeadlessRenderOptions {
  /** Canvas width in CSS pixels (default: from state.config.chart.dimensions.width) */
  width?: number;
  /** Canvas height in CSS pixels (default: from state.config.chart.dimensions.height) */
  height?: number;
  /** Device pixel ratio for HiDPI output (default: 2) */
  ratio?: number;
  /** Output format (default: 'png') */
  format?: "png" | "jpeg";
  /** JPEG quality 0-100 (default: 90, ignored for PNG) */
  quality?: number;
  /** Collect per-stage repaint timings for this one synchronous render. */
  profile?: boolean;
  /** Receives the render profile event when `profile` is enabled. */
  onProfile?: (event: RenderProfileEvent) => void;
}

/**
 * Render a Chart.State to an image buffer using the same paint pipeline as the browser.
 *
 * This is a pure, synchronous function — no DOM, no rAF, no events.
 * It creates an @napi-rs/canvas, builds a RuntimeState, calls repaint(), and returns the buffer.
 */
export function renderToBuffer(
  state: Chart.State,
  options: HeadlessRenderOptions = {},
): Buffer {
  ChartStateModel.assertModelReady(state);

  const width = options.width ?? state.config.chart.dimensions.width;
  const height = options.height ?? state.config.chart.dimensions.height;
  const ratio = options.ratio ?? 2;
  const format = options.format ?? "png";

  // Ensure state dimensions match what we're rendering
  if (
    state.config.chart.dimensions.width !== width ||
    state.config.chart.dimensions.height !== height
  ) {
    state = {
      ...state,
      config: {
        ...state.config,
        chart: {
          ...state.config.chart,
          dimensions: { ...state.config.chart.dimensions, width, height },
        },
      },
    };
  }

  const canvas: Canvas = createCanvas(width * ratio, height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const runtime: RuntimeState = {
    canvas: { width: canvas.width, height: canvas.height },
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ratio,
    textCache: TextCache.create(),
    labelCache: LabelCache.create(),
    renderCache: RenderCache.create(),
    xCache: { positions: [], version: 0, offset: 0 },
    panePrimitives: PrimitiveWrapper.createPane(),
    seriesPrimitives: new Map(),
    disposed: false,
  };

  // Initialize per-series primitive state
  for (const seriesId of ChartStateModel.seriesIds(state)) {
    runtime.seriesPrimitives.set(seriesId, PrimitiveWrapper.create());
  }

  // Full invalidation — repaint everything
  const mask = Invalidate.chart(Invalidate.create(), "full");
  const startedAt = options.profile ? performance.now() : 0;
  const profile = options.profile
    ? createRenderProfileFrame(() => performance.now())
    : undefined;
  repaint(state, runtime, mask, profile);
  if (profile) {
    const endedAt = performance.now();
    options.onProfile?.({
      chartId: state.id,
      level: "full",
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      stages: profile.stages,
    });
  }

  if (format === "jpeg") {
    return canvas.toBuffer("image/jpeg", options.quality ?? 90);
  }
  return canvas.toBuffer("image/png");
}
