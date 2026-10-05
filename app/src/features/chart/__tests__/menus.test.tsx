// Purpose: Verify virtual chart menus preserve target identity and Radix keyboard/dialog behavior.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Drawing, Series, v2 } from "@openchart/chart-core";
import { ProviderId } from "@openchart/market";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createCell } from "@openchart/app/features/chart/api/queries";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { ChartMenus } from "@openchart/app/features/chart/components/menus";
import { ChartAlertContext } from "@openchart/app/features/chart/components/alert-button";
import type { DrawingResource } from "@openchart/app/lib/chart/drawings";
import { SeriesLegend } from "@openchart/app/features/chart/components/series-legend";
import { AxisControls } from "@openchart/app/features/chart/components/axis-controls";
import { ChartContext } from "@openchart/app/lib/chart/context";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import { chartSettings } from "@openchart/app/stores/chart";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

beforeEach(() => {
  localStorage.clear();
  chartSettings.setState({ timezone: "local" });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
    1024,
  );
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
    768,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(openSeriesMenu = true, drawingOnly = false) {
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const seriesId = cell.panes[0]!.series[0]!.id;
  const state = v2.createState({ id: cell.id });
  v2.ChartStateUtils.addSeries(state, { id: seriesId, type: "Line" });
  const store = createChartStore(state);
  const localStore = createChartPreferences(cell.id);
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.getBoundingClientRect = () => new DOMRect(100, 60, 600, 400);
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    renderer: { canvas } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((draft) => {
        recipe(draft);
      }, true),
  };
  const onMove = vi.fn();
  const createDrawing = vi.fn();
  const saveDrawing = vi.fn<(id: string) => Promise<DrawingResource>>();
  render(
    <ChartContext.Provider value={chart}>
      <ChartAlertContext.Provider
        value={{
          create: vi.fn(),
          createDrawing,
          pending: false,
          agentAvailable: false,
          lines: [],
          edit: vi.fn(),
          duplicate: vi.fn(),
          remove: vi.fn(),
          error: null,
        }}
      >
        <div ref={(node) => node?.append(canvas)} />
        <TooltipProvider delayDuration={0}>
          <AxisControls localStore={localStore} />
          <SeriesLegend
            seriesIds={[seriesId]}
            sourceId={seriesId}
            main
            order={0}
            localStore={localStore}
            disabled={false}
            describe={() => ({ title: "AAPL", content: null })}
          />
        </TooltipProvider>
        <ChartMenus
          drawingOnly={drawingOnly}
          saveDrawing={saveDrawing}
          cell={cell}
          localStore={localStore}
          onMove={onMove}
          onRemove={vi.fn()}
        />
      </ChartAlertContext.Provider>
    </ChartContext.Provider>,
  );
  canvas.focus();
  if (openSeriesMenu)
    act(() =>
      chart.mutate((draft) => {
        draft.seriesContextMenu = {
          seriesId,
          x: 25,
          y: 35,
          clientX: 125,
          clientY: 95,
        };
      }),
    );
  return {
    chart,
    cell,
    seriesId,
    localStore,
    onMove,
    canvas,
    user: userEvent.setup(),
    createDrawing,
    saveDrawing,
  };
}

it("only offers editing for a drawing-scoped chart", async () => {
  const { chart, user } = setup(true, true);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const drawing = Drawing.create("parallel_channel", [
    { time: 1, price: 1 },
    { time: 2, price: 2 },
    { time: 2, price: 3 },
  ]);
  act(() =>
    chart.mutate((state) => {
      delete state.seriesContextMenu;
      v2.ChartStateModel.upsertDrawingObject(state, drawing);
      state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
    }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Drawing style…" }),
  ).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Lock drawing" })).toBeVisible();
  for (const name of ["Create alert…", "Delete drawing", "Hide drawing"])
    expect(screen.queryByRole("menuitem", { name })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Drawing style…" }));
  expect(
    await screen.findByRole("dialog", { name: "Drawing style" }),
  ).toBeVisible();
});

it.each(["ray", "fib_retracement", "fib_channel"] as const)(
  "waits for the %s save and binds the Resource envelope when creating an alert",
  async (kind) => {
    const { chart, cell, user, createDrawing, saveDrawing } = setup(false);
    const drawing = Drawing.create(
      kind,
      [
        { time: 1, price: 100 },
        { time: 2, price: 110 },
        ...(kind === "fib_channel" ? [{ time: 1, price: 120 }] : []),
      ],
      { name: "Support" },
    );
    let resolve!: (value: DrawingResource) => void;
    saveDrawing.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() =>
      chart.mutate((state) => {
        v2.ChartStateModel.upsertDrawingObject(state, drawing);
        state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Create alert…" }));
    expect(saveDrawing).toHaveBeenCalledWith(drawing.id);
    expect(createDrawing).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ id: "drw_persisted", data: drawing } as DrawingResource),
    );
    expect(createDrawing).toHaveBeenCalledWith({
      drawingId: "drw_persisted",
      name: "Support",
      type: kind,
      inputs: {
        provider: "test",
        listing: { symbol: "AAPL", currency: "USD" },
        resolution: cell.resolution,
        session: cell.session,
        adjustment: cell.adjustment,
      },
    });
  },
);

it.each([
  "logarithmic",
  "percentage",
  "indexed",
  "secondary",
  "calendar",
  "ellipse",
])("disables drawing alerts for unsupported %s geometry", async (kind) => {
  const { chart } = setup(false);
  act(() =>
    chart.mutate((state) => {
      const drawing = Drawing.create(kind === "ellipse" ? "ellipse" : "ray", [
        {
          time: 1,
          price: 100,
          ...(kind === "secondary" ? { axisId: "secondary" } : {}),
        },
        { time: 2, price: 110 },
      ]);
      if (kind === "logarithmic" || kind === "percentage" || kind === "indexed")
        state.config.yAxis.axes[0]!.mode = kind;
      if (kind === "calendar") state.config.xAxis.axes[0]!.mode = "linear";
      v2.ChartStateModel.upsertDrawingObject(state, drawing);
      state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
    }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Create alert…" }),
  ).toHaveAttribute("aria-disabled", "true");
});

it.each([
  "freehand",
  "polyline",
  "rectangle",
  "triangle",
  "curved_line",
] as const)("offers an alert on a %s boundary", async (kind) => {
  const { chart } = setup(false);
  act(() =>
    chart.mutate((state) => {
      const drawing = Drawing.create(kind, [
        { time: 1, price: 100 },
        { time: 2, price: 110 },
        { time: 3, price: 90 },
      ]);
      v2.ChartStateModel.upsertDrawingObject(state, drawing);
      state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
    }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Create alert…" }),
  ).not.toHaveAttribute("aria-disabled", "true");
});

it.each([false, true])(
  "enables a drawing on a custom main-price axis with omitted anchors (explicit first: %s)",
  async (explicit) => {
    const { chart, seriesId } = setup(false);
    act(() =>
      chart.mutate((state) => {
        v2.ChartStateUtils.addSeries(state, { id: "comparison", type: "Line" });
        v2.ChartStateUtils.useOwnAxis(state, seriesId);
        const mainAxisId = Series.getYAxisId(
          v2.ChartStateUtils.getSeries(state, seriesId)!,
        );
        const drawing = Drawing.create("ray", [
          { time: 1, price: 100, ...(explicit ? { axisId: mainAxisId } : {}) },
          { time: 2, price: 110 },
        ]);
        v2.ChartStateModel.upsertDrawingObject(state, drawing);
        state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Create alert…" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  },
);

it.each([
  "different active axis",
  "first comparison on shared axis",
  "main price not loaded",
])(
  "disables drawing alerts when the renderer uses another timeline: %s",
  async (kind) => {
    const { chart, seriesId } = setup(false);
    act(() =>
      chart.mutate((state) => {
        v2.ChartStateModel.getSeriesObject(state, seriesId)!.role = "main";
        const comparisonId = v2.ChartStateUtils.addSeries(state, {
          id: "comparison",
          type: "Line",
        });
        if (kind === "different active axis") {
          v2.ChartStateUtils.bindSeriesToXAxis(
            state,
            comparisonId,
            "comparison-time",
          );
          v2.ChartStateUtils.setActiveXAxis(state, "comparison-time");
        } else if (kind === "main price not loaded") {
          v2.ChartStateUtils.removeSeries(state, seriesId);
        } else state.panes[0]!.objectIds.reverse();
        const drawing = Drawing.create("ray", [
          { time: 1, price: 100 },
          { time: 2, price: 110 },
        ]);
        v2.ChartStateModel.upsertDrawingObject(state, drawing);
        state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Create alert…" }),
    ).toHaveAttribute("aria-disabled", "true");
  },
);

it.each(["axis", "series", "drawing"] as const)(
  "keeps viewport actions out of the %s context menu",
  async (kind) => {
    const { chart, seriesId, user } = setup(false);
    if (kind === "axis") {
      await user.click(
        screen.getByRole("button", { name: "Price axis settings" }),
      );
    } else {
      act(() =>
        chart.mutate((state) => {
          if (kind === "series") {
            state.seriesContextMenu = {
              seriesId,
              x: 25,
              y: 35,
              clientX: 125,
              clientY: 95,
            };
          } else {
            const drawing = Drawing.create("freehand", [
              { time: 1, price: 1 },
              { time: 2, price: 2 },
            ]);
            v2.ChartStateModel.upsertDrawingObject(state, drawing);
            state.drawings.contextMenu = { id: drawing.id, x: 25, y: 35 };
          }
        }),
      );
    }
    const menu = await screen.findByRole("menu", {
      name: "Chart context menu",
    });
    expect(
      within(menu).queryByRole("menuitem", { name: "Fit data" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitem", { name: "Go to latest" }),
    ).not.toBeInTheDocument();
    expect(menu).toHaveTextContent(
      kind === "drawing"
        ? "Drawing style…"
        : kind === "series"
          ? "Move to pane"
          : "Price axis",
    );
  },
);

it.each([
  "Auto scale",
  "Logarithmic scale",
  "Time zone: Local",
  "Price axis settings",
])(
  "shows the shared tooltip for %s on hover and keyboard focus",
  async (label) => {
    const { user } = setup(false);
    const button = screen.getByRole("button", { name: label });
    expect(button).not.toHaveAttribute("title");
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
    await user.unhover(button);
    act(() => button.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  },
);

it("restores axis shortcuts using the existing preferences and context menu", async () => {
  const { chart, localStore, user } = setup(false);
  await user.click(screen.getByRole("button", { name: "Auto scale" }));
  expect(localStore.getState().axes.right?.autoScale).toBe(false);
  await user.click(screen.getByRole("button", { name: "Logarithmic scale" }));
  expect(localStore.getState().axes.right?.mode).toBe("logarithmic");
  await user.click(screen.getByRole("button", { name: "Price axis settings" }));
  expect(chart.store.getState().yAxisContextMenu?.axisId).toBe("right");
  expect(
    await screen.findByRole("menu", { name: "Chart context menu" }),
  ).toHaveTextContent("Price axis");
});

it("offers flat scale choices while keeping automatic range and inversion independent", async () => {
  const { chart, localStore, user } = setup(false);
  act(() => {
    localStore.setState({
      axes: { right: { autoScale: true, invertScale: true } },
    });
    chart.mutate((state) => {
      state.config.yAxis.axes[0]!.invertScale = true;
    });
  });
  const open = () =>
    user.click(screen.getByRole("button", { name: "Price axis settings" }));
  await open();
  const menu = screen.getByRole("menu", { name: "Chart context menu" });
  expect(
    within(menu).queryByRole("menuitem", { name: "Fit data" }),
  ).not.toBeInTheDocument();
  expect(
    within(menu).queryByRole("menuitem", { name: "Go to latest" }),
  ).not.toBeInTheDocument();
  expect(
    within(menu).queryByRole("menuitem", { name: "Scale" }),
  ).not.toBeInTheDocument();
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent),
  ).toEqual(["Linear", "Logarithmic", "Percentage", "Indexed to 100"]);
  expect(screen.getByRole("menuitemradio", { name: "Linear" })).toBeChecked();
  await user.click(screen.getByRole("menuitemradio", { name: "Logarithmic" }));
  expect(
    screen.queryByRole("menuitem", { name: "Fit data" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Go to latest" }),
  ).not.toBeInTheDocument();
  expect(localStore.getState().axes.right).toMatchObject({
    mode: "logarithmic",
    autoScale: true,
    invertScale: true,
  });
  await open();
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "Auto scale" }),
  );
  expect(localStore.getState().axes.right).toMatchObject({
    mode: "logarithmic",
    autoScale: false,
    invertScale: true,
  });
  await open();
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "Invert scale" }),
  );
  expect(localStore.getState().axes.right).toMatchObject({
    mode: "logarithmic",
    autoScale: false,
    invertScale: false,
  });
});

it("keeps scale types disabled for an axis that locks zero", async () => {
  const { chart, user } = setup(false);
  act(() =>
    chart.mutate((state) => {
      state.config.yAxis.axes[0]!.lockZero = true;
    }),
  );
  await user.click(screen.getByRole("button", { name: "Price axis settings" }));
  for (const item of screen.getAllByRole("menuitemradio")) {
    expect(item).toHaveAttribute("aria-disabled", "true");
  }
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Auto scale" }),
  ).not.toHaveAttribute("aria-disabled", "true");
});

it.each(["left", "right"] as const)(
  "keeps scale actions separate and targets the %s secondary axis independently",
  async (side) => {
    const { chart, localStore, user } = setup(false);
    act(() =>
      chart.mutate((state) => {
        state.config.yAxis.axes.push({
          ...state.config.yAxis.axes[0]!,
          id: "secondary",
          side,
        });
      }),
    );
    const axes = screen.getAllByRole("group", { name: "Axis controls" });
    expect(axes).toHaveLength(2);
    expect(axes[1]!.style.top).toBe(axes[0]!.style.top);
    const scales = within(axes[0]!).getByRole("group", {
      name: "Axis scale controls",
    });
    expect(within(scales).getAllByRole("button")).toHaveLength(2);
    expect(
      within(scales).queryByRole("button", { name: "Price axis settings" }),
    ).not.toBeInTheDocument();
    expect(
      within(scales).queryByRole("button", { name: /Time zone/ }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("group", { name: "Chart axis settings" }),
      ).getByRole("button", { name: "Time zone: Local" }),
    ).toBeInTheDocument();
    await user.click(
      within(axes[1]!).getByRole("button", { name: "Logarithmic scale" }),
    );
    expect(localStore.getState().axes.secondary?.mode).toBe("logarithmic");
    expect(localStore.getState().axes.right).toBeUndefined();
    expect(screen.getAllByRole("button", { name: /Time zone/ })).toHaveLength(
      1,
    );
    for (const axis of axes) {
      expect(
        within(axis).queryByRole("button", { name: "Price axis settings" }),
      ).not.toBeInTheDocument();
    }
    expect(
      screen.getAllByRole("button", { name: "Price axis settings" }),
    ).toHaveLength(1);
  },
);

it("changes the shared display timezone from the footer and restores focus on close", async () => {
  const { user } = setup(false);
  await user.click(screen.getByRole("button", { name: "Time zone: Local" }));
  expect(screen.getByRole("menuitemradio", { name: "Local" })).toBeChecked();
  await user.click(screen.getByRole("menuitemradio", { name: "New York" }));
  expect(chartSettings.getState().timezone).toBe("America/New_York");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Time zone: New York" }),
    ).toHaveFocus(),
  );
  await user.keyboard("{Enter}");
  expect(screen.getByRole("menuitemradio", { name: "New York" })).toBeChecked();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
});

it("keeps one settings footer and per-pane scale controls with a mixed middle pane", async () => {
  const { chart, user } = setup(false);
  act(() =>
    chart.mutate((state) => {
      for (const type of ["Line", "Line", "Histogram"]) {
        v2.ChartStateUtils.addSeries(state, { type, pane: 1, yAxisId: "macd" });
      }
      v2.ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 2,
        yAxisId: "aroon",
      });
      state.hoveredAxisId = "macd";
    }),
  );
  const footer = screen.getByRole("group", { name: "Chart axis settings" });
  expect(
    within(footer).getByRole("button", { name: "Time zone: Local" }),
  ).toBeInTheDocument();
  const axes = screen.getAllByRole("group", { name: "Axis controls" });
  expect(axes).toHaveLength(3);
  for (const axis of axes) {
    expect(within(axis).getAllByRole("button")).toHaveLength(2);
    expect(
      within(axis).queryByRole("button", { name: "Price axis settings" }),
    ).not.toBeInTheDocument();
  }
  expect(
    within(axes[1]!).getByRole("group", { name: "Axis scale controls" }),
  ).toHaveClass("opacity-100");
  expect(
    within(axes[1]!).getByRole("button", { name: "Logarithmic scale" }),
  ).toBeEnabled();
  expect(
    screen.getAllByRole("button", { name: "Price axis settings" }),
  ).toHaveLength(1);
  await user.click(
    within(footer).getByRole("button", { name: "Price axis settings" }),
  );
  expect(chart.store.getState().yAxisContextMenu?.axisId).toBe("right");
});

it("keeps one timezone control available with only left or hidden price axes", () => {
  const { chart } = setup(false);
  act(() =>
    chart.mutate((state) => {
      state.config.yAxis.axes[0]!.side = "left";
    }),
  );
  expect(screen.getAllByRole("button", { name: /Time zone/ })).toHaveLength(1);
  act(() =>
    chart.mutate((state) => {
      state.config.yAxis.axes[0]!.visible = false;
    }),
  );
  expect(
    screen.queryByRole("button", { name: "Price axis settings" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Time zone: Local" }),
  ).toBeInTheDocument();
});

it("anchors directly at the canvas hit and uses Radix keyboard submenus with stable pane IDs", async () => {
  const { cell, onMove, canvas, user } = setup();
  const menu = await screen.findByRole("menu", { name: "Chart context menu" });
  expect(
    screen.queryByRole("button", { name: "Chart context menu" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    // Radix positions its portal wrapper, which has no accessible role.
    // eslint-disable-next-line testing-library/no-node-access
    expect(menu.parentElement).toHaveStyle({
      transform: "translate(125px, 95px)",
    }),
  );
  const move = screen.getByRole("menuitem", { name: "Move to pane" });
  act(() => move.focus());
  await user.keyboard("{ArrowRight}");
  const pane = await screen.findByRole("menuitem", { name: "Pane 1" });
  await waitFor(() => expect(pane).toHaveFocus());
  await user.keyboard("{Enter}");
  expect(onMove).toHaveBeenCalledWith(
    cell.panes[0]!.series[0]!.id,
    cell.panes[0]!.id,
  );
  await waitFor(() => expect(canvas).toHaveFocus());
});

it("keeps visibility and style on the legend while placement retains its toggles", async () => {
  const { seriesId, localStore, user } = setup(false);
  await user.click(screen.getByRole("button", { name: "Hide series" }));
  expect(localStore.getState().series[seriesId]?.visible).toBe(false);
  await user.click(screen.getByRole("button", { name: "Show series" }));
  expect(localStore.getState().series[seriesId]?.visible).toBeUndefined();
  expect(screen.getByRole("button", { name: "Hide series" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Series placement" }));
  const menu = await screen.findByRole("menu", { name: "Chart context menu" });
  expect(
    within(menu).queryByRole("menuitem", { name: /Hide series|Show series/ }),
  ).not.toBeInTheDocument();
  expect(
    within(menu).queryByRole("menuitem", {
      name: /Series style|Series settings/,
    }),
  ).not.toBeInTheDocument();
  expect(within(menu).queryByRole("separator")).not.toBeInTheDocument();
  expect(
    within(menu).getByRole("menuitemcheckbox", { name: "Magnet" }),
  ).not.toBeChecked();
  await user.click(
    within(menu).getByRole("menuitemcheckbox", {
      name: "Normalize comparisons",
    }),
  );
  expect(localStore.getState().comparison).toBe(true);
  await user.click(screen.getByRole("button", { name: "Series placement" }));
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Normalize comparisons" }),
  ).toBeChecked();
});

it("keeps focus and captured series identity in the legend's style dialog", async () => {
  const { chart, seriesId, localStore, canvas, user } = setup(false);
  await user.click(screen.getByRole("button", { name: "Series settings" }));
  await screen.findByRole("dialog", { name: "Series settings" });
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Type")).toHaveFocus();
  expect(chart.store.getState().seriesContextMenu).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: "#ff0000" },
  });
  expect(localStore.getState().series[seriesId]?.color).toBe("#ff0000");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(canvas).toHaveFocus());
});

it("binds Magnet and axis placement to the series whose menu was opened", async () => {
  const { chart, seriesId, localStore, user } = setup();
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Magnet" }));
  expect(chart.store.getState().magnetSeriesId).toBe(seriesId);
  act(() =>
    chart.mutate((state) => {
      state.seriesContextMenu = {
        seriesId,
        x: 25,
        y: 35,
        clientX: 125,
        clientY: 95,
      };
    }),
  );
  const move = screen.getByRole("menuitem", { name: "Move axis to" });
  act(() => move.focus());
  await user.keyboard("{ArrowRight}");
  await user.click(await screen.findByRole("menuitem", { name: "Left" }));
  expect(localStore.getState().series[seriesId]).toMatchObject({
    ownAxis: true,
  });
  expect(localStore.getState().series[seriesId]?.type).toBeUndefined();
  expect(localStore.getState().axes[`${seriesId}:axis`]).toMatchObject({
    side: "left",
  });
});
