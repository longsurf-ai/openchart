// Purpose: Tests for renderer suspension during interactive layout changes
// Module:  @openchart/chart-core / v2 / api

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { createRenderer } from "./renderer";
import { repaint } from "@openchart/chart-core/v2/paint";
import type { EventsConfig } from "./events";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { boundaryLabelPlacements } from "@openchart/chart-core/drawing/boundary-labels";

const eventsMocks = vi.hoisted(() => {
  const refreshExpandedAnnotationHoverGeometry = vi.fn();
  const controller = Object.assign(vi.fn(), {
    refreshExpandedAnnotationHoverGeometry,
  });
  return {
    controller,
    refreshExpandedAnnotationHoverGeometry,
    setupEvents: vi.fn<(config: EventsConfig) => typeof controller>(
      () => controller,
    ),
  };
});

vi.mock("./events", () => ({ setupEvents: eventsMocks.setupEvents }));

vi.mock("@openchart/chart-core/v2/paint", () => ({
  createRenderProfileFrame: vi.fn(() => {
    const stages: Array<{ name: string; durationMs: number }> = [];
    return {
      stages,
      time<T>(name: string, action: () => T): T {
        const result = action();
        stages.push({ name, durationMs: 0 });
        return result;
      },
    };
  }),
  repaint: vi.fn(() => undefined),
}));

describe("createRenderer", () => {
  const originalDevicePixelRatio = window.devicePixelRatio;
  let rafSpy: ReturnType<typeof vi.fn>;
  let cancelSpy: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest MockInstance type inference for overloaded methods
  let getContextSpy: any;

  beforeEach(() => {
    rafSpy = vi.fn(() => 1);
    cancelSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        scale: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1,
    });
    vi.mocked(repaint).mockClear();
    vi.mocked(repaint).mockReturnValue(undefined);
    eventsMocks.refreshExpandedAnnotationHoverGeometry.mockClear();
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalDevicePixelRatio,
    });
    document.body.innerHTML = "";
  });

  function createRendererHarness() {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: [
            { time: 1, value: 100 },
            { time: 2, value: 101 },
          ],
        },
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const renderer = createRenderer({
      container,
      getState: () => state,
      setState: (mutator) => mutator(state),
    });

    return { renderer, state };
  }

  it("owns transient visuals per source and detaches every remaining source on disposal", () => {
    const { renderer } = createRendererHarness();
    const first = {
      id: "first:marker",
      zOrder: "top" as const,
      paneViews: () => [],
      detached: vi.fn(),
    };
    const second = {
      id: "second:marker",
      zOrder: "top" as const,
      paneViews: () => [],
      detached: vi.fn(),
    };
    renderer.setSeriesPrimitives("main", "first", [first]);
    renderer.setSeriesPrimitives("main", "second", [second]);
    renderer.setSeriesPrimitives("main", "first", []);
    expect(first.detached).toHaveBeenCalledOnce();
    expect(second.detached).not.toHaveBeenCalled();
    renderer.dispose();
    expect(second.detached).toHaveBeenCalledOnce();
    expect(renderer.primitiveAt(10, 10)).toBeNull();
  });

  it("reads raw prices from painted pane scales, including log and comparison transforms", () => {
    const { renderer, state } = createRendererHarness();
    const runtime = eventsMocks.setupEvents.mock.calls.at(-1)![0].getRuntime();
    expect(renderer.seriesValueAtY("main", 200)).toBeUndefined();
    runtime.coord = {
      type: "cartesian",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
      defaultYScale: "right",
      scales: {
        x: { extent: [0, 1], range: [0, 500], mode: "linear" },
        y: { right: { extent: [100, 300], range: [300, 100], mode: "linear" } },
      },
    };
    expect(renderer.seriesValueAtY("main", 200)).toBe(200);
    expect(renderer.seriesYAtValue("main", 200)).toBe(200);
    const series = ChartStateModel.getSeriesObject(state, "main")!;
    ChartStateModel.createDataSeries(state, "prices", ["time", "value"]);
    ChartStateModel.setDataSeriesData(state, "prices", series.series.data);
    series.dataRef = "prices";
    series.series.data = [];
    expect(renderer.seriesValueAtY("main", 200)).toBe(200);
    runtime.coord.scales.y.right = {
      extent: [10, 1000],
      range: [300, 100],
      mode: "log",
    };
    expect(renderer.seriesValueAtY("main", 200)).toBeCloseTo(100);
    expect(renderer.seriesYAtValue("main", 100)).toBeCloseTo(200);
    expect(renderer.seriesYAtValue("main", 0)).toBeUndefined();
    runtime.coord.scales.y.right = {
      extent: [-50, 50],
      range: [300, 100],
      mode: "linear",
    };
    runtime.modeCache = {
      signature: "comparison",
      extents: { x: { min: 0, max: 1 }, y: {} },
      modeTransforms: new Map([
        [
          "main",
          {
            signature: "percent",
            fields: ["value"],
            value: (raw: number) => (raw / 200 - 1) * 100,
            point: (point: Record<string, unknown>) => point,
          },
        ],
      ]),
    };
    expect(renderer.seriesValueAtY("main", 150)).toBeCloseTo(250);
    expect(renderer.seriesYAtValue("main", 250)).toBeCloseTo(150);
    expect(renderer.seriesValueAtY("missing", 200)).toBeUndefined();
    expect(renderer.seriesValueAtY("main", Number.NaN)).toBeUndefined();
    renderer.dispose();
    expect(renderer.seriesValueAtY("main", 200)).toBeUndefined();
    expect(renderer.seriesYAtValue("main", 200)).toBeUndefined();
  });

  it("defers render scheduling while suspended and resumes with a repaint", () => {
    const { renderer } = createRendererHarness();

    renderer.setSuspended(true);
    renderer.render("light");
    expect(rafSpy).not.toHaveBeenCalled();

    renderer.setSuspended(false);
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it("returns detached drawing geometry for the hovered channel edge and releases it on disposal", () => {
    const { renderer } = createRendererHarness();
    const runtime = eventsMocks.setupEvents.mock.calls.at(-1)![0].getRuntime();
    expect(
      renderer.drawingLabelPlacement("line", { x: 0, y: 0 }),
    ).toBeUndefined();
    runtime.drawingLabelPlacements = new Map([
      [
        "line",
        [
          { x: 50, y: 20, angle: 0 },
          { x: 50, y: 70, angle: 0 },
        ],
      ],
    ]);
    expect(renderer.drawingLabelPlacement("line", { x: 80, y: 23 })).toEqual({
      x: 50,
      y: 20,
      angle: 0,
    });
    const label = renderer.drawingLabelPlacement("line", { x: 80, y: 68 })!;
    expect(label).toEqual({ x: 50, y: 70, angle: 0 });
    label.angle = 90;
    expect(
      renderer.drawingLabelPlacement("line", { x: 80, y: 68 })!.angle,
    ).toBe(0);
    runtime.drawingLabelPlacements.clear();
    expect(
      renderer.drawingLabelPlacement("line", { x: 80, y: 68 }),
    ).toBeUndefined();
    renderer.dispose();
    expect(
      renderer.drawingLabelPlacement("line", { x: 80, y: 68 }),
    ).toBeUndefined();
  });

  it("selects the painted curve branch and keeps its runtime geometry private", () => {
    const { renderer } = createRendererHarness();
    const runtime = eventsMocks.setupEvents.mock.calls.at(-1)![0].getRuntime();
    const labels = boundaryLabelPlacements(
      {
        closed: false,
        primitives: [
          {
            kind: "quadratic",
            index: 0,
            start: { x: 0, y: 10 },
            control: { x: 200, y: 50 },
            end: { x: 0, y: 90 },
          },
        ],
      },
      { x: 0, y: 0, width: 100, height: 100 },
    );
    runtime.drawingLabelPlacements = new Map([["curve", labels]]);
    const label = renderer.drawingLabelPlacement("curve", { x: 64, y: 74 })!;
    expect(label.x).toBeCloseTo(50);
    expect(label.y).toBeCloseTo(50 + 20 * Math.sqrt(2));
    expect(label.angle).toBeLessThan(0);
    expect(Object.keys(label).sort()).toEqual(["angle", "x", "y"]);
    expect(labels.every((candidate) => candidate.boundary)).toBe(true);
    renderer.dispose();
  });

  it("keeps the displayed canvas frame intact until a resize repaint commits", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    const { renderer, state } = createRendererHarness();
    const canvas = renderer.canvas;
    const initialWidth = state.config.chart.dimensions.width;
    const initialHeight = state.config.chart.dimensions.height;

    expect(canvas.width).toBe(initialWidth);
    expect(canvas.height).toBe(initialHeight);

    state.config.chart.dimensions.width = 320;
    state.config.chart.dimensions.height = 240;
    renderer.scheduleResize(320, 240);

    expect(canvas.width).toBe(initialWidth);
    expect(canvas.height).toBe(initialHeight);
    expect(canvas.style.width).toBe("320px");
    expect(canvas.style.height).toBe("240px");
    expect(repaint).not.toHaveBeenCalled();

    callback?.(0);

    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it("coalesces resize storms and commits only the latest size", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    const { renderer, state } = createRendererHarness();
    const canvas = renderer.canvas;
    const initialWidth = state.config.chart.dimensions.width;
    const initialHeight = state.config.chart.dimensions.height;

    state.config.chart.dimensions.width = 320;
    state.config.chart.dimensions.height = 240;
    renderer.scheduleResize(320, 240);
    state.config.chart.dimensions.width = 640;
    state.config.chart.dimensions.height = 360;
    renderer.scheduleResize(640, 360);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(initialWidth);
    expect(canvas.height).toBe(initialHeight);
    expect(canvas.style.width).toBe("640px");
    expect(canvas.style.height).toBe("360px");

    callback?.(0);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it("fails when a resize repaint does not match chart state dimensions", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    const { renderer } = createRendererHarness();

    renderer.scheduleResize(320, 240);

    expect(() => callback?.(0)).toThrow(
      "pending canvas resize 320x240 does not match render state dimensions",
    );
    expect(repaint).not.toHaveBeenCalled();
  });

  it("keeps the displayed canvas frame intact while suspended and applies deferred resize on resume", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    const { renderer, state } = createRendererHarness();
    const canvas = renderer.canvas;
    const initialWidth = state.config.chart.dimensions.width;
    const initialHeight = state.config.chart.dimensions.height;

    renderer.setSuspended(true);
    state.config.chart.dimensions.width = 320;
    state.config.chart.dimensions.height = 240;
    renderer.scheduleResize(320, 240);

    expect(canvas.width).toBe(initialWidth);
    expect(canvas.height).toBe(initialHeight);
    expect(canvas.style.width).toBe(`${initialWidth}px`);
    expect(canvas.style.height).toBe(`${initialHeight}px`);

    renderer.setSuspended(false);

    expect(canvas.width).toBe(initialWidth);
    expect(canvas.height).toBe(initialHeight);
    expect(canvas.style.width).toBe("320px");
    expect(canvas.style.height).toBe("240px");

    callback?.(0);

    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
    expect(canvas.style.width).toBe("320px");
    expect(canvas.style.height).toBe("240px");
  });

  it("reports render completion after repaint", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: [
            { time: 1, value: 100 },
            { time: 2, value: 101 },
          ],
        },
      },
    });
    const container = document.createElement("div");
    const onRenderComplete = vi.fn();
    document.body.appendChild(container);

    createRenderer({
      container,
      getState: () => state,
      setState: (mutator) => mutator(state),
      onRenderComplete,
    }).render("full");

    callback?.(0);

    expect(onRenderComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chartId: "chart",
        level: "full",
      }),
    );
    expect(
      onRenderComplete.mock.calls[0]?.[0].durationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  it("refreshes expanded annotation hover geometry after repaint", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    const { renderer } = createRendererHarness();

    renderer.render("light");
    callback?.(0);

    expect(
      eventsMocks.refreshExpandedAnnotationHoverGeometry,
    ).toHaveBeenCalledTimes(1);
  });

  it("reports render profile stages when profiling is enabled", () => {
    let callback: FrameRequestCallback | undefined;
    rafSpy.mockImplementation((cb) => {
      callback = cb;
      return 1;
    });
    vi.mocked(repaint).mockImplementationOnce(
      (_state, _runtime, _mask, profile) => {
        profile?.time("test-stage", () => undefined);
        return undefined;
      },
    );
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: [
            { time: 1, value: 100 },
            { time: 2, value: 101 },
          ],
        },
      },
    });
    const container = document.createElement("div");
    const onFrame = vi.fn();
    document.body.appendChild(container);

    createRenderer({
      container,
      getState: () => state,
      setState: (mutator) => mutator(state),
      renderProfile: {
        isEnabled: () => true,
        onFrame,
      },
    }).render("light");

    callback?.(0);

    expect(onFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        chartId: "chart",
        level: "light",
        stages: [
          expect.objectContaining({
            name: "test-stage",
          }),
        ],
      }),
    );
  });
});
