// Purpose: Alert lines follow painted coordinates and preserve provider identity and rule actions.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Drawing, v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import { ProviderId } from "@openchart/market";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Subject } from "rxjs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { createCell } from "@openchart/app/features/chart/api/queries";
import { ChartAlertContext } from "@openchart/app/features/chart/components/alert-button";
import {
  ChartAlertLines,
  ChartDrawingAlerts,
} from "@openchart/app/features/chart/components/alert-lines";
import { getMainSeries } from "@openchart/app/features/chart/utils/resource";
import { ChartContext } from "@openchart/app/lib/chart/context";
import {
  createChartStore,
  type ChartOutput,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

test("saved alerts follow paints, filter by listing, and dispatch edit/copy/delete without drawings", () => {
  const source = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAPL", currency: "USD" },
  };
  const options = {
    resolution: "1d" as const,
    session: "regular" as const,
    adjustment: "raw" as const,
  };
  const cell = createCell(source, options);
  const main = getMainSeries(cell);
  const state = v2.createState({ id: cell.id });
  v2.ChartStateUtils.addSeries(state, { id: main.id, type: "Line" });
  v2.ChartStateModel.getSeriesObject(state, main.id)!.role = "main";
  const store = createChartStore(state);
  const output = new Subject<ChartOutput>();
  const project = vi.fn(() => 150);
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    renderer: {
      canvas: document.createElement("canvas"),
      seriesYAtValue: project,
      seriesValueAtY: () => 199.5,
    } as unknown as v2.ChartRenderer,
    output$: output,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const line = {
    id: "alr_1",
    name: "AAPL target",
    threshold: 200,
    thresholdParameter: "threshold",
    inputs: { ...source, ...options },
  };
  const alerts = {
    create: vi.fn(),
    pending: false,
    agentAvailable: false,
    lines: [
      line,
      {
        ...line,
        id: "alr_other_provider",
        inputs: { ...line.inputs, provider: ProviderId.make("another") },
      },
    ],
    edit: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    error: null,
  };
  const content = () => (
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <ChartAlertContext.Provider value={alerts}>
          <ChartAlertLines cell={cell} />
        </ChartAlertContext.Provider>
      </ChartContext.Provider>
    </TooltipProvider>
  );
  const { rerender, unmount } = render(content());
  const group = screen.getByRole("group", { name: "Alert AAPL target" });
  expect(group).toHaveStyle({ top: "150px" });
  expect(project).toHaveBeenCalledWith(main.id, 200);
  act(() => {
    project.mockReturnValue(185);
    output.next({ type: "paint" });
  });
  expect(group).toHaveStyle({ top: "185px" });
  fireEvent.doubleClick(
    screen.getByRole("button", { name: "Edit alert line AAPL target" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Duplicate AAPL target" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete AAPL target" }));
  expect(alerts.edit).toHaveBeenCalledWith("alr_1");
  expect(alerts.duplicate).toHaveBeenCalledWith("alr_1", {
    parameter: "threshold",
    value: 199.5,
  });
  expect(alerts.remove).toHaveBeenCalledWith("alr_1");
  const pan = vi.fn();
  const zoom = vi.fn();
  chart.renderer.canvas.addEventListener("mousedown", pan);
  chart.renderer.canvas.addEventListener("wheel", zoom);
  const hit = screen.getByRole("button", {
    name: "Edit alert line AAPL target",
  });
  fireEvent.mouseDown(hit, { clientX: 200, clientY: 185, button: 0 });
  fireEvent.wheel(hit, { deltaY: 10 });
  expect(pan).toHaveBeenCalledOnce();
  expect(zoom).toHaveBeenCalledOnce();
  act(() =>
    chart.mutate((state) => {
      state.drawings.activeTool = "horizontal_line";
    }),
  );
  expect(hit).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Duplicate AAPL target" }),
  ).not.toBeInTheDocument();
  expect(v2.ChartStateModel.drawingItems(store.getState())).toEqual([]);
  alerts.lines = [];
  rerender(content());
  expect(
    screen.queryByRole("group", { name: "Alert AAPL target" }),
  ).not.toBeInTheDocument();
  unmount();
  expect(output.observed).toBe(false);
});

test("an Indicator line is drawn in its output's pane with that series' scale and copies its generated threshold", () => {
  const base = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const cell = {
    ...base,
    panes: [
      ...base.panes,
      {
        id: "pan_ao",
        series: [
          {
            id: "srs_ao",
            role: "normal",
            source: {
              kind: "indicator",
              indicatorId: "ind_ao",
              output: "histogram",
            },
          },
        ],
      },
    ],
  } as typeof base;
  const main = getMainSeries(cell);
  const state = v2.createState({ id: cell.id });
  v2.ChartStateUtils.addSeries(state, { id: main.id, type: "Line" });
  v2.ChartStateModel.getSeriesObject(state, main.id)!.role = "main";
  v2.ChartStateUtils.addSeries(state, {
    id: "srs_ao",
    type: "Line",
    pane: 1,
    yAxisId: "pane:pan_ao",
  });
  const store = createChartStore(state);
  const layout = Chart.computeLayout(state.config);
  const pane = v2.ChartPaneLayout.paneLayouts(
    state.panes,
    layout.areaHeight,
  )[1]!;
  const output = new Subject<ChartOutput>();
  // Each series has its own scale; the main series would put -10 in the main pane.
  const project = vi.fn((id: string) => (id === "srs_ao" ? pane.top + 20 : 10));
  const valueAtY = vi.fn((id: string) => (id === "srs_ao" ? -12.5 : 199.5));
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    renderer: {
      canvas: document.createElement("canvas"),
      seriesYAtValue: project,
      seriesValueAtY: valueAtY,
    } as unknown as v2.ChartRenderer,
    output$: output,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const line = {
    id: "alr_ao",
    name: "AAPL histogram",
    threshold: -10,
    thresholdParameter: "c0_threshold",
    indicator: { indicatorId: "ind_ao", output: "histogram" },
  };
  const alerts = {
    create: vi.fn(),
    pending: false,
    agentAvailable: false,
    lines: [
      line,
      {
        ...line,
        id: "alr_other",
        name: "Another chart",
        indicator: { indicatorId: "ind_other", output: "histogram" },
      },
      // An output of the same Indicator that this cell does not bind.
      {
        ...line,
        id: "alr_signal",
        name: "AAPL signal",
        indicator: { indicatorId: "ind_ao", output: "signal" },
      },
    ],
    edit: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    error: null,
  };
  render(
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <ChartAlertContext.Provider value={alerts}>
          <ChartAlertLines cell={cell} />
        </ChartAlertContext.Provider>
      </ChartContext.Provider>
    </TooltipProvider>,
  );
  const group = screen.getByRole("group", { name: "Alert AAPL histogram" });
  expect(group).toHaveStyle({ top: `${pane.top + 20}px` });
  expect(project).toHaveBeenCalledWith("srs_ao", -10);
  expect(project).not.toHaveBeenCalledWith(main.id, -10);
  expect(
    screen.queryByRole("group", { name: "Alert Another chart" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Alert AAPL signal" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Duplicate AAPL histogram" }),
  );
  expect(valueAtY).toHaveBeenCalledWith("srs_ao", expect.any(Number));
  expect(alerts.duplicate).toHaveBeenCalledWith("alr_ao", {
    parameter: "c0_threshold",
    value: -12.5,
  });
  // A value painted outside its own pane is clipped, not drawn over the main pane.
  act(() => {
    project.mockReturnValue(pane.top - 1);
    output.next({ type: "paint" });
  });
  expect(
    screen.queryByRole("group", { name: "Alert AAPL histogram" }),
  ).not.toBeInTheDocument();
});

test("hovered drawing alerts follow geometry and distinguish other chart settings from disabled rules", async () => {
  const inputs = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAPL", currency: "USD" },
    resolution: "1d" as const,
    session: "regular" as const,
    adjustment: "raw" as const,
  };
  let settings: Parameters<typeof ChartDrawingAlerts>[0]["settings"] = inputs;
  const state = v2.createState({ id: "chart" });
  v2.ChartStateUtils.resize(state, 800, 400);
  v2.ChartStateModel.upsertDrawingObject(
    state,
    Drawing.create(
      "extended_line",
      [
        { time: 1, price: 100 },
        { time: 2, price: 200 },
      ],
      { id: "gesture" },
    ),
  );
  const store = createChartStore(state);
  const output = new Subject<ChartOutput>();
  const root = document.createElement("div");
  const canvasContainer = document.createElement("div");
  const canvas = document.createElement("canvas");
  const view = document.createElement("div");
  canvasContainer.append(canvas);
  root.append(canvasContainer, view);
  document.body.append(root);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 80, 800, 400),
  );
  const removeListener = vi.spyOn(root, "removeEventListener");
  const placement = vi.fn(() => ({ x: 400, y: 180, angle: -30 }));
  const chart: ChartRuntime = {
    id: "chart",
    store,
    output$: output,
    renderer: {
      canvas,
      drawingLabelPlacement: placement,
    } as unknown as v2.ChartRenderer,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const alerts = {
    create: vi.fn(),
    pending: false,
    agentAvailable: false,
    lines: [],
    error: null,
    edit: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    drawingAlerts: [
      {
        id: "alr_up",
        name: "Crossing Up",
        drawingId: "drw_saved",
        enabled: true,
        inputs,
      },
      {
        id: "alr_down",
        name: "Crossing Down",
        drawingId: "drw_saved",
        enabled: false,
        inputs,
      },
      {
        id: "alr_other",
        name: "Other dashboard",
        drawingId: "drw_other",
        enabled: true,
        inputs,
      },
    ],
  };
  const content = () => (
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <ChartAlertContext.Provider value={alerts}>
          <ChartDrawingAlerts
            bindings={[{ resourceId: "drw_saved", itemId: "gesture" }]}
            settings={settings}
          />
        </ChartAlertContext.Provider>
      </ChartContext.Provider>
    </TooltipProvider>
  );
  const { rerender, unmount } = render(content(), { container: view });
  const hover = (x = 300, y = 150) => {
    act(() =>
      chart.mutate((state) => {
        state.drawings.hoveredId = "gesture";
      }),
    );
    fireEvent.mouseMove(canvas, { clientX: x + 40, clientY: y + 80 });
  };
  expect(
    screen.queryByRole("button", { name: "Open alert Crossing Up" }),
  ).not.toBeInTheDocument();
  fireEvent.mouseMove(canvas, { clientX: 340, clientY: 230 });
  expect(
    screen.queryByRole("button", { name: "Open alert Crossing Up" }),
  ).not.toBeInTheDocument();
  hover();
  expect(screen.getByRole("group", { name: "Drawing alerts" })).toHaveStyle({
    left: "400px",
    top: "180px",
    transform: "translate(-50%, -50%) rotate(-30deg)",
  });
  expect(
    screen.getByRole("button", { name: "Open alert Crossing Down" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Alert Other dashboard" }),
  ).not.toBeInTheDocument();
  const icon = () =>
    screen.getByRole("button", { name: "Open alert Crossing Up" });
  expect(
    within(icon()).getByRole("img", { name: "Alert enabled" }),
  ).not.toHaveClass("text-muted-foreground");
  for (const mismatch of [
    { ...inputs, resolution: "1m" as const },
    { ...inputs, session: "extended" as const },
    { ...inputs, adjustment: "split" as const },
  ]) {
    settings = mismatch;
    rerender(content());
    expect(
      within(icon()).getByRole("img", {
        name: "Alert uses different chart settings",
      }),
    ).toHaveClass("text-muted-foreground");
    fireEvent.focus(icon());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Inactive for this chart's interval, session or adjustment. This alert still runs on 1d · regular · raw.",
    );
    // Switching views must neither hide the drawing nor mutate the rule.
    expect(v2.ChartStateModel.drawingItems(store.getState())).toHaveLength(1);
    expect(alerts.drawingAlerts[0]!.enabled).toBe(true);
    fireEvent.blur(icon());
    hover();
  }
  settings = inputs;
  rerender(content());
  expect(
    within(icon()).getByRole("img", { name: "Alert enabled" }),
  ).not.toHaveClass("text-muted-foreground");
  hover(340, 180);
  expect(screen.getByRole("group", { name: "Drawing alerts" })).toHaveStyle({
    left: "400px",
    top: "180px",
  });
  expect(placement).toHaveBeenLastCalledWith("gesture", { x: 340, y: 180 });
  act(() => {
    placement.mockReturnValue({ x: 420, y: 160, angle: -45 });
    output.next({ type: "paint" });
  });
  expect(screen.getByRole("group", { name: "Drawing alerts" })).toHaveStyle({
    left: "420px",
    top: "160px",
    transform: "translate(-50%, -50%) rotate(-45deg)",
  });
  // The core can stop hitting the line once the pointer enters the nearby controls.
  act(() =>
    chart.mutate((state) => {
      state.drawings.hoveredId = undefined;
    }),
  );
  fireEvent.mouseMove(
    screen.getByRole("button", { name: "Open alert Crossing Up" }),
    { clientX: 395, clientY: 260 },
  );
  expect(screen.getByRole("group", { name: "Drawing alerts" })).toHaveStyle({
    left: "420px",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Duplicate Crossing Down" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Crossing Down" }));
  expect(alerts.duplicate).toHaveBeenCalledWith("alr_down");
  expect(alerts.remove).toHaveBeenCalledWith("alr_down");
  fireEvent.click(
    screen.getByRole("button", { name: "Open alert Crossing Up" }),
  );
  expect(alerts.edit).toHaveBeenCalledWith("alr_up");
  expect(
    screen.queryByRole("group", { name: "Alert Crossing Up" }),
  ).not.toBeInTheDocument();
  hover();
  const zoom = vi.fn();
  canvas.addEventListener("wheel", zoom);
  fireEvent.wheel(
    screen.getByRole("button", { name: "Open alert Crossing Up" }),
    { deltaY: 20 },
  );
  expect(zoom).toHaveBeenCalledOnce();
  hover();
  act(() =>
    chart.mutate((state) => {
      state.drawings.hoveredId = undefined;
    }),
  );
  fireEvent.mouseMove(canvas, { clientX: 400, clientY: 250 });
  expect(
    screen.queryByRole("group", { name: "Alert Crossing Up" }),
  ).not.toBeInTheDocument();
  hover();
  fireEvent.mouseLeave(root);
  expect(
    screen.queryByRole("group", { name: "Alert Crossing Up" }),
  ).not.toBeInTheDocument();
  hover();
  act(() =>
    chart.mutate((state) => {
      const drawing = v2.ChartStateModel.drawingItems(state).find(
        (item) => item.id === "gesture",
      );
      if (drawing) drawing.hidden = true;
    }),
  );
  expect(
    screen.queryByRole("group", { name: "Alert Crossing Up" }),
  ).not.toBeInTheDocument();
  alerts.drawingAlerts = [];
  rerender(content());
  expect(
    screen.queryByRole("group", { name: "Alert Crossing Up" }),
  ).not.toBeInTheDocument();
  unmount();
  expect(output.observed).toBe(false);
  expect(removeListener).toHaveBeenCalledWith(
    "mousemove",
    expect.any(Function),
  );
  root.remove();
});
