// Purpose: Preserve chart provider lifetime across background failures and reject invalid placements before mounting.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { useEffect, type ReactNode, type ComponentProps } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  chartDetail,
  chartList,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { chartWidget } from "@openchart/app/features/chart/components/widget";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";
import type { FeedClient } from "@openchart/app/lib/feed/client";
import { FeedReactContext } from "@openchart/app/lib/feed/provider";
import { type Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";

vi.mock("@openchart/app/features/chart/components/symbol-picker", () => ({
  SymbolPicker: ({
    onSelect,
  }: ComponentProps<
    typeof import("../components/symbol-picker").SymbolPicker
  >) => (
    <button
      onClick={() =>
        void onSelect(
          {
            provider: ProviderId.make("test"),
            listing: { symbol: "AAPL", currency: "USD" },
          },
          [
            {
              resolution: "1d",
              session: "regular",
              adjustment: "raw",
              modes: ["history", "delayed"],
            },
          ],
        )
      }
    >
      Select AAPL
    </button>
  ),
}));

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
        layout: { x: 0, y: 0, w: 12, h: 12 },
      },
    ],
  };
  const chart: ChartResource = {
    id: chartId,
    dashboardId: dashboard.id,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [],
    links: [],
  };
  const create = vi.fn(
    async ({ cells }: { cells: ChartResource["cells"] }) => ({
      ...chart,
      cells,
    }),
  );
  const get = vi.fn().mockResolvedValue({ items: [chart], nextCursor: null });
  const transport = {
    url: "test",
    rpc: {
      resources: {
        chart: { list: { query: get }, create: { mutate: create } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = chartList(transport, dashboard.id).queryKey;
  client.setQueryData(key, [chart]);
  const focus = vi.fn();
  const ChartPlacement = chartWidget.Provider!;
  const content = (
    children: ReactNode,
    placementId = dashboard.widgets[0]!.id,
  ) => (
    <QueryClientProvider client={client}>
      {/* The mounted grid answers ViewChart, which reads the app's Feed client. */}
      <FeedReactContext.Provider value={{} as FeedClient}>
        <ChartSelectionContext.Provider
          value={{
            activeChartId: undefined,
            focusedCells: {},
            focus,
            activeWidgetId: undefined,
            focusWidget: vi.fn(),
          }}
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
              fallbackRender={({ error }) => (
                <p role="alert">{error.message}</p>
              )}
            >
              <TooltipProvider delayDuration={0}>
                <ChartPlacement>{children}</ChartPlacement>
              </TooltipProvider>
            </ErrorBoundary>
          </WidgetContext.Provider>
        </ChartSelectionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>
  );
  return {
    chartId,
    dashboard,
    client,
    transport,
    get,
    create,
    key,
    content,
    focus,
  };
}

it("keeps the mounted provider subtree when a Chart list background refresh fails", async () => {
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

it("shows an empty state when the Dashboard has no Chart, without creating on mount", async () => {
  const { client, key, content } = setup();
  client.setQueryData(key, []);
  const view = render(content(<p>Mounted chart</p>));
  expect(screen.getByRole("button", { name: "Choose symbol" })).toBeVisible();
  expect(screen.queryByText("Mounted chart")).not.toBeInTheDocument();
  view.unmount();
  client.clear();
});

it("releases the chart runtime when the saved Chart disappears", async () => {
  const { client, get, key, content } = setup();
  const dispose = vi.fn();
  function Runtime() {
    useEffect(() => dispose, []);
    return <p>Mounted chart</p>;
  }
  const view = render(content(<Runtime />));
  get.mockResolvedValue({ items: [], nextCursor: null });
  await act(() => client.refetchQueries({ queryKey: key }));
  await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Choose symbol" })).toBeVisible();
  view.unmount();
  client.clear();
});

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

it("creates configuration only after symbol selection and reuses it on remount", async () => {
  const { client, key, content, create, dashboard, chartId } = setup();
  client.setQueryData(key, []);
  const view = render(content(<p>Mounted chart</p>));
  expect(create).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Choose symbol" }));
  await user.click(screen.getByRole("button", { name: "Select AAPL" }));
  await screen.findByText("Mounted chart");
  expect(create).toHaveBeenCalledExactlyOnceWith({
    dashboardId: dashboard.id,
    cells: [
      expect.objectContaining({
        marketSources: [
          expect.objectContaining({
            listing: { symbol: "AAPL", currency: "USD" },
          }),
        ],
      }),
    ],
  });
  expect(client.getQueryData<ChartResource[]>(key)?.[0]?.id).toBe(chartId);
  view.unmount();
  const { unmount } = render(content(<p>Reopened chart</p>));
  expect(screen.getByText("Reopened chart")).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  unmount();
  client.clear();
});
