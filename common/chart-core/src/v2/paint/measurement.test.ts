// Purpose: Verify the ruler is painted through real chart layout, scales and axis layers.
import { createCanvas } from "@napi-rs/canvas";
import { expect, it, vi } from "vitest";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { PrimitiveWrapper } from "@openchart/chart-core/primitive";
import { RenderCache } from "@openchart/chart-core/render";
import { Chart } from "@openchart/chart-core/chart/state";
import { createState } from "../state/defaults";
import { ChartStateModel } from "../state/model";
import { ChartStateUtils } from "../state/utilities";
import { repaint, type RuntimeState } from "./paint";

it.each([false, true])(
  "paints the released %s range and both axis highlights above ticks, respecting log scales and offsets",
  (falling) => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      time: 1700000000 + i * 86400,
      open: 20 + i,
      high: 24 + i,
      low: 18 + i,
      close: 22 + i,
      volume: 100,
    }));
    const state = createState({
      series: {
        price: { type: "Candlestick", data: rows, options: { xOffset: 2 } },
      },
    });
    ChartStateModel.getSeriesObject(state, "price")!.role = "main";
    ChartStateUtils.setVisibleRange(state, 0, 32);
    ChartStateUtils.applyYAxisOptions(state, "right", {
      mode: "logarithmic",
      autoScale: false,
      visibleExtent: { min: 10, max: 100 },
    });
    state.measurement = {
      seriesId: "price",
      phase: "complete",
      start: { time: rows[5]!.time, price: falling ? 60 : 20 },
      end: { time: rows[20]!.time, price: falling ? 20 : 60 },
    };
    const { width, height } = state.config.chart.dimensions;
    const canvas = createCanvas(width, height);
    const runtime: RuntimeState = {
      canvas,
      ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
      ratio: 1,
      textCache: TextCache.create(),
      labelCache: LabelCache.create(),
      renderCache: RenderCache.create(),
      xCache: { positions: [], version: 0, offset: 0 },
      panePrimitives: PrimitiveWrapper.createPane(),
      seriesPrimitives: new Map(),
      disposed: false,
    };
    const fills = vi.spyOn(runtime.ctx, "fillRect");
    const texts = vi.spyOn(runtime.ctx, "fillText");
    repaint(state, runtime, Invalidate.chart(Invalidate.create(), "full"));
    const labels = texts.mock.calls.map((call) => call[0]);
    expect(labels).toContain("15 bars, 15d");
    expect(labels).toContain("Vol 1.60K");
    expect(labels).toContain(
      falling ? "-40.00 (-66.67%) -4,000" : "40.00 (+200.00%) 4,000",
    );
    const layout = Chart.computeLayout(state.config);
    const xs = runtime.xRuntimeCache!.seriesMap.get("price")!;
    const x1 = xs.xFn(5);
    const x2 = xs.xFn(20);
    expect(runtime.measurementHitRegions).toHaveLength(2);
    expect(runtime.measurementHitRegions![0]).toMatchObject({
      x: x1,
      width: x2 - x1,
    });
    const rulerFills = fills.mock.calls.slice(-3);
    expect(rulerFills[0]![0]).toBeCloseTo(x1);
    expect(rulerFills[0]![2]).toBeCloseTo(x2 - x1);
    expect(rulerFills[1]![0]).toBeCloseTo(layout.areaX + layout.areaWidth);
    expect(rulerFills[2]).toEqual([
      x1,
      layout.areaHeight,
      x2 - x1,
      layout.timeAxisHeight,
    ]);
    // Scrolling/zooming repaints a held range through new geometry without changing anchors.
    const anchors = structuredClone(state.measurement);
    ChartStateUtils.setVisibleRange(state, 2, 27);
    repaint(state, runtime, Invalidate.chart(Invalidate.create(), "full"));
    expect(state.measurement).toEqual(anchors);
    expect(runtime.xRuntimeCache!.seriesMap.get("price")!.xFn(5)).not.toBe(x1);
  },
);
