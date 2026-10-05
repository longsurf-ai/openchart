// Purpose: Tests for value tag visibility behavior (adjacency, floating axis overlap, ticker badge)
// Module:  @openchart/chart-core / tests / unit

import { Schema } from "effect";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { repaint, type RuntimeState } from "@openchart/chart-core/v2/paint";
import { Draw } from "@openchart/chart-core/render/draw";
import { RenderCache } from "@openchart/chart-core/render/cache";
import { TextCache } from "@openchart/chart-core/cache/text";
import { LabelCache } from "@openchart/chart-core/cache/label";
import { PrimitiveWrapper } from "@openchart/chart-core/primitive/wrapper";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { ChartConfig } from "@openchart/chart-core/config";
import { ChartAnnotation } from "@openchart/chart-core/annotation";
import { CoordSys } from "@openchart/chart-core/coord";
import { Color } from "@openchart/chart-core/util/color";
import type { Chart } from "@openchart/chart-core/chart/state";

/**
 * Tests for value tag visibility behavior.
 *
 * Covers:
 * 1. Value tags on fixed axes always render (TradingView-style, no adjacency gate).
 * 2. Floating axis + its value tag hide when they would overlap a fixed axis.
 */

// ---------------------------------------------------------------------------
// Mock canvas
// ---------------------------------------------------------------------------

function createMockCtx() {
  const noop = vi.fn();
  const measureText = vi.fn(() => ({ width: 40 }));
  const fillRects: Array<{ style: string; args: unknown[] }> = [];
  let fillStyleValue: string | CanvasGradient | CanvasPattern = "#000";

  const ctx = {
    __fillRects: fillRects,
    canvas: { width: 800, height: 400 },
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    rect: noop,
    roundRect: noop,
    fillRect: vi.fn((...args: unknown[]) => {
      fillRects.push({ style: String(fillStyleValue), args });
    }),
    strokeRect: noop,
    clip: noop,
    clearRect: noop,
    setLineDash: noop,
    arc: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    fillText: noop,
    strokeText: noop,
    measureText,
    setTransform: noop,
    resetTransform: noop,
    scale: noop,
    translate: noop,
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => null),
    drawImage: noop,
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: noop,
    isPointInPath: vi.fn(() => false),
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    miterLimit: 10,
    lineDashOffset: 0,
    font: "12px sans-serif",
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    direction: "ltr" as CanvasDirection,
    strokeStyle: "#000" as string | CanvasGradient | CanvasPattern,
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyleValue = value;
    },
    get fillStyle(): string | CanvasGradient | CanvasPattern {
      return fillStyleValue;
    },
    shadowBlur: 0,
    shadowColor: "rgba(0,0,0,0)",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;

  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers to build a Chart.State that passes assertModelReady
// ---------------------------------------------------------------------------

function makeSeries(
  id: string,
  data: unknown[],
  opts?: {
    type?: string;
    yAxisId?: string;
    parentId?: string;
    options?: Record<string, unknown>;
  },
) {
  return {
    id,
    type: opts?.type ?? "Line",
    yAxisId: opts?.yAxisId ?? "right",
    xAxisId: "main",
    data,
    options: opts?.options ?? {
      color: "#2196F3",
      lineWidth: 2,
      visible: true,
      lastValueVisible: true,
    },
    parentId: opts?.parentId,
  };
}

function makeObject(
  seriesId: string,
  series: ReturnType<typeof makeSeries>,
  paneId = "pane-main",
  axisId = "right",
) {
  return {
    id: seriesId,
    kind: "series" as const,
    paneId,
    seriesId,
    axisId,
    source: "provider" as const,
    comparable: true,
    series,
  };
}

function createChartState(overrides?: {
  rightOffset?: number;
  data?: unknown[];
  extraSeries?: Array<{
    id: string;
    data: unknown[];
    yAxisId?: string;
    type?: string;
    fixed?: boolean;
    visible?: boolean;
  }>;
  focusedSeriesId?: string;
  hoveredSeriesId?: string;
  additionalAxes?: Array<Record<string, unknown>>;
  width?: number;
  session?: Record<string, Chart.SessionInfo>;
}): Chart.State {
  const width = overrides?.width ?? 800;
  const data =
    overrides?.data ??
    Array.from({ length: 100 }, (_, i) => ({ value: 100 + i }));
  const rightOffset = overrides?.rightOffset ?? 0;

  const axes: Record<string, unknown>[] = [
    {
      id: "right",
      side: "right",
      visible: true,
      fixed: true,
      mode: "normal",
      autoScale: true,
      invertScale: false,
      lockZero: false,
      margins: { top: 0.1, bottom: 0.1 },
      style: {
        borderVisible: true,
        borderColor: "#2B2B43",
        ticksVisible: true,
        tickSpacing: 50,
      },
      labels: { visible: true, style: "default" },
      valueLine: { visible: true, mode: "partial", style: "dashed" },
    },
  ];

  if (overrides?.additionalAxes) {
    axes.push(...overrides.additionalAxes);
  }

  const config = ChartConfig.create({
    chart: {
      dimensions: { width, height: 400, autoResize: false },
      layout: { background: "#ffffff", textColor: "#191919" },
    },
    yAxis: { axes: axes as never, width: 60 },
    xAxis: {
      visible: true,
      activeId: "main",
      axes: [
        {
          id: "main",
          mode: "ordinal",
          visible: true,
          field: "time",
          spacing: {
            barSpacing: 6,
            minBarSpacing: 0.5,
            maxBarSpacing: 50,
            rightOffset,
          },
        },
      ],
    },
    series: {
      defaults: {
        valueLine: {
          visible: true,
          showWhenAdjacent: false,
          style: "dashed",
          width: 1,
        },
      },
    },
  });

  const mainSeries = makeSeries("main", data);
  const objectIds = ["main"];
  const objects: Record<string, unknown> = {
    main: makeObject("main", mainSeries),
  };

  for (const extra of overrides?.extraSeries ?? []) {
    const s = makeSeries(extra.id, extra.data, {
      type: extra.type,
      yAxisId: extra.yAxisId ?? extra.id,
      options: {
        color: "#ff0000",
        lineWidth: 2,
        visible: true,
        lastValueVisible: true,
      },
    });
    objects[extra.id] = makeObject(
      extra.id,
      s,
      "pane-main",
      extra.yAxisId ?? extra.id,
    );
    objectIds.push(extra.id);
  }

  return {
    id: "test-chart",
    schemaVersion: 3,
    config,
    panes: [
      {
        id: "pane-main",
        index: 0,
        height: 370,
        objectIds,
      },
    ],
    objects,
    indicators: {},
    annotations: [],
    crosshair: { visible: false },
    visibleRanges: {},
    drawings: { toolLocked: false },
    focusedSeriesId: overrides?.focusedSeriesId,
    hoveredSeriesId: overrides?.hoveredSeriesId,
    session: overrides?.session,
  } as unknown as Chart.State;
}

function createRuntime(ctx: CanvasRenderingContext2D): RuntimeState {
  return {
    canvas: {
      width: 800,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement,
    ctx,
    ratio: 1,
    textCache: TextCache.create(),
    labelCache: LabelCache.create(),
    renderCache: RenderCache.create(),
    xCache: { positions: [], version: 0, offset: 0 },
    panePrimitives: PrimitiveWrapper.createPane(),
    seriesPrimitives: new Map(),
    disposed: false,
  };
}

function fullMask(): Invalidate.Mask {
  return Invalidate.chart(Invalidate.create(), "full");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Value tag visibility on pan", () => {
  let valueTagSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    valueTagSpy = vi.spyOn(Draw, "valueTag");
  });

  afterEach(() => {
    valueTagSpy.mockRestore();
  });

  describe("fixed-axis value tag adjacency (isAdjacent check)", () => {
    it("draws value tag when last data point is adjacent to right edge (no pan)", () => {
      const ctx = createMockCtx();
      const state = createChartState({ rightOffset: 0 });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      expect(valueTagSpy).toHaveBeenCalled();
    });

    it("always shows value tag even when chart is panned far right (TradingView-style)", () => {
      const ctx = createMockCtx();
      const state = createChartState({ rightOffset: 200 });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      // Value tag is now always visible regardless of adjacency (TradingView-style).
      expect(valueTagSpy).toHaveBeenCalled();
    });

    it("draws value tag when rightOffset is small (still adjacent)", () => {
      const ctx = createMockCtx();
      // With barSpacing=6, a rightOffset of 3 keeps lastX within one bar-spacing of the right edge
      const state = createChartState({ rightOffset: 3 });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      expect(valueTagSpy).toHaveBeenCalled();
    });
  });

  describe("floating axis overlap with fixed axis (wouldOverlapFixed check)", () => {
    it("does not draw floating value tag when floating axis overlaps fixed axis", () => {
      const ctx = createMockCtx();
      // Create a secondary series on a floating (non-fixed) axis
      const compareData = Array.from({ length: 100 }, (_, i) => ({
        value: 200 + i,
      }));
      const state = createChartState({
        rightOffset: 0,
        extraSeries: [
          {
            id: "compare",
            data: compareData,
            yAxisId: "compare",
            type: "Line",
            fixed: false,
            visible: false,
          },
        ],
        focusedSeriesId: "compare",
        additionalAxes: [
          {
            id: "compare",
            side: "right",
            visible: false,
            fixed: false,
            mode: "normal",
            autoScale: true,
            invertScale: false,
            lockZero: false,
            margins: { top: 0.1, bottom: 0.1 },
            style: {
              borderVisible: false,
              borderColor: "#2B2B43",
              ticksVisible: false,
              tickSpacing: 50,
            },
            labels: { visible: true, style: "default" },
            valueLine: { visible: true, mode: "partial", style: "dashed" },
          },
        ],
      });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      // When rightOffset=0, the last data point is at the right edge.
      // The floating axis anchor = lastX + 56 (FLOATING_AXIS_ANCHOR_GAP_PX).
      // Since lastX is near rightEdge, axisX will clamp to maxAxisX (near the fixed axis).
      // With a right fixed axis present, wouldOverlapFixed = true,
      // so the floating value tag should NOT be drawn.
      //
      // The main series value tag should still be drawn (adjacent to axis).
      // Since wouldOverlapFixed prevents any floating tag, the overlay array is empty.
      expect(runtime.floatingAxisOverlays).toEqual([]);
    });

    it("creates floating overlay when data is far from the fixed axis (no overlap)", () => {
      const ctx = createMockCtx();
      // Use a wide chart with data that ends far from the right edge.
      // With rightOffset=400 and barSpacing=6, the last data point is pushed ~400px
      // left of the right edge, so the floating axis anchor (lastX + 56) is well
      // below maxAxisX. wouldOverlapFixed should be false.
      const compareData = Array.from({ length: 200 }, (_, i) => ({
        value: 200 + i,
      }));
      const state = createChartState({
        rightOffset: 400,
        width: 1200,
        extraSeries: [
          {
            id: "compare",
            data: compareData,
            yAxisId: "compare",
            type: "Line",
            fixed: false,
            visible: false,
          },
        ],
        focusedSeriesId: "compare",
        additionalAxes: [
          {
            id: "compare",
            side: "right",
            visible: false,
            fixed: false,
            mode: "normal",
            autoScale: true,
            invertScale: false,
            lockZero: false,
            margins: { top: 0.1, bottom: 0.1 },
            style: {
              borderVisible: false,
              borderColor: "#2B2B43",
              ticksVisible: false,
              tickSpacing: 50,
            },
            labels: { visible: true, style: "default" },
            valueLine: { visible: true, mode: "partial", style: "dashed" },
          },
        ],
      });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      // The floating axis should be positioned far from the fixed axis,
      // so wouldOverlapFixed is false and the overlay should be created.
      const overlays = runtime.floatingAxisOverlays ?? [];
      expect(overlays.length).toBeGreaterThan(0);
    });
  });
});

describe("value tag text fitting", () => {
  it("expands right-axis tags leftward when the formatted price is wider than the axis", () => {
    const ctx = createMockCtx();
    (ctx.measureText as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (text) => ({
        width: String(text) === "76,449.00" ? 76 : 40,
      }),
    );

    Draw.valueTag(
      ctx,
      120,
      "76,449.00",
      100,
      60,
      "right",
      "#2b8a6e",
      "#ffffff",
      "12px sans-serif",
    );

    expect(ctx.fillText).toHaveBeenCalledWith("76,449.00", 76, 120);
  });
});

describe("Value tag adjacency edge cases", () => {
  let valueTagSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    valueTagSpy = vi.spyOn(Draw, "valueTag");
  });

  afterEach(() => {
    valueTagSpy.mockRestore();
  });

  it("always shows value tag even with bar-spacing gap (TradingView-style)", () => {
    const ctx = createMockCtx();
    // barSpacing is 6. rightOffset of 7 puts last bar just over one bar-spacing from the edge.
    // Value tag should still render since we removed the adjacency gate.
    const state = createChartState({ rightOffset: 7 });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).toHaveBeenCalled();
  });

  it("draws value tag for single-point data at right edge", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      rightOffset: 0,
      data: [{ value: 100 }],
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).toHaveBeenCalled();
  });

  it("no floating overlays when no floating axis is focused", () => {
    const ctx = createMockCtx();
    const state = createChartState({ rightOffset: 0 });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    // Without a focused floating series, no overlays should be pushed
    expect(runtime.floatingAxisOverlays).toEqual([]);
  });
});

describe("sparse data value tags", () => {
  let valueTagSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    valueTagSpy = vi.spyOn(Draw, "valueTag");
  });

  afterEach(() => {
    valueTagSpy.mockRestore();
  });

  it("renders value tag when data has trailing undefined entries", () => {
    const ctx = createMockCtx();
    // Simulate compare series: 80 valid points + 20 trailing undefined entries
    const sparseData: unknown[] = Array.from({ length: 80 }, (_, i) => ({
      value: 50 + i,
    }));
    for (let i = 0; i < 20; i++) sparseData.push(undefined);

    const state = createChartState({
      extraSeries: [{ id: "compare", data: sparseData, yAxisId: "right" }],
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    // Value tag should be drawn for BOTH main and compare series
    expect(valueTagSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("renders value tag when extra series has fewer data points than main", () => {
    const ctx = createMockCtx();
    // Main has 100 points, compare has only 60 — shorter array, no undefined padding
    const shortData = Array.from({ length: 60 }, (_, i) => ({
      value: 200 + i,
    }));

    const state = createChartState({
      extraSeries: [{ id: "compare", data: shortData, yAxisId: "right" }],
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("skips value tag when series data is entirely empty", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      extraSeries: [{ id: "compare", data: [], yAxisId: "right" }],
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    // Main series value tag should still render, but empty series should not
    expect(valueTagSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    // With only 1 valid series, exactly 1 value tag call is expected
    expect(valueTagSpy.mock.calls.length).toBe(1);
  });
});

describe("Series price line overrides", () => {
  let valueTagSpy: ReturnType<typeof vi.spyOn>;
  let dashedLineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    valueTagSpy = vi.spyOn(Draw, "valueTag");
    dashedLineSpy = vi.spyOn(Draw, "dashedLine");
  });

  afterEach(() => {
    valueTagSpy.mockRestore();
    dashedLineSpy.mockRestore();
  });

  it("draws the price line even when the last value tag is hidden", () => {
    const ctx = createMockCtx();
    const state = createChartState({ rightOffset: 20 });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = {
      ...main.series.options,
      lastValueVisible: false,
      valueLineVisible: true,
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).not.toHaveBeenCalled();
    expect(dashedLineSpy).toHaveBeenCalled();
  });

  it("uses series-specific price line style and color overrides", () => {
    const ctx = createMockCtx();
    const state = createChartState({ rightOffset: 20 });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = {
      ...main.series.options,
      valueLineVisible: true,
      valueLineStyle: "dotted",
      valueLineColor: "#ff00aa",
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(dashedLineSpy).toHaveBeenCalledWith(
      ctx,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      "#ff00aa",
      [2, 2],
    );
  });

  it("uses series-specific price line mode overrides", () => {
    const ctx = createMockCtx();
    const state = createChartState({ rightOffset: 20 });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = {
      ...main.series.options,
      valueLineVisible: true,
      valueLineMode: "off",
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(dashedLineSpy).not.toHaveBeenCalled();
  });

  it("uses series-specific last value colors", () => {
    const ctx = createMockCtx();
    const state = createChartState({ rightOffset: 20 });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = {
      ...main.series.options,
      lastValueTagColor: "#112233",
      lastValueTextColor: "#f8fafc",
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).toHaveBeenCalledWith(
      ctx,
      expect.any(Number),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      "#112233",
      "#f8fafc",
      expect.any(String),
      undefined,
      expect.any(Number),
    );
  });

  it("uses semibold text for hovered last value labels", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      rightOffset: 20,
      hoveredSeriesId: "main",
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const call = valueTagSpy.mock.calls.find((item) => item[2] === "199.00");
    expect(call?.[7]).toBe(Color.contrast(Color.salient("#2196F3")));
    expect(call?.[8]).toMatch(/^600 /);
  });

  it("colors candlestick last value tags from the latest candle direction", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      rightOffset: 20,
      data: [
        { time: 1, open: 100, high: 104, low: 99, close: 103 },
        { time: 2, open: 103, high: 104, low: 99, close: 100 },
      ],
    });
    const main = state.objects.main as {
      series: { type: string; options: Record<string, unknown> };
    };
    main.series.type = "Candlestick";
    main.series.options = {
      ...main.series.options,
      upColor: "#26a69a",
      downColor: "#ef5350",
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).toHaveBeenCalledWith(
      ctx,
      expect.any(Number),
      "100.00",
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      Color.salient("#ef5350"),
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(Number),
    );
  });

  it("draws volume last value tag on the hidden volume axis without a price line", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      rightOffset: 20,
      additionalAxes: [
        {
          id: "volume",
          side: "right",
          visible: false,
          fixed: true,
          mode: "normal",
          autoScale: true,
          invertScale: false,
          lockZero: true,
          margins: { top: 0.75, bottom: 0 },
          style: {
            borderVisible: true,
            borderColor: "#2B2B43",
            ticksVisible: true,
            tickSpacing: 50,
          },
          labels: { visible: true, style: "default" },
          valueLine: { visible: true, mode: "partial", style: "dashed" },
        },
      ],
      extraSeries: [
        {
          id: "volume",
          type: "Histogram",
          yAxisId: "volume",
          data: Array.from({ length: 100 }, (_, i) => ({ value: 1000 + i })),
        },
      ],
    });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = {
      ...main.series.options,
      lastValueVisible: false,
      valueLineVisible: false,
    };
    const volume = state.objects.volume as {
      series: { parentId?: string; options: Record<string, unknown> };
    };
    volume.series.options = {
      ...volume.series.options,
      title: "Volume",
      lastValueVisible: true,
      valueLineVisible: false,
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).toHaveBeenCalledTimes(1);
    expect(dashedLineSpy).not.toHaveBeenCalled();
  });

  it("keeps fractional crypto volume visible in the volume last value tag", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      rightOffset: 20,
      additionalAxes: [
        {
          id: "volume",
          side: "right",
          visible: false,
          fixed: true,
          mode: "normal",
          autoScale: true,
          invertScale: false,
          lockZero: true,
          margins: { top: 0.75, bottom: 0 },
          style: {
            borderVisible: true,
            borderColor: "#2B2B43",
            ticksVisible: true,
            tickSpacing: 50,
          },
          labels: { visible: true, style: "default" },
          valueLine: { visible: true, mode: "partial", style: "dashed" },
        },
      ],
      extraSeries: [
        {
          id: "volume",
          type: "Histogram",
          yAxisId: "volume",
          data: Array.from({ length: 100 }, (_, i) => ({
            close: 329,
            high: 340,
            low: 300,
            volume: i === 99 ? 0.00003957 : 0.00001,
          })),
        },
      ],
    });
    (state.objects.volume as Chart.SeriesObject).series.fieldMap = {
      value: "volume",
    };
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = {
      ...main.series.options,
      lastValueVisible: false,
      valueLineVisible: false,
    };
    const volume = state.objects.volume as {
      series: { parentId?: string; options: Record<string, unknown> };
    };
    volume.series.options = {
      ...volume.series.options,
      title: "Volume",
      lastValueVisible: true,
      valueLineVisible: false,
    };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    expect(valueTagSpy).toHaveBeenCalledWith(
      ctx,
      expect.any(Number),
      "0.00003957",
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(Number),
    );
  });
});

describe("Extended-session value tags", () => {
  let valueTagSpy: ReturnType<typeof vi.spyOn>;
  let tickerBadgeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    valueTagSpy = vi.spyOn(Draw, "valueTag");
    tickerBadgeSpy = vi.spyOn(Draw, "tickerBadge");
  });

  afterEach(() => {
    valueTagSpy.mockRestore();
    tickerBadgeSpy.mockRestore();
  });

  it("uses the regular-session close for the main pill during post-market", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      data: Array.from({ length: 100 }, (_, i) => ({ value: 190 + i * 0.2 })),
      session: {
        main: {
          phase: "post",
          nextCloseAt: Math.floor(Date.now() / 1000) + 3600,
          regularClose: 201.25,
          extendedPrice: 206.75,
          extendedLabel: "Post",
        },
      },
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const labels = valueTagSpy.mock.calls.map((call) => call[2]);
    expect(labels).toContain("201.25");
    expect(labels).toContain("206.75");
    expect(labels).not.toContain("209.80");
    const mainCall = valueTagSpy.mock.calls.find(
      (call) => call[2] === "201.25",
    );
    const postCall = valueTagSpy.mock.calls.find(
      (call) => call[2] === "206.75",
    );
    expect(mainCall?.[9]).toBeUndefined();
    expect(postCall?.[9]).toMatch(/^(59:|01:00:)/);
  });

  it("aligns the ticker badge against the actual single-line tag width", () => {
    const ctx = createMockCtx();
    vi.mocked(ctx.measureText).mockImplementation((text) => {
      const value = String(text);
      const width = value === "AAPL" ? 32 : value.includes(":") ? 96 : 40;
      return { width } as TextMetrics;
    });
    const state = createChartState({
      data: Array.from({ length: 100 }, (_, i) => ({ value: 190 + i * 0.2 })),
      session: {
        main: {
          phase: "post",
          nextCloseAt: Math.floor(Date.now() / 1000) + 3600,
          regularClose: 201.25,
          extendedPrice: 206.75,
          extendedLabel: "Post",
        },
      },
    });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = { ...main.series.options, title: "AAPL" };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const tagCall = valueTagSpy.mock.calls.find((call) => call[2] === "201.25");
    const postTagCall = valueTagSpy.mock.calls.find(
      (call) => call[2] === "206.75",
    );
    const badgeCall = tickerBadgeSpy.mock.calls.find(
      (call) => call[2] === "AAPL",
    );
    const postBadgeCall = tickerBadgeSpy.mock.calls.find(
      (call) => call[2] === "Post",
    );
    expect(tagCall).toBeTruthy();
    expect(postTagCall).toBeTruthy();
    expect(badgeCall).toBeTruthy();
    expect(postBadgeCall).toBeTruthy();

    const axisX = tagCall![3] as number;
    const axisWidth = tagCall![4] as number;
    const tagWidth = tagCall![10] as number;
    const postTagWidth = postTagCall![10] as number;
    const tagStart = axisX + axisWidth - tagWidth;
    const postTagStart = axisX + axisWidth - postTagWidth;
    const badgeRight = (badgeCall![3] as number) + (badgeCall![4] as number);
    const postBadgeRight =
      (postBadgeCall![3] as number) + (postBadgeCall![4] as number);

    expect(tagWidth).toBe(postTagWidth);
    expect(tagStart).toBe(postTagStart);
    expect(badgeRight).toBe(tagStart - Draw.TICKER_BADGE_GAP);
    expect(postBadgeRight).toBe(tagStart - Draw.TICKER_BADGE_GAP);
  });

  it("shows the countdown target even when the session open is known", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T20:32:43Z"));
    try {
      const ctx = createMockCtx();
      const state = createChartState({
        data: Array.from({ length: 100 }, (_, i) => ({ value: 190 + i * 0.2 })),
        session: {
          main: {
            phase: "post",
            currentSessionOpenAt: Date.parse("2026-05-06T20:00:00Z") / 1000,
            nextCloseAt: Date.parse("2026-05-06T20:33:43Z") / 1000,
            regularClose: 201.25,
            extendedPrice: 206.75,
            extendedLabel: "Post",
          },
        },
      });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      const postCall = valueTagSpy.mock.calls.find(
        (call) => call[2] === "206.75",
      );
      expect(postCall?.[9]).toBe("01:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the countdown on the primary tag when no secondary extended-session tag exists", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T20:32:43Z"));
    try {
      const ctx = createMockCtx();
      const state = createChartState({
        data: Array.from({ length: 100 }, (_, i) => ({ value: 190 + i * 0.2 })),
        session: {
          main: {
            phase: "post",
            nextCloseAt: Date.parse("2026-05-06T20:33:43Z") / 1000,
          },
        },
      });
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      const labels = valueTagSpy.mock.calls.map((call) => call[2]);
      expect(labels).toContain("209.80");
      expect(labels).not.toContain("201.25");
      expect(labels).not.toContain("206.75");
      const primaryCall = valueTagSpy.mock.calls.find(
        (call) => call[2] === "209.80",
      );
      expect(primaryCall?.[9]).toBe("01:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the main and post pills in stable order when prices converge", () => {
    const ctx = createMockCtx();
    const state = createChartState({
      data: Array.from({ length: 100 }, (_, i) => ({ value: 190 + i * 0.2 })),
      session: {
        main: {
          phase: "post",
          regularClose: 200,
          extendedPrice: 200.02,
          extendedLabel: "Post",
        },
      },
    });
    const main = state.objects.main as {
      series: { options: Record<string, unknown> };
    };
    main.series.options = { ...main.series.options, title: "AAPL" };
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const badges = tickerBadgeSpy.mock.calls.map((call) => ({
      y: call[1] as number,
      label: call[2],
    }));
    const mainBadge = badges.find((badge) => badge.label === "AAPL");
    const postBadge = badges.find((badge) => badge.label === "Post");

    expect(mainBadge).toBeTruthy();
    expect(postBadge).toBeTruthy();
    expect(mainBadge!.y).toBeLessThan(postBadge!.y);
  });
});

describe("Extended-session background bands", () => {
  it("uses distinct tints for pre-market and post-market ranges", () => {
    const ctx = createMockCtx() as CanvasRenderingContext2D & {
      __fillRects: Array<{ style: string; args: unknown[] }>;
    };
    const state = createChartState({
      data: [
        { value: 100, sessionType: "pre" },
        { value: 101, sessionType: "pre" },
        { value: 102, sessionType: "regular" },
        { value: 103, sessionType: "regular" },
        { value: 104, sessionType: "post" },
        { value: 105, sessionType: "post" },
      ],
      rightOffset: 12,
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const styles = ctx.__fillRects.map((rect) => rect.style);
    expect(styles).toContain("rgba(41, 98, 255, 0.075)");
    expect(styles).toContain("rgba(255, 167, 38, 0.09)");
  });

  it("extends the active post-market band through the session close", () => {
    const ctx = createMockCtx() as CanvasRenderingContext2D & {
      __fillRects: Array<{ style: string; args: unknown[] }>;
    };
    const state = createChartState({
      data: [
        { time: 1000, value: 100, sessionType: "regular" },
        { time: 1900, value: 101, sessionType: "post" },
        { time: 2800, value: 102, sessionType: "post" },
      ],
      session: {
        main: {
          phase: "post",
          currentSessionOpenAt: 1900,
          nextCloseAt: 5500,
        },
      },
      rightOffset: 12,
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const postWidths = ctx.__fillRects
      .filter((rect) => rect.style === "rgba(255, 167, 38, 0.09)")
      .map((rect) => Number(rect.args[2]))
      .filter((width) => Number.isFinite(width) && width > 0);

    expect(postWidths).toHaveLength(1);
    expect(postWidths[0]).toBeGreaterThan(12);
  });

  it("anchors historical bands to visible bars instead of missing calendar time", () => {
    const ctx = createMockCtx() as CanvasRenderingContext2D & {
      __fillRects: Array<{ style: string; args: unknown[] }>;
    };
    const state = createChartState({
      data: [
        {
          time: 4000,
          value: 100,
          sessionType: "pre",
          sessionStart: 1000,
          sessionEnd: 5000,
        },
        {
          time: 4060,
          value: 101,
          sessionType: "pre",
          sessionStart: 1000,
          sessionEnd: 5000,
        },
        { time: 5000, value: 102, sessionType: "regular" },
        { time: 5060, value: 103, sessionType: "regular" },
      ],
      rightOffset: 12,
    });
    const runtime = createRuntime(ctx);

    repaint(state, runtime, fullMask());

    const preRect = ctx.__fillRects.find(
      (rect) => rect.style === "rgba(41, 98, 255, 0.075)",
    );

    expect(preRect).toBeTruthy();
    expect(Number(preRect!.args[0])).toBeGreaterThan(0);
    expect(Number(preRect!.args[2])).toBeLessThan(20);
  });
});

describe("Multi-pane value tag rendering", () => {
  let valueTagSpy: ReturnType<typeof vi.spyOn>;
  let dashedLineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    valueTagSpy = vi.spyOn(Draw, "valueTag");
    dashedLineSpy = vi.spyOn(Draw, "dashedLine");
  });

  afterEach(() => {
    valueTagSpy.mockRestore();
    dashedLineSpy.mockRestore();
  });

  it("draws value tag for primary series in a second pane", () => {
    const ctx = createMockCtx();
    const compareData = Array.from({ length: 100 }, (_, i) => ({
      value: 50 + i,
    }));
    const compareSeries = makeSeries("compare", compareData, {
      type: "Line",
      yAxisId: "pane-2:right",
      options: {
        color: "#5b9bd5",
        lineWidth: 2,
        visible: true,
        lastValueVisible: true,
        title: "MSFT",
      },
    });

    const state: Chart.State = {
      id: "test-chart",
      schemaVersion: 3,
      config: ChartConfig.create({
        chart: {
          dimensions: { width: 800, height: 400, autoResize: false },
          layout: { background: "#ffffff", textColor: "#191919" },
        },
        yAxis: {
          axes: [
            {
              id: "right",
              paneId: "pane-main",
              side: "right",
              visible: true,
              fixed: true,
              mode: "normal",
              autoScale: true,
              invertScale: false,
              lockZero: false,
              margins: { top: 0.1, bottom: 0.1 },
              style: {
                borderVisible: true,
                borderColor: "#2B2B43",
                ticksVisible: true,
                tickSpacing: 50,
              },
              labels: { visible: true, style: "default" },
              valueLine: { visible: true, mode: "extended", style: "dotted" },
            },
            {
              id: "pane-2:right",
              paneId: "pane-2",
              side: "right",
              visible: true,
              fixed: true,
              mode: "normal",
              autoScale: true,
              invertScale: false,
              lockZero: false,
              margins: { top: 0.1, bottom: 0.1 },
              style: {
                borderVisible: true,
                borderColor: "#2B2B43",
                ticksVisible: true,
                tickSpacing: 50,
              },
              labels: { visible: true, style: "default" },
              valueLine: { visible: true, mode: "extended", style: "dotted" },
            },
          ] as never,
          width: 60,
        },
        xAxis: {
          visible: true,
          activeId: "main",
          axes: [
            {
              id: "main",
              mode: "ordinal",
              visible: true,
              field: "time",
              spacing: {
                barSpacing: 6,
                minBarSpacing: 0.5,
                maxBarSpacing: 50,
                rightOffset: 0,
              },
            },
          ],
        },
        series: {
          defaults: {
            valueLine: {
              visible: true,
              showWhenAdjacent: false,
              style: "dotted",
              width: 1,
            },
          },
        },
      }),
      panes: [
        { id: "pane-main", index: 0, height: 280, objectIds: ["main"] },
        { id: "pane-2", index: 1, height: 90, objectIds: ["compare"] },
      ],
      objects: {
        main: makeObject(
          "main",
          makeSeries(
            "main",
            Array.from({ length: 100 }, (_, i) => ({ value: 100 + i })),
          ),
          "pane-main",
          "right",
        ),
        compare: makeObject("compare", compareSeries, "pane-2", "pane-2:right"),
      },
      indicators: {},
      annotations: [],
      crosshair: { visible: false },
      visibleRanges: {},
      drawings: { toolLocked: false },
    } as unknown as Chart.State;

    const runtime = createRuntime(ctx);
    repaint(state, runtime, fullMask());

    // Should draw value tags for BOTH the main series and the compare series
    expect(valueTagSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Pane-local crosshair values", () => {
  function createPaneState() {
    const state = createChartState({
      data: [{ time: 1000, value: 300 }],
      extraSeries: [
        {
          id: "compare",
          yAxisId: "compare-axis",
          data: [{ time: 1000, value: 1500 }],
        },
        { id: "rsi", yAxisId: "rsi-axis", data: [{ time: 1000, value: 50 }] },
      ],
      additionalAxes: [
        { id: "compare-axis", paneId: "pane-main", side: "left" },
        { id: "rsi-axis", paneId: "pane-rsi", side: "right" },
      ],
    });
    for (const axis of state.config.yAxis.axes) {
      axis.autoScale = false;
      axis.margins = { top: 0, bottom: 0 };
      axis.visibleExtent =
        axis.id === "right"
          ? { min: 200, max: 400 }
          : axis.id === "rsi-axis"
            ? { min: 0, max: 100 }
            : { min: 1000, max: 2000 };
    }
    return {
      ...state,
      panes: [
        // The declared main series remains primary even when registered last.
        {
          id: "pane-main",
          index: 0,
          height: 200,
          objectIds: ["compare", "main"],
        },
        { id: "pane-rsi", index: 1, height: 100, objectIds: ["rsi"] },
        { id: "pane-empty", index: 2, height: 70, objectIds: [] },
      ],
      objects: {
        ...state.objects,
        main: { ...state.objects.main, role: "main" },
        rsi: { ...state.objects.rsi, paneId: "pane-rsi" },
      },
    } as unknown as Chart.State;
  }

  afterEach(() => vi.restoreAllMocks());

  it.each([
    {
      name: "main pane without focus",
      pane: "pane-main",
      axis: "right",
      value: 300,
    },
    {
      name: "indicator pane without focus",
      pane: "pane-rsi",
      axis: "rsi-axis",
      value: 50,
    },
    {
      name: "main pane with RSI locked",
      pane: "pane-main",
      axis: "right",
      value: 300,
      locked: "rsi",
    },
    {
      name: "indicator pane with main locked",
      pane: "pane-rsi",
      axis: "rsi-axis",
      value: 50,
      locked: "main",
    },
    {
      name: "comparison selected within the pane",
      pane: "pane-main",
      axis: "compare-axis",
      value: 1500,
      locked: "compare",
    },
    {
      name: "comparison hovered while another pane is locked",
      pane: "pane-main",
      axis: "compare-axis",
      value: 1500,
      locked: "rsi",
      hovered: "compare",
    },
  ])(
    "uses the owning scale for $name, independent of axis order",
    ({ pane, axis, value, locked, hovered }) => {
      const tag = vi.spyOn(Draw, "crosshairYTag");
      const state = createPaneState();
      state.lockedSeriesId = locked;
      state.hoveredSeriesId = hovered;
      const runtime = createRuntime(createMockCtx());
      for (const reverse of [false, true]) {
        if (reverse) state.config.yAxis.axes.reverse();
        state.crosshair = { visible: false };
        repaint(state, runtime, fullMask());
        const y = CoordSys.toPixel(value, runtime.coord!.scales.y[axis]!);
        state.crosshair = { visible: true, paneId: pane, x: 200, y };
        tag.mockClear();
        repaint(state, runtime, Invalidate.chart(Invalidate.create(), "light"));
        expect(tag).toHaveBeenCalledOnce();
        const [, tagY, label] = tag.mock.calls[0]!;
        expect(tagY).toBeCloseTo(y);
        expect(Number(label.replaceAll(",", ""))).toBeCloseTo(value, 2);
      }
    },
  );

  it.each(["pane-empty", undefined])(
    "omits the Y label without an owned axis (pane = %s)",
    (paneId) => {
      const tag = vi.spyOn(Draw, "crosshairYTag");
      const state = createPaneState();
      state.lockedSeriesId = "main";
      state.crosshair = { visible: true, paneId, x: 200, y: 340 };
      repaint(state, createRuntime(createMockCtx()), fullMask());
      expect(tag).not.toHaveBeenCalled();
    },
  );
});

describe("annotation raw-price mode projection", () => {
  it.each(["percentage", "indexed"] as const)(
    "projects a raw candle anchor through %s mode",
    (mode) => {
      const ctx = createMockCtx();
      const candles = [
        {
          time: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
          open: 52_000,
          high: 54_000,
          low: 51_500,
          close: 53_720.2,
        },
        {
          time: Date.parse("2026-07-02T00:00:00.000Z") / 1000,
          open: 56_000,
          high: 60_000,
          low: 54_500,
          close: 58_000,
        },
        {
          time: Date.parse("2026-07-03T00:00:00.000Z") / 1000,
          open: 57_000,
          high: 59_000,
          low: 55_000,
          close: 58_500,
        },
      ];
      const state = createChartState({ data: candles });
      const main = state.objects.main as {
        series: { type: string; options: Record<string, unknown> };
      };
      main.series.type = "Candlestick";
      main.series.options = {
        ...main.series.options,
        upColor: "#26a69a",
        downColor: "#ef5350",
      };
      state.config.yAxis.axes[0]!.mode = mode;
      state.annotations = [
        Schema.decodeUnknownSync(ChartAnnotation.Record)({
          id: "annotation_1",
          userId: "user_1",
          dashboardId: "dashboard_1",
          market: ProviderListing.parse({
            provider: "test",
            listing: { symbol: "AAPL", currency: "USD" },
          }),
          eventId: "event_1",
          label: "BTC mode projection",
          sentiment: 0,
          priorityScore: 0,
          anchor: { start: candles[1]!.time },
          style: {},
          visibility: "visible",
          revision: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
          deletedAt: null,
        }),
      ];
      const runtime = createRuntime(ctx);

      repaint(state, runtime, fullMask());

      const placement = runtime.annotationPlacements?.[0];
      expect(runtime.annotationPlacements).toHaveLength(1);
      expect(placement).toBeDefined();
      const targetY = placement!.leader.to.y;
      expect(targetY).toBeGreaterThanOrEqual(0);
      expect(targetY).toBeLessThanOrEqual(runtime.coord!.bounds.height);

      const baseline = candles[0]!.close;
      const transform = (raw: number) =>
        mode === "percentage"
          ? (raw / baseline - 1) * 100
          : (raw / baseline) * 100;
      const yScale = runtime.coord!.scales.y.right!;
      const highY = CoordSys.toPixel(transform(candles[1]!.high), yScale);
      const lowY = CoordSys.toPixel(transform(candles[1]!.low), yScale);
      expect(
        Math.min(Math.abs(targetY - highY), Math.abs(targetY - lowY)),
      ).toBeCloseTo(7, 6);
    },
  );
});
