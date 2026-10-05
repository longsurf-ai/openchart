// Purpose: Keep the quick alert attached to the clicked price and series, not subsequent chart state.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import { Draw } from "@openchart/chart-core/render";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { ProviderId } from "@openchart/market";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY } from "rxjs";
import { afterEach, expect, test, vi } from "vitest";

import { createCell } from "@openchart/app/features/chart/api/queries";
import {
  ChartAlertButton,
  ChartAlertContext,
} from "@openchart/app/features/chart/components/alert-button";
import { getMainSeries } from "@openchart/app/features/chart/utils/resource";
import { ChartContext } from "@openchart/app/lib/chart/context";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

afterEach(() => vi.unstubAllGlobals());

test("the axis shortcut freezes the clicked price and series while its keyboard menu is open", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1h", session: "extended", adjustment: "split" },
  );
  const main = getMainSeries(cell);
  const state = v2.createState({ id: cell.id });
  v2.ChartStateUtils.addSeries(state, { id: main.id, type: "Line" });
  v2.ChartStateModel.getSeriesObject(state, main.id)!.role = "main";
  const store = createChartStore(state);
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.getBoundingClientRect = () =>
    new DOMRect(
      0,
      0,
      state.config.chart.dimensions.width,
      state.config.chart.dimensions.height,
    );
  // Overlay/chart handlers may stop bubbling; V1's window capture still sees movement.
  canvas.addEventListener("pointermove", (event) => event.stopPropagation());
  const valueAtY = vi.fn(() => 187.534);
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    renderer: {
      canvas,
      seriesValueAtY: valueAtY,
    } as unknown as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const create = vi.fn();
  const actions = {
    create,
    pending: false,
    agentAvailable: false,
    lines: [],
    edit: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    error: null,
  };
  const content = (symbol: string) => (
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <ChartAlertContext.Provider value={actions}>
          <section data-chart-cell={cell.id} aria-label="Chart cell">
            <div ref={(node) => node?.append(canvas)} />
            <ChartAlertButton
              cell={{
                ...cell,
                marketSources: cell.marketSources.map((source) => ({
                  ...source,
                  listing: { ...source.listing, symbol },
                })),
              }}
              alertable={new Map()}
            />
          </section>
        </ChartAlertContext.Provider>
      </ChartContext.Provider>
    </TooltipProvider>
  );
  const { rerender, unmount } = render(content("AAPL"));
  const layout = Chart.computeLayout(state.config);
  const edge = layout.areaX + layout.areaWidth;
  // jsdom does not supply PointerEvent coordinates; native MouseEvent carries the same fields.
  const move = (x: number, y: number, buttons = 0) =>
    fireEvent(
      canvas,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        buttons,
      }),
    );
  move(edge - 100, 150);
  expect(
    screen.queryByRole("button", { name: /Add alert/ }),
  ).not.toBeInTheDocument();
  move(edge - 10, 150);
  const button = screen.getByRole("button", { name: "Add alert at 187.534" });
  expect(button).toHaveStyle({
    width: `${Draw.VALUE_TAG_HEIGHT}px`,
    height: `${Draw.VALUE_TAG_HEIGHT}px`,
    top: "150px",
  });
  expect(button).toHaveClass("transition-none");
  expect(button).not.toHaveClass("transition-all");
  expect(button).not.toHaveAttribute("title");
  move(edge - 10, 180);
  expect(button).toHaveStyle({ top: "180px" });
  move(edge - 10, 150);
  expect(valueAtY).toHaveBeenLastCalledWith(main.id, 150);
  act(() => button.focus());
  const user = userEvent.setup();
  // A repaint with a stationary pointer changes the value before the click.
  valueAtY.mockReturnValue(190.5);
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("menuitem", { name: "Trigger agent at threshold" }),
  ).toHaveAttribute("aria-disabled", "true");
  rerender(content("MSFT"));
  move(edge - 10, 200);
  await user.click(
    screen.getByRole("menuitem", { name: "Add alert at threshold" }),
  );
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      threshold: 190.5,
      inputs: {
        provider: "test",
        listing: { symbol: "AAPL", currency: "USD" },
        resolution: "1h",
        session: "extended",
        adjustment: "split",
      },
    }),
    false,
  );
  expect(canvas).toHaveFocus();
  move(edge - 10, 200, 1);
  expect(
    screen.queryByRole("button", { name: /Add alert/ }),
  ).not.toBeInTheDocument();
  move(edge - 10, layout.areaHeight + 1);
  expect(
    screen.queryByRole("button", { name: /Add alert/ }),
  ).not.toBeInTheDocument();
  valueAtY.mockReturnValue(0.0034);
  move(edge - 10, 150);
  expect(
    screen.getByRole("button", { name: "Add alert at 0.0034" }),
  ).toBeVisible();
  fireEvent(
    window,
    new MouseEvent("pointermove", {
      clientX: state.config.chart.dimensions.width + 1,
      clientY: 150,
    }),
  );
  expect(
    screen.queryByRole("button", { name: /Add alert/ }),
  ).not.toBeInTheDocument();
  move(edge - 10, 150);
  unmount();
  const calls = valueAtY.mock.calls.length;
  fireEvent(
    window,
    new MouseEvent("pointermove", { clientX: edge - 10, clientY: 150 }),
  );
  expect(valueAtY).toHaveBeenCalledTimes(calls);
});

test("the main pane + offers its price, then each alertable overlay Indicator output", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const base = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1h", session: "extended", adjustment: "split" },
  );
  const overlay = (id: string, output: string) => ({
    id,
    role: "normal",
    source: { kind: "indicator", indicatorId: "ind_bb", output },
  });
  const cell = {
    ...base,
    panes: base.panes.map((pane, index) =>
      index
        ? pane
        : {
            ...pane,
            series: [
              ...pane.series,
              overlay("srs_basis", "basis"),
              overlay("srs_fill", "fill"),
            ],
          },
    ),
  } as typeof base;
  const main = getMainSeries(cell);
  const state = v2.createState({ id: cell.id });
  v2.ChartStateUtils.addSeries(state, { id: main.id, type: "Line" });
  v2.ChartStateModel.getSeriesObject(state, main.id)!.role = "main";
  for (const id of ["srs_basis", "srs_fill"])
    v2.ChartStateUtils.addSeries(state, { id, type: "Line" });
  const store = createChartStore(state);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    new DOMRect(
      0,
      0,
      state.config.chart.dimensions.width,
      state.config.chart.dimensions.height,
    );
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    renderer: {
      canvas,
      seriesValueAtY: (id: string) =>
        id === main.id ? 187.5 : id === "srs_basis" ? 185.25 : 1,
    } as unknown as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const create = vi.fn();
  render(
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <ChartAlertContext.Provider
          value={{
            create,
            pending: false,
            agentAvailable: false,
            lines: [],
            edit: vi.fn(),
            duplicate: vi.fn(),
            remove: vi.fn(),
            error: null,
          }}
        >
          <section data-chart-cell={cell.id}>
            <div ref={(node) => node?.append(canvas)} />
            {/* IndicatorSource registered `basis` but not the `fill` between bands. */}
            <ChartAlertButton
              cell={cell}
              alertable={new Map([["ind_bb", new Set(["basis"])]])}
            />
          </section>
        </ChartAlertContext.Provider>
      </ChartContext.Provider>
    </TooltipProvider>,
  );
  const layout = Chart.computeLayout(state.config);
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: layout.areaX + layout.areaWidth - 10,
      clientY: 150,
    }),
  );
  act(() => screen.getByRole("button", { name: "Add alert at 187.5" }).focus());
  await userEvent.setup().keyboard("{Enter}");
  const groups = screen.getAllByRole("group");
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
    "AAPL · 187.5",
    "basis · 185.25",
  ]);
  await userEvent.click(
    within(groups[1]!).getByRole("menuitem", {
      name: "Add alert at threshold",
    }),
  );
  expect(create).toHaveBeenCalledWith(
    {
      threshold: 185.25,
      indicator: {
        indicatorId: "ind_bb",
        output: "basis",
        label: "AAPL basis",
      },
    },
    false,
  );
});
