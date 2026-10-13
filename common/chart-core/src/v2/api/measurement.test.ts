// Purpose: Exercise ruler gestures through real DOM listeners, including cleanup.
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "@openchart/chart-core/chart/state";
import { Drawing } from "@openchart/chart-core/drawing";
import { CoordSys, createCartesian2D } from "@openchart/chart-core/coord";
import { ChartStateModel } from "../state/model";
import { createState } from "../state/defaults";
import { getAxis, ordinalIndexToX } from "../x-scale";
import { setupEvents, type RuntimeState } from "./events";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function scenario(
  tool: Drawing.Tool | null = "measurement",
  log = false,
  indicator = false,
) {
  const state = createState({
    id: "ruler",
    series: {
      main: {
        type: "Candlestick",
        data: Array.from({ length: 20 }, (_, i) => ({
          time: 1700000000 + i * 86400,
          open: 100,
          high: 120,
          low: 80,
          close: 110,
          volume: (i + 1) * 10,
        })),
      },
      ...(indicator
        ? {
            indicator: {
              type: "Line",
              paneIndex: 1,
              data: Array.from({ length: 20 }, (_, i) => ({
                time: 1700000000 + i * 86400,
                value: 5,
              })),
            },
          }
        : {}),
    },
  });
  state.drawings.activeTool = tool;
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.append(canvas);
  root.append(container);
  document.body.append(root);
  cleanups.push(() => root.remove());
  const layout = Chart.computeLayout(state.config);
  const coord = createCartesian2D(
    {
      x: layout.areaX,
      y: 0,
      width: layout.areaWidth,
      height: layout.areaHeight,
    },
    { x: { min: 0, max: 20 }, y: { right: { min: 1, max: 200 } } },
    "right",
    { right: { from: 0, to: 1, mode: log ? "log" : "linear" } },
  );
  const runtime = { canvas, coord, disposed: false } as RuntimeState;
  const autoClear = vi.fn();
  const onAddDrawing = vi.fn();
  const dispose = setupEvents({
    canvas,
    getState: () => state,
    setState: (fn) => fn(state),
    getRuntime: () => runtime,
    scheduleRender: vi.fn(),
    onDrawingToolAutoClear: autoClear,
    onAddDrawing,
  });
  cleanups.push(dispose);
  const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
  const mouse = (
    type: string,
    index: number,
    price: number,
    shiftKey = false,
    target: EventTarget = window,
    buttons = type === "mouseup" ? 0 : 1,
  ) => {
    const x =
      layout.areaX +
      ordinalIndexToX(state.config, axis, layout.areaWidth, 20, index);
    const y = CoordSys.toPixel(price, coord.scales.y.right!);
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      buttons,
      button: type === "contextmenu" ? 2 : 0,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const start = (index = 2, price = 40, shift = false) =>
    mouse("mousedown", index, price, shift, canvas);
  return {
    state,
    canvas,
    runtime,
    dispose,
    mouse,
    start,
    autoClear,
    onAddDrawing,
    axis,
  };
}

describe("measurement gestures", () => {
  it("starts CAGR on the main price series even when a study is locked and clicked", () => {
    const s = scenario("cagr_measurement", false, true);
    s.state.lockedSeriesId = "indicator";
    s.start(2, 5);
    s.mouse("mouseup", 8, 5);
    expect(s.state.measurement).toMatchObject({
      kind: "cagr",
      seriesId: "main",
      start: { price: 110 },
      end: { price: 110 },
    });
  });
  it.each([false, true])(
    "selects CAGR by time and actual main-series closes, ignoring pointer height (%s)",
    (reverse) => {
      const s = scenario("cagr_measurement", true);
      const first = reverse ? 12 : 2;
      const last = reverse ? 2 : 12;
      s.start(first, 40);
      s.mouse("mousemove", last, 150);
      s.mouse("mouseup", last, 180);
      expect(s.state.measurement).toMatchObject({
        kind: "cagr",
        phase: "complete",
        start: { time: 1700000000 + first * 86400, price: 110 },
        end: { time: 1700000000 + last * 86400, price: 110 },
      });
      expect(s.state.drawings.activeTool).toBeNull();
      expect(s.autoClear).toHaveBeenCalledOnce();
      expect(s.onAddDrawing).not.toHaveBeenCalled();
    },
  );

  it("supports click-move-click CAGR selection and keeps endpoints within loaded bars", () => {
    const s = scenario("cagr_measurement");
    s.start(2, 40);
    s.mouse("mouseup", 2, 40);
    expect(s.state.measurement?.phase).toBe("tracking");
    s.mouse("mousemove", 30, 150, false, window, 0);
    expect(s.state.measurement?.end.time).toBe(1700000000 + 19 * 86400);
    s.mouse("mousedown", 8, 180, false, s.canvas);
    s.mouse("mouseup", 8, 180);
    expect(s.state.measurement).toMatchObject({
      kind: "cagr",
      phase: "complete",
      end: { time: 1700000000 + 8 * 86400, price: 110 },
    });
  });

  it("edits either completed CAGR endpoint through paint-owned handles", () => {
    const s = scenario("cagr_measurement");
    s.start(2, 40);
    s.mouse("mouseup", 8, 100);
    const layout = Chart.computeLayout(s.state.config);
    const xAt = (index: number) =>
      layout.areaX +
      ordinalIndexToX(s.state.config, s.axis, layout.areaWidth, 20, index);
    for (const [endpoint, index, next] of [
      ["start", 2, 4],
      ["end", 8, 12],
    ] as const) {
      s.runtime.measurementHitRegions = [
        {
          x: xAt(index) - 4,
          y: 0,
          width: 8,
          height: layout.areaHeight,
          endpoint,
        },
      ];
      s.start(index, 50);
      s.mouse("mousemove", next, 160);
      s.mouse("mouseup", next, 160);
      expect(s.state.measurement?.[endpoint]).toEqual({
        time: 1700000000 + next * 86400,
        price: 110,
      });
      expect(s.state.measurement?.phase).toBe("complete");
    }
    expect(s.state.measurement?.start.time).toBe(1700000000 + 4 * 86400);
    expect(s.onAddDrawing).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Delete", "Backspace"])(
    "cancels CAGR with %s and ignores the pending release",
    (key) => {
      const s = scenario("cagr_measurement");
      s.start();
      window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      s.mouse("mouseup", 8, 150);
      expect(s.state.measurement).toBeUndefined();
      expect(s.state.drawings.activeTool).toBeNull();
    },
  );

  it("updates live, holds the released range, never adds drawings and auto-clears the tool", () => {
    const s = scenario();
    const before = structuredClone(s.axis);
    s.start();
    s.mouse("mousemove", 8, 100);
    expect(s.state.measurement).toMatchObject({
      phase: "dragging",
      start: { time: 1700000000 + 2 * 86400, price: 40 },
      end: { time: 1700000000 + 8 * 86400, price: 100 },
    });
    s.mouse("mouseup", 9, 120);
    expect(s.state.measurement).toMatchObject({
      phase: "complete",
      end: { time: 1700000000 + 9 * 86400, price: 120 },
    });
    expect(s.state.drawings.activeTool).toBeNull();
    expect(s.autoClear).toHaveBeenCalledOnce();
    expect(s.onAddDrawing).not.toHaveBeenCalled();
    expect(ChartStateModel.drawingItems(s.state)).toHaveLength(0);
    expect(s.axis).toEqual(before);
    s.mouse("mousemove", 10, 180);
    expect(s.state.measurement?.end.price).toBeCloseTo(120);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.state.measurement).toBeUndefined();
  });

  it("Shift temporarily overrides a drawing tool and survives releasing Shift before the mouse", () => {
    const s = scenario("trend_line");
    s.start(12, 150, true);
    s.mouse("mousemove", 4, 30, false);
    s.mouse("mouseup", 4, 30, false);
    expect(s.state.measurement?.start.price).toBeCloseTo(150);
    expect(s.state.measurement?.end.price).toBeCloseTo(30);
    expect(s.state.drawings.activeTool).toBe("trend_line");
    expect(s.state.drawings.draft).toBeUndefined();
    expect(s.autoClear).not.toHaveBeenCalled();
  });

  it.each(["measurement", null, "trend_line"] as const)(
    "tracks after a click with %s selected, without holding Shift or a mouse button",
    (tool) => {
      const s = scenario(tool);
      s.start(2, 40, tool !== "measurement");
      s.mouse("mouseup", 2, 40);
      expect(s.state.measurement?.phase).toBe("tracking");
      expect(s.autoClear).not.toHaveBeenCalled();
      s.mouse("mousemove", 8, 100, false, window, 0);
      expect(s.state.measurement?.end.price).toBeCloseTo(100);
      // This plain click fixes the endpoint instead of starting a new drawing or pan.
      s.mouse("mousedown", 9, 120, false, s.canvas);
      s.mouse("mouseup", 9, 120);
      expect(s.state.measurement).toMatchObject({
        phase: "complete",
        start: { price: 40 },
        end: { price: 120 },
      });
      expect(s.state.drawings.activeTool).toBe(
        tool === "measurement" ? null : tool,
      );
      s.mouse("mousemove", 14, 180, false, window, 0);
      expect(s.state.measurement?.end.price).toBeCloseTo(120);
      expect(s.onAddDrawing).not.toHaveBeenCalled();
    },
  );

  it("right-click cancels a following measurement without resurrecting it on mouseup", () => {
    const s = scenario();
    s.start();
    s.mouse("mouseup", 2, 40);
    const event = s.mouse("contextmenu", 8, 100, false, s.canvas);
    expect(event.defaultPrevented).toBe(true);
    expect(s.state.measurement).toBeUndefined();
    expect(s.state.drawings.activeTool).toBeNull();
    s.mouse("mousemove", 10, 160, false, window, 0);
    s.mouse("mouseup", 10, 160);
    expect(s.state.measurement).toBeUndefined();
  });

  it("opens a dedicated menu on the painted range or its readout card", () => {
    const s = scenario();
    s.start();
    s.mouse("mouseup", 8, 100);
    // These are the regions returned by paintMeasurement, consumed without recomputing layout.
    s.runtime.measurementHitRegions = [{ x: 0, y: 0, width: 800, height: 400 }];
    const event = s.mouse("contextmenu", 5, 90, false, s.canvas);
    expect(event.defaultPrevented).toBe(true);
    expect(s.state.measurement?.contextMenu).toEqual({
      x: event.clientX,
      y: event.clientY,
    });
    expect(s.state.drawings.contextMenu).toBeUndefined();
    expect(s.state.seriesContextMenu).toBeUndefined();
  });

  it.each(["Delete", "Backspace", "Escape"])(
    "clears a completed ruler with %s without deleting other drawings",
    (key) => {
      const s = scenario();
      s.start();
      s.mouse("mouseup", 8, 100);
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      s.canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(s.state.measurement).toBeUndefined();
      expect(s.onAddDrawing).not.toHaveBeenCalled();
    },
  );

  it("does not handle Delete in text fields or another chart", () => {
    const s = scenario();
    s.start();
    s.mouse("mouseup", 8, 100);
    const input = document.createElement("input");
    document.body.append(input);
    cleanups.push(() => input.remove());
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
    expect(s.state.measurement).toBeDefined();
    const other = document.createElement("canvas");
    other.tabIndex = 0;
    document.body.append(other);
    cleanups.push(() => other.remove());
    other.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(s.state.measurement).toBeDefined();
  });

  it("Escape clears only the focused chart when two charts have measurements", () => {
    const first = scenario();
    first.start();
    first.mouse("mouseup", 8, 100);
    const second = scenario();
    second.start();
    second.mouse("mouseup", 9, 120);
    const retained = structuredClone(first.state.measurement);
    second.canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(first.state.measurement).toEqual(retained);
    expect(second.state.measurement).toBeUndefined();
  });

  it.each(["tracking", "complete"] as const)(
    "Escape in an unrelated popup preserves a %s measurement",
    (phase) => {
      const s = scenario();
      s.start();
      s.mouse(
        "mouseup",
        phase === "tracking" ? 2 : 8,
        phase === "tracking" ? 40 : 100,
      );
      const popupButton = document.createElement("button");
      document.body.append(popupButton);
      cleanups.push(() => popupButton.remove());
      popupButton.focus();
      popupButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(s.state.measurement?.phase).toBe(phase);
    },
  );

  it("preserves a measurement when a popup has already handled Escape", () => {
    const s = scenario();
    s.start();
    s.mouse("mouseup", 8, 100);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    s.canvas.dispatchEvent(event);
    expect(s.state.measurement).toBeDefined();
  });

  it("keeps a locked ruler selected for repeated measurements", () => {
    const s = scenario();
    s.state.drawings.toolLocked = true;
    s.start();
    s.mouse("mouseup", 8, 100);
    expect(s.state.drawings.activeTool).toBe("measurement");
    s.start(5, 60);
    expect(s.state.measurement?.phase).toBe("dragging");
    expect(s.state.measurement?.start.price).toBeCloseTo(60);
  });

  it("uses raw values on logarithmic scales and comparison transforms", () => {
    const s = scenario("measurement", true);
    s.start(2, 10);
    s.mouse("mouseup", 8, 100);
    expect(s.state.measurement?.start.price).toBeCloseTo(10);
    expect(s.state.measurement?.end.price).toBeCloseTo(100);
    s.state.drawings.activeTool = "measurement";
    s.runtime.modeCache = {
      modeTransforms: new Map([
        ["main", { value: (raw: number) => raw * 2 - 10 }],
      ]),
    } as RuntimeState["modeCache"];
    s.start(2, 10);
    s.mouse("mouseup", 8, 100);
    expect(s.state.measurement?.start.price).toBeCloseTo(10);
    expect(s.state.measurement?.end.price).toBeCloseTo(55);
  });

  it.each(["escape", "blur", "switch", "dispose"])(
    "cancels %s without a late mouseup creating a result",
    (reason) => {
      const s = scenario();
      s.start();
      if (reason === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      if (reason === "blur") window.dispatchEvent(new Event("blur"));
      if (reason === "switch") {
        s.state.drawings.activeTool = "freehand";
        s.mouse("mousemove", 8, 100);
      }
      if (reason === "dispose") s.dispose();
      s.mouse("mouseup", 8, 100);
      expect(s.state.measurement).toBeUndefined();
      expect(s.onAddDrawing).not.toHaveBeenCalled();
    },
  );

  it("clears a completed measurement on an ordinary click", () => {
    const s = scenario(null);
    s.start(2, 40, true);
    s.mouse("mouseup", 8, 100);
    // Click the time axis: dismissal should not require another plot gesture.
    s.canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 400,
        clientY: 399,
        bubbles: true,
      }),
    );
    expect(s.state.measurement).toBeUndefined();
  });

  it("clears the range when its source series is removed", () => {
    const s = scenario();
    s.start();
    s.mouse("mouseup", 8, 100);
    ChartStateModel.removeSeriesObject(s.state, "main");
    expect(s.state.measurement).toBeUndefined();
  });

  it("ignores empty charts and clamps a window-level release to the plot", () => {
    const s = scenario();
    s.start();
    window.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 2000, clientY: -100 }),
    );
    expect(s.state.measurement?.phase).toBe("complete");
    expect(s.state.measurement?.end.price).toBeCloseTo(200);
    ChartStateModel.getSeries(s.state, "main")!.data = [];
    delete s.state.measurement;
    s.state.drawings.activeTool = "measurement";
    s.start();
    expect(s.state.measurement).toBeUndefined();
  });
});
