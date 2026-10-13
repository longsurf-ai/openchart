// Purpose: Keep the ruler context menu local and deletable even in a read-only chart.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { v2 } from "@openchart/chart-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY } from "rxjs";
import { expect, it, vi } from "vitest";
import { ChartMenus } from "@openchart/app/features/chart/components/menus";
import {
  chartIds,
  type CellDefinition,
} from "@openchart/app/features/chart/api/queries";
import { ChartContext } from "@openchart/app/lib/chart/context";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

it.each([undefined, "cagr"] as const)(
  "deletes only the current chart's temporary %s measurement through its context menu",
  async (kind) => {
    const initial = v2.createState({ id: "ccl_measurement" });
    initial.measurement = {
      kind,
      seriesId: "price",
      phase: "complete",
      start: { time: 1, price: 10 },
      end: { time: 2, price: 20 },
      contextMenu: { x: 120, y: 80 },
    };
    initial.drawings.activeTool =
      kind === "cagr" ? "cagr_measurement" : "measurement";
    const store = createChartStore(initial);
    const chart: ChartRuntime = {
      id: initial.id,
      store,
      output$: EMPTY,
      renderer: {
        canvas: document.createElement("canvas"),
      } as v2.ChartRenderer,
      mutate: (recipe) => store.setState(recipe, true),
    };
    const remove = vi.fn();
    const cell: CellDefinition = {
      id: chartIds.cell.make("ccl_measurement"),
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
      marketSources: [],
      panes: [],
    };
    render(
      <ChartContext.Provider value={chart}>
        <ChartMenus
          cell={cell}
          localStore={createChartPreferences("measurement-menu-test")}
          onMove={vi.fn()}
          onRemove={remove}
          disabled
        />
      </ChartContext.Provider>,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete measurement" }),
    );
    expect(store.getState().measurement).toBeUndefined();
    expect(store.getState().drawings.activeTool).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  },
);
