// Purpose: Tests for event-driven canvas pan behavior across panes and axes
// Module:  @openchart/chart-core / v2 / api

import { Schema } from "effect";
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Bus, ChartEvent } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import { CoordSys, createCartesian2D } from "@openchart/chart-core/coord";
import { Drawing } from "@openchart/chart-core/drawing";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { setupEvents, type RuntimeState } from "./events";
import { getAxis, ordinalIndexToX } from "@openchart/chart-core/v2/x-scale";

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  return canvas;
}

function paneBoundaryY(state: Chart.State, topPaneIndex: number): number {
  const layout = Chart.computeLayout(state.config);
  const panes = state.panes;
  const sum = panes.reduce((acc, pane) => acc + Math.max(1, pane.height), 0);
  let cursorY = 0;
  for (let i = 0; i < panes.length; i += 1) {
    const pane = panes[i]!;
    const isLast = i === panes.length - 1;
    const paneHeight = isLast
      ? Math.max(0, layout.areaHeight - cursorY)
      : Math.max(0, (Math.max(1, pane.height) / sum) * layout.areaHeight);
    if (i === topPaneIndex) return cursorY + paneHeight;
    cursorY += paneHeight;
  }
  return cursorY;
}

function createChartExplainDragScenario(input?: { toolLocked?: boolean }) {
  const state = createState({
    id: "chart",
    series: {
      main: {
        type: "Line",
        data: Array.from({ length: 10 }, (_, index) => ({
          time: 1_700_000_000 + index * 86_400,
          value: 100 + index,
        })),
      },
    },
  });
  state.drawings.activeTool = "agent_session";
  state.drawings.toolLocked = input?.toolLocked ?? false;

  const canvas = createCanvas();
  const layout = Chart.computeLayout(state.config);
  const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
  const series = ChartStateUtils.getSeries(state, "main");
  const dataLength = series?.data.length ?? 0;
  const x1 =
    layout.areaX +
    ordinalIndexToX(state.config, axis, layout.areaWidth, dataLength, 1);
  const x5 =
    layout.areaX +
    ordinalIndexToX(state.config, axis, layout.areaWidth, dataLength, 5);
  const runtime: RuntimeState = {
    canvas,
    ctx: {} as CanvasRenderingContext2D,
    ratio: 1,
    textCache: {} as RuntimeState["textCache"],
    labelCache: {} as RuntimeState["labelCache"],
    renderCache: {} as RuntimeState["renderCache"],
    xCache: { positions: [], version: 0, offset: 0 },
    panePrimitives: {} as RuntimeState["panePrimitives"],
    seriesPrimitives: new Map(),
    disposed: false,
  };

  let autoClearCount = 0;
  const ranges: unknown[] = [];
  const unsubscribe = Bus.subscribe(ChartEvent.ChartExplainRange, (event) => {
    ranges.push(event);
  });
  const dispose = setupEvents({
    canvas,
    getState: () => state,
    setState: (mutator) => mutator(state),
    getRuntime: () => runtime,
    scheduleRender: () => {},
    onDrawingToolAutoClear: () => {
      autoClearCount += 1;
    },
  });

  const startRange = () => {
    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: x1,
        clientY: 160,
        bubbles: true,
        buttons: 1,
      }),
    );
  };
  const moveRange = () => {
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: x5,
        clientY: 160,
        bubbles: true,
        buttons: 1,
      }),
    );
  };
  const endRange = (clientX = x5) => {
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX,
        clientY: 160,
        bubbles: true,
        buttons: 0,
      }),
    );
  };

  return {
    state,
    canvas,
    x1,
    ranges,
    startRange,
    moveRange,
    endRange,
    dragRange: () => {
      startRange();
      moveRange();
      endRange();
    },
    dispose,
    cleanup: () => {
      dispose();
      unsubscribe();
    },
    autoClearCount: () => autoClearCount,
  };
}

describe("setupEvents", () => {
  it.each([
    ["Line", "Line", "Histogram"],
    ["Histogram", "Line", "Line"],
  ])(
    "keeps a mixed study axis interactive when %s mounts first",
    (...types) => {
      const state = createState({
        series: { main: { type: "Line", data: [{ time: 1, value: 100 }] } },
      });
      for (const type of types) {
        ChartStateUtils.addSeries(state, {
          type,
          pane: 1,
          yAxisId: "macd",
          data: [{ time: 1, value: 2 }],
        });
      }
      // The reported failure occurs in a middle pane, not the chart footer.
      ChartStateUtils.addSeries(state, { type: "Line", pane: 2 });
      expect(Chart.getAxis(state, "macd")).toMatchObject({
        visible: true,
        fixed: true,
        lockZero: false,
      });
      const canvas = createCanvas();
      const runtime: RuntimeState = {
        canvas,
        ctx: {} as CanvasRenderingContext2D,
        ratio: 1,
        textCache: {} as RuntimeState["textCache"],
        labelCache: {} as RuntimeState["labelCache"],
        renderCache: {} as RuntimeState["renderCache"],
        xCache: { positions: [], version: 0, offset: 0 },
        panePrimitives: {} as RuntimeState["panePrimitives"],
        seriesPrimitives: new Map(),
        disposed: false,
      };
      const cleanup = setupEvents({
        canvas,
        getState: () => state,
        setState: (mutator) => mutator(state),
        getRuntime: () => runtime,
        scheduleRender: () => {},
      });
      try {
        const layout = Chart.computeLayout(state.config);
        const point = {
          clientX:
            layout.areaX + layout.areaWidth + state.config.yAxis.width / 2,
          clientY: (paneBoundaryY(state, 0) + paneBoundaryY(state, 1)) / 2,
          bubbles: true,
        };
        canvas.dispatchEvent(new MouseEvent("mousemove", point));
        expect(state.hoveredAxisId).toBe("macd");
        canvas.dispatchEvent(new MouseEvent("contextmenu", point));
        expect(state.yAxisContextMenu).toMatchObject({
          axisId: "macd",
          floating: false,
        });
      } finally {
        cleanup();
      }
    },
  );

  it("keeps the Chart Explain draft color stable in the published range event", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: Array.from({ length: 10 }, (_, index) => ({
            time: 1_700_000_000 + index * 86_400,
            value: 100 + index,
          })),
        },
      },
    });
    state.drawings.activeTool = "agent_session";

    const canvas = createCanvas();
    const layout = Chart.computeLayout(state.config);
    const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
    const series = ChartStateUtils.getSeries(state, "main");
    const dataLength = series?.data.length ?? 0;
    const x1 =
      layout.areaX +
      ordinalIndexToX(state.config, axis, layout.areaWidth, dataLength, 1);
    const x5 =
      layout.areaX +
      ordinalIndexToX(state.config, axis, layout.areaWidth, dataLength, 5);
    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    let publishedColor: string | undefined;
    const unsubscribe = Bus.subscribe<{ color?: string }>(
      ChartEvent.ChartExplainRange,
      (event) => {
        publishedColor = event.color;
      },
    );
    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: x1,
        clientY: 160,
        bubbles: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: x5,
        clientY: 160,
        bubbles: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: x5,
        clientY: 160,
        bubbles: true,
        buttons: 0,
      }),
    );

    expect(publishedColor).toBe("174 86% 62%");
    expect(state.chartExplain?.draftBand?.color).toBe(publishedColor);

    unsubscribe();
    cleanup();
    Bus.clear();
  });

  it("commits the held preview before publishing and preserves synchronous host cleanup", () => {
    const scenario = createChartExplainDragScenario();
    let preview: NonNullable<Chart.State["chartExplain"]>["draftBand"];
    const unsubscribe = Bus.subscribe(ChartEvent.ChartExplainRange, () => {
      preview = scenario.state.chartExplain?.draftBand;
      delete scenario.state.chartExplain?.draftBand;
    });

    scenario.dragRange();

    expect(preview).toMatchObject({
      mode: "annotating",
      color: "174 86% 62%",
      tStart: expect.any(Number),
      tEnd: expect.any(Number),
      startedAtMs: expect.any(Number),
    });
    expect(scenario.state.chartExplain?.draftBand).toBeUndefined();

    unsubscribe();
    scenario.cleanup();
    Bus.clear();
  });

  it("auto-clears the range drawing tool after completion when sticky tools are off", () => {
    const scenario = createChartExplainDragScenario({ toolLocked: false });

    scenario.dragRange();

    expect(scenario.state.drawings.activeTool).toBeNull();
    expect(scenario.state.chartExplain?.draftBand?.mode).toBe("annotating");
    expect(scenario.autoClearCount()).toBe(1);

    scenario.cleanup();
    Bus.clear();
  });

  it("keeps the range drawing tool selected after completion when sticky tools are on", () => {
    const scenario = createChartExplainDragScenario({ toolLocked: true });

    scenario.dragRange();

    expect(scenario.state.drawings.activeTool).toBe("agent_session");
    expect(scenario.state.chartExplain?.draftBand?.mode).toBe("annotating");
    expect(scenario.autoClearCount()).toBe(0);

    scenario.cleanup();
    Bus.clear();
  });

  it("keeps the range tool selected without publishing an incomplete selection", () => {
    const scenario = createChartExplainDragScenario();

    scenario.startRange();
    scenario.endRange(scenario.x1 + 2);

    expect(scenario.state.drawings.activeTool).toBe("agent_session");
    expect(scenario.state.chartExplain?.draftBand).toBeUndefined();
    expect(scenario.ranges).toHaveLength(0);
    expect(scenario.autoClearCount()).toBe(0);

    scenario.cleanup();
    Bus.clear();
  });

  it.each(["selected", "dragging", "completed"])(
    "cancels the %s range tool with Escape and detaches its drag",
    (phase) => {
      const scenario = createChartExplainDragScenario({ toolLocked: true });
      if (phase === "dragging") scenario.startRange();
      if (phase === "completed") scenario.dragRange();
      const completedCount = scenario.ranges.length;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      scenario.moveRange();
      scenario.endRange();

      expect(scenario.state.drawings.activeTool).toBeNull();
      expect(scenario.state.chartExplain?.draftBand).toBeUndefined();
      expect(scenario.canvas.style.cursor).toBe("default");
      expect(scenario.ranges).toHaveLength(completedCount);

      scenario.cleanup();
      Bus.clear();
    },
  );

  it.each(["freehand", null] as const)(
    "cancels an unfinished range after switching activeTool to %s",
    (tool) => {
      const scenario = createChartExplainDragScenario();
      scenario.startRange();
      scenario.state.drawings.activeTool = tool;
      // Cover both the next move and a release without another move.
      if (tool) scenario.moveRange();
      scenario.endRange();

      expect(scenario.state.drawings.activeTool).toBe(tool);
      expect(scenario.state.chartExplain?.draftBand).toBeUndefined();
      expect(scenario.ranges).toHaveLength(0);
      expect(scenario.autoClearCount()).toBe(0);

      scenario.cleanup();
      Bus.clear();
    },
  );

  it("does not clear another drawing tool when Escape dismisses a held range preview", () => {
    const scenario = createChartExplainDragScenario();
    scenario.dragRange();
    scenario.state.drawings.activeTool = "freehand";

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(scenario.state.drawings.activeTool).toBe("freehand");
    expect(scenario.state.chartExplain?.draftBand).toBeUndefined();
    expect(scenario.ranges).toHaveLength(1);

    scenario.cleanup();
    Bus.clear();
  });

  it("detaches an unfinished range when the renderer is disposed", () => {
    const scenario = createChartExplainDragScenario();
    scenario.startRange();
    scenario.dispose();

    scenario.moveRange();
    scenario.endRange();

    expect(scenario.state.chartExplain?.draftBand).toBeUndefined();
    expect(scenario.ranges).toHaveLength(0);

    scenario.cleanup();
    Bus.clear();
  });

  it("uses grab cursors for default plot hover and pan drag", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: Array.from({ length: 40 }, (_, index) => ({
            time: index + 1,
            value: 100 + index,
          })),
        },
      },
    });

    const root = document.createElement("div");
    const container = document.createElement("div");
    const canvas = createCanvas();
    root.appendChild(container);
    container.appendChild(canvas);

    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    root.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 300,
        clientY: 160,
        bubbles: true,
      }),
    );

    expect(canvas.style.cursor).toBe("grab");

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 300,
        clientY: 160,
        bubbles: true,
        buttons: 1,
      }),
    );

    expect(canvas.style.cursor).toBe("grabbing");

    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: 300,
        clientY: 160,
        bubbles: true,
        buttons: 0,
      }),
    );

    cleanup();
  });

  it("clears a locked series focus when clicking plot background", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: Array.from({ length: 40 }, (_, index) => ({
            time: index + 1,
            value: 100,
          })),
        },
      },
    });
    state.lockedSeriesId = "main";
    state.focusedSeriesId = "main";
    state.hoveredSeriesId = "main";

    const canvas = createCanvas();
    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 300,
        clientY: 20,
        bubbles: true,
        buttons: 1,
      }),
    );

    expect(state.lockedSeriesId).toBeUndefined();
    expect(state.focusedSeriesId).toBeUndefined();
    expect(state.hoveredSeriesId).toBeUndefined();

    cleanup();
  });

  it("scopes shift-drag vertical pan to the pane under the pointer", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: Array.from({ length: 40 }, (_, index) => ({
            time: index + 1,
            value: 100 + index,
          })),
        },
      },
    });

    const lowerSeriesId = ChartStateUtils.addSeries(state, {
      type: "Line",
      pane: 1,
      data: Array.from({ length: 40 }, (_, index) => ({
        time: index + 1,
        value: 200 + index,
      })),
    });
    ChartStateUtils.useOwnAxis(state, lowerSeriesId);

    const lowerAxisId = ChartStateUtils.getSeries(
      state,
      lowerSeriesId,
    )!.yAxisId;
    ChartStateUtils.applyYAxisOptions(state, "right", { autoScale: false });
    ChartStateUtils.applyYAxisOptions(state, lowerAxisId, { autoScale: false });
    ChartStateUtils.setYAxisExtent(state, "right", { min: 0, max: 100 });
    ChartStateUtils.setYAxisExtent(state, lowerAxisId, { min: 100, max: 200 });

    state.panes[0]!.height = 360;
    state.panes[1]!.height = 240;

    const canvas = createCanvas();
    const layout = Chart.computeLayout(state.config);
    const lowerPaneY = layout.areaHeight * 0.8;
    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 300,
        clientY: lowerPaneY,
        bubbles: true,
        shiftKey: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 300,
        clientY: lowerPaneY + 30,
        bubbles: true,
        shiftKey: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: 300,
        clientY: lowerPaneY + 30,
        bubbles: true,
        shiftKey: true,
        buttons: 0,
      }),
    );

    cleanup();

    expect(Chart.getAxis(state, "right")?.visibleExtent).toEqual({
      min: 0,
      max: 100,
    });
    expect(Chart.getAxis(state, lowerAxisId)?.visibleExtent).not.toEqual({
      min: 100,
      max: 200,
    });
  });

  it("resizes pane separators at pointer speed when pane totals differ from the live layout", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: Array.from({ length: 40 }, (_, index) => ({
            time: index + 1,
            value: 100 + index,
          })),
        },
      },
    });
    ChartStateUtils.addSeries(state, {
      type: "Line",
      pane: 1,
      data: Array.from({ length: 40 }, (_, index) => ({
        time: index + 1,
        value: 200 + index,
      })),
    });

    state.config.chart.dimensions.width = 800;
    state.config.chart.dimensions.height = 600;
    state.panes[0]!.height = 150;
    state.panes[1]!.height = 150;

    const canvas = createCanvas();
    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };
    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    const startBoundary = paneBoundaryY(state, 0);
    const dragDelta = 40;
    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: Chart.computeLayout(state.config).areaX + 10,
        clientY: startBoundary,
        bubbles: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: Chart.computeLayout(state.config).areaX + 10,
        clientY: startBoundary + dragDelta,
        bubbles: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: Chart.computeLayout(state.config).areaX + 10,
        clientY: startBoundary + dragDelta,
        bubbles: true,
        buttons: 0,
      }),
    );

    const endBoundary = paneBoundaryY(state, 0);
    cleanup();

    expect(endBoundary - startBoundary).toBeCloseTo(dragDelta, 1);
  });

  it("opens the series context menu from the chart root and prevents the native menu", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Candlestick",
          data: [
            { time: 1, open: 100, high: 112, low: 96, close: 108 },
            { time: 2, open: 108, high: 120, low: 104, close: 110 },
            { time: 3, open: 110, high: 118, low: 102, close: 106 },
          ],
        },
      },
    });

    const root = document.createElement("div");
    const container = document.createElement("div");
    const canvas = createCanvas();
    root.appendChild(container);
    container.appendChild(canvas);

    const layout = Chart.computeLayout(state.config);
    const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
    const series = ChartStateUtils.getSeries(state, "main");
    const x =
      layout.areaX +
      ordinalIndexToX(
        state.config,
        axis,
        layout.areaWidth,
        series?.data.length ?? 0,
        1,
      );
    const yScale = {
      extent: [90, 125] as [number, number],
      range: [layout.areaHeight, 0] as [number, number],
      mode: "linear" as const,
    };
    const y = CoordSys.toPixel(120, yScale);

    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      coord: {
        type: "cartesian",
        bounds: {
          x: layout.areaX,
          y: 0,
          width: layout.areaWidth,
          height: layout.areaHeight,
        },
        scales: {
          x: {
            extent: [0, 2],
            range: [layout.areaX, layout.areaX + layout.areaWidth],
            mode: "linear",
          },
          y: { right: yScale },
        },
        defaultYScale: "right",
      },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    const event = new MouseEvent("contextmenu", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);

    cleanup();

    expect(event.defaultPrevented).toBe(true);
    expect(state.seriesContextMenu?.seriesId).toBe("main");
    expect(state.lockedSeriesId).toBe("main");
  });

  it("opens the series context menu on rendered percentage-mode candles", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Candlestick",
          data: [
            { time: 1, open: 100, high: 100, low: 100, close: 100 },
            { time: 2, open: 150, high: 160, low: 140, close: 150 },
            { time: 3, open: 200, high: 210, low: 190, close: 200 },
          ],
        },
      },
    });
    state.config.yAxis.axes.find((axis) => axis.id === "right")!.mode =
      "percentage";

    const root = document.createElement("div");
    const container = document.createElement("div");
    const canvas = createCanvas();
    root.appendChild(container);
    container.appendChild(canvas);

    const layout = Chart.computeLayout(state.config);
    const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
    const series = ChartStateUtils.getSeries(state, "main");
    const x =
      layout.areaX +
      ordinalIndexToX(
        state.config,
        axis,
        layout.areaWidth,
        series?.data.length ?? 0,
        1,
      );
    const yScale = {
      extent: [30, 70] as [number, number],
      range: [layout.areaHeight, 0] as [number, number],
      mode: "linear" as const,
    };
    const y = CoordSys.toPixel(50, yScale);

    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      coord: {
        type: "cartesian",
        bounds: {
          x: layout.areaX,
          y: 0,
          width: layout.areaWidth,
          height: layout.areaHeight,
        },
        scales: {
          x: {
            extent: [0, 2],
            range: [layout.areaX, layout.areaX + layout.areaWidth],
            mode: "linear",
          },
          y: { right: yScale },
        },
        defaultYScale: "right",
      },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    const event = new MouseEvent("contextmenu", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);

    cleanup();

    expect(event.defaultPrevented).toBe(true);
    expect(state.seriesContextMenu?.seriesId).toBe("main");
    expect(state.lockedSeriesId).toBe("main");
  });

  it("does not reuse the locked series when a later context menu misses the series", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Candlestick",
          data: [
            { time: 1, open: 100, high: 112, low: 96, close: 108 },
            { time: 2, open: 108, high: 120, low: 104, close: 110 },
            { time: 3, open: 110, high: 118, low: 102, close: 106 },
          ],
        },
      },
    });

    const root = document.createElement("div");
    const container = document.createElement("div");
    const canvas = createCanvas();
    root.appendChild(container);
    container.appendChild(canvas);

    const layout = Chart.computeLayout(state.config);
    const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
    const series = ChartStateUtils.getSeries(state, "main");
    const x =
      layout.areaX +
      ordinalIndexToX(
        state.config,
        axis,
        layout.areaWidth,
        series?.data.length ?? 0,
        1,
      );
    const yScale = {
      extent: [90, 125] as [number, number],
      range: [layout.areaHeight, 0] as [number, number],
      mode: "linear" as const,
    };
    const hitY = CoordSys.toPixel(120, yScale);
    const missY = layout.areaHeight - 4;

    const runtime: RuntimeState = {
      canvas,
      ctx: {} as CanvasRenderingContext2D,
      ratio: 1,
      textCache: {} as RuntimeState["textCache"],
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      coord: {
        type: "cartesian",
        bounds: {
          x: layout.areaX,
          y: 0,
          width: layout.areaWidth,
          height: layout.areaHeight,
        },
        scales: {
          x: {
            extent: [0, 2],
            range: [layout.areaX, layout.areaX + layout.areaWidth],
            mode: "linear",
          },
          y: { right: yScale },
        },
        defaultYScale: "right",
      },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      disposed: false,
    };

    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });

    const hit = new MouseEvent("contextmenu", {
      clientX: x,
      clientY: hitY,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(hit);

    expect(hit.defaultPrevented).toBe(true);
    expect(state.seriesContextMenu?.seriesId).toBe("main");
    expect(state.lockedSeriesId).toBe("main");

    const miss = new MouseEvent("contextmenu", {
      clientX: x,
      clientY: missY,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(miss);

    cleanup();

    expect(miss.defaultPrevented).toBe(false);
    expect(state.seriesContextMenu).toBeUndefined();
    expect(state.lockedSeriesId).toBe("main");
  });

  it.each([2, 6])(
    "body-drags unmatched anchors by %s bars, preserving separation beyond the latest bar",
    (delta) => {
      const t0 = 1_700_000_000;
      const bars = Array.from({ length: 10 }, (_, index) => ({
        time: t0 + index * 86_400,
        value: 100 + index,
      }));
      const state = createState({
        id: "chart",
        series: { main: { type: "Line", data: bars } },
      });
      // Agent-authored anchors: offset from the bar timeline (e.g. UTC midnight
      // vs exchange midnight), so exact time equality matches no bar.
      const item = Schema.decodeUnknownSync(Drawing.Item)({
        id: "agent-trend",
        type: "trend_line",
        anchors: [
          { time: t0 + 2 * 86_400 + 20_000, price: 150, axisId: "right" },
          { time: t0 + 7 * 86_400 + 20_000, price: 150, axisId: "right" },
        ],
        style: { lineColor: "#ffffff", textColor: "#ffffff" },
      });
      ChartStateModel.upsertDrawingObject(state, item);

      const canvas = createCanvas();
      const layout = Chart.computeLayout(state.config);
      const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
      axis.spacing.rightOffset = 150;
      const coord = createCartesian2D(
        {
          x: layout.areaX,
          y: 0,
          width: layout.areaWidth,
          height: layout.areaHeight,
        },
        { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 200 } } },
        "right",
      );
      const runtime: RuntimeState = {
        canvas,
        ctx: {} as CanvasRenderingContext2D,
        ratio: 1,
        textCache: {} as RuntimeState["textCache"],
        labelCache: {} as RuntimeState["labelCache"],
        renderCache: {} as RuntimeState["renderCache"],
        xCache: { positions: [], version: 0, offset: 0 },
        panePrimitives: {} as RuntimeState["panePrimitives"],
        seriesPrimitives: new Map(),
        coord,
        disposed: false,
      };
      const cleanup = setupEvents({
        canvas,
        getState: () => state,
        setState: (mutator) => mutator(state),
        getRuntime: () => runtime,
        scheduleRender: () => {},
      });

      const xAt = (index: number) =>
        layout.areaX +
        ordinalIndexToX(
          state.config,
          axis,
          layout.areaWidth,
          bars.length,
          index,
        );
      const scale = coord.scales.y["right"]!;
      const lineY = CoordSys.toPixel(150, scale);

      // Grab the line body midway between the anchors (away from the handles),
      // then drag two bars to the right at constant y.
      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: xAt(5),
          clientY: lineY,
          bubbles: true,
          buttons: 1,
        }),
      );
      expect(state.drawings.selectedId).toBe("agent-trend");
      canvas.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: xAt(5 + delta),
          clientY: lineY,
          bubbles: true,
          buttons: 1,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          clientX: xAt(5 + delta),
          clientY: lineY,
          bubbles: true,
          buttons: 0,
        }),
      );
      cleanup();

      // The anchors snap to their nearest bars (2 and 7) and translate by the
      // two-bar drag delta — they must stay two distinct bar times, not collapse
      // onto one bar (the old fallback resolved unmatched anchors to index 0).
      const anchors = ChartStateModel.drawingItems(state)[0]!.anchors;
      expect(anchors.map((a) => a.time)).toEqual([
        t0 + (2 + delta) * 86_400,
        t0 + (7 + delta) * 86_400,
      ]);
      expect(anchors[0]!.price).toBeCloseTo(150);
      expect(anchors[1]!.price).toBeCloseTo(150);
    },
  );

  it.each([
    "freehand",
    "polyline",
    "curved_line",
    "rectangle",
    "triangle",
  ] as const)(
    "creates and edits %s with fractional anchors inside loaded bars and beyond the last candle",
    (kind) => {
      const start = 1_700_000_000;
      const bars = Array.from({ length: 10 }, (_, i) => ({
        time: start + i * 86400,
        value: 100 + i,
      }));
      const state = createState({
        id: "chart",
        series: { main: { type: "Line", data: bars } },
      });
      state.drawings.activeTool = kind;
      const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
      axis.spacing.rightOffset = 200;
      axis.spacing.barSpacing = 20;
      const layout = Chart.computeLayout(state.config);
      const canvas = createCanvas();
      const coord = createCartesian2D(
        {
          x: layout.areaX,
          y: 0,
          width: layout.areaWidth,
          height: layout.areaHeight,
        },
        { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 200 } } },
        "right",
      );
      const runtime: RuntimeState = {
        canvas,
        ctx: {} as CanvasRenderingContext2D,
        ratio: 1,
        textCache: {} as RuntimeState["textCache"],
        labelCache: {} as RuntimeState["labelCache"],
        renderCache: {} as RuntimeState["renderCache"],
        xCache: { positions: [], version: 0, offset: 0 },
        panePrimitives: {} as RuntimeState["panePrimitives"],
        seriesPrimitives: new Map(),
        coord,
        disposed: false,
      };
      const cleanup = setupEvents({
        canvas,
        getState: () => state,
        setState: (fn) => fn(state),
        getRuntime: () => runtime,
        scheduleRender: () => {},
      });
      const xAt = (i: number) =>
        layout.areaX +
        ordinalIndexToX(state.config, axis, layout.areaWidth, bars.length, i);
      const send = (type: string, index: number, y: number, buttons = 0) => {
        const target = type === "mouseup" ? window : canvas;
        target.dispatchEvent(
          new MouseEvent(type, {
            clientX: xAt(index),
            clientY: y,
            buttons,
            bubbles: true,
          }),
        );
      };
      try {
        const draggedShape = kind === "rectangle" || kind === "triangle";
        send("mousedown", 8.25, 100, 1);
        if (kind !== "freehand" && !draggedShape) send("mouseup", 8.25, 100);
        send(
          "mousemove",
          10.5,
          200,
          kind === "freehand" || draggedShape ? 1 : 0,
        );
        if (draggedShape) {
          send("mouseup", 10.5, 200);
        } else {
          if (kind !== "freehand") {
            send("mousedown", 10.5, 200, 1);
            send("mouseup", 10.5, 200);
          }
          send("mousemove", 13, 120, kind === "freehand" ? 1 : 0);
          if (kind !== "freehand") send("mousedown", 13, 120, 1);
          send("mouseup", 13, 120);
        }
        const item = ChartStateModel.drawingItems(state)[0]!;
        expect(item.type).toBe(kind);
        expect(item.anchors.map((anchor) => anchor.time)).toEqual([
          start + 8.25 * 86400,
          start + 10.5 * 86400,
          ...(draggedShape ? [] : [start + 13 * 86400]),
        ]);
        const reloaded = Schema.decodeUnknownSync(Drawing.SavedItem)(
          JSON.parse(JSON.stringify(item)),
        );
        ChartStateModel.upsertDrawingObject(state, reloaded);
        send(
          "mousedown",
          draggedShape ? 10.5 : 13,
          draggedShape ? 200 : 120,
          1,
        );
        send("mousemove", 6.25, 160, 1);
        send("mouseup", 6.25, 160);
        const updated = ChartStateModel.drawingItems(state)[0]!;
        expect(updated.anchors.at(-1)!.time).toBe(start + 6.25 * 86400);
        // A pencil is body-translated; every anchor must retain its fractional separation.
        if (kind === "freehand") {
          expect(updated.anchors.map((anchor) => anchor.time)).toEqual([
            start + (8.25 + 6.25 - 13) * 86400,
            start + (10.5 + 6.25 - 13) * 86400,
            start + 6.25 * 86400,
          ]);
        }
      } finally {
        cleanup();
      }
    },
  );
});
