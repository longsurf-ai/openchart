// Purpose: Preserve chart provider lifetime across background failures and reject invalid placements before mounting.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { useEffect, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { chartWidget } from "@openchart/app/features/chart/components/widget";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";

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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const chartId = defineId("cht", "Chart.ID").create();
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").create(),
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    name: "Test",
    favorite: false,
    widgets: [
      {
        id: defineId("wdg", "WidgetPlacement.ID").create(),
        kind: "chart",
        resourceId: chartId,
        layout: { x: 0, y: 0, w: 12, h: 12 },
      },
    ],
  };
  const get = vi.fn().mockResolvedValue(dashboard);
  const transport = {
    url: "test",
    rpc: { resources: { dashboard: { get: { query: get } } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = dashboardQueryOptions(transport, dashboard.id).queryKey;
  client.setQueryData(key, dashboard);
  const focus = vi.fn();
  const ChartPlacement = chartWidget.Provider!;
  const content = (
    children: ReactNode,
    placementId = dashboard.widgets[0]!.id,
  ) => (
    <QueryClientProvider client={client}>
      <ChartSelectionContext.Provider
        value={{ activeChartId: undefined, focusedCells: {}, focus }}
      >
        <WidgetContext.Provider
          value={{
            placementId,
            dashboardId: dashboard.id,
            transport,
            holdControls: () => () => {},
            placeBeside: vi.fn(),
          }}
        >
          <ErrorBoundary
            fallbackRender={({ error }) => <p role="alert">{error.message}</p>}
          >
            <TooltipProvider delayDuration={0}>
              <ChartPlacement>{children}</ChartPlacement>
            </TooltipProvider>
          </ErrorBoundary>
        </WidgetContext.Provider>
      </ChartSelectionContext.Provider>
    </QueryClientProvider>
  );
  return { chartId, dashboard, client, transport, get, key, content, focus };
}

it("keeps the mounted provider subtree when a Dashboard background refresh fails", async () => {
  const { client, get, key, content } = setup();
  const mount = vi.fn();
  const dispose = vi.fn();
  function Runtime() {
    useEffect(() => {
      mount();
      return dispose;
    }, []);
    return <p>Mounted chart</p>;
  }
  const view = render(content(<Runtime />));
  get.mockRejectedValue(new Error("Offline"));
  await act(() => client.refetchQueries({ queryKey: key }));
  await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
  expect(screen.getByText("Mounted chart")).toBeVisible();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});

it("releases the chart runtime when its Dashboard disappears during a refresh", async () => {
  const { client, get, key, content } = setup();
  const dispose = vi.fn();
  function Runtime() {
    useEffect(() => dispose, []);
    return <p>Mounted chart</p>;
  }
  const view = render(content(<Runtime />));
  expect(screen.getByText("Mounted chart")).toBeVisible();
  get.mockRejectedValue(
    Object.assign(new Error("Dashboard not found"), {
      data: { code: "NOT_FOUND" },
    }),
  );
  await act(() => client.refetchQueries({ queryKey: key }));
  await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Mounted chart")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.unmount();
  client.clear();
});

it.each(["missing", "duplicate"] as const)(
  "sends a %s chart binding to the Host boundary before mounting",
  (kind) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { dashboard, client, key, content } = setup();
    const placement = {
      ...dashboard.widgets[0]!,
      id: defineId("wdg", "WidgetPlacement.ID").create(),
      resourceId:
        kind === "missing" ? undefined : dashboard.widgets[0]!.resourceId,
    };
    client.setQueryData(key, () => ({
      ...dashboard,
      widgets: [...dashboard.widgets, placement],
    }));
    const view = render(content(<p>Mounted chart</p>, placement.id));
    expect(screen.getByRole("alert")).toHaveTextContent(
      kind === "missing" ? "has no chart" : "already displayed",
    );
    expect(screen.queryByText("Mounted chart")).not.toBeInTheDocument();
    view.unmount();
    client.clear();
  },
);

it("selects the owning chart when its widget toolbar is used without a mounted renderer", async () => {
  const { chartId, dashboard, client, transport, content, focus } = setup();
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  client.setQueryData<ChartResource>(chartDetail(transport, chartId).queryKey, {
    id: chartId,
    dashboardId: dashboard.id,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [cell],
    links: [],
  });
  const Controls = chartWidget.Controls!;
  const view = render(content(<Controls />));
  const user = userEvent.setup();
  const grid = screen.getByRole("button", { name: "Grid Single chart" });
  expect(grid).not.toHaveAttribute("title");
  await user.hover(grid);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Chart grid");
  await user.click(grid);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(focus).toHaveBeenCalledWith(chartId, cell.id);
  view.unmount();
  client.clear();
});
