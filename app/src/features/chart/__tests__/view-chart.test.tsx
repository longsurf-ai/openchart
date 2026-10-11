// Purpose: Prove a chart answers ViewChart by saving the listing into the Dashboard's target cell.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { defineId } from "@openchart/identifier";
import { ProviderId, type ProviderListing } from "@openchart/market";
import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import { useContext, type PropsWithChildren } from "react";

import {
  chartDetail,
  createCell,
  type CellDefinition,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { useViewChart } from "@openchart/app/features/chart/hooks/use-view-chart";
import { getMainSource } from "@openchart/app/features/chart/utils/resource";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";
import type { FeedClient } from "@openchart/app/lib/feed/client";
import { FeedReactContext } from "@openchart/app/lib/feed/provider";
import type { IntentRouter } from "@openchart/app/lib/widget/intent/intent";
import { viewChart } from "@openchart/app/lib/widget/intent/intents";
import {
  WidgetIntentProvider,
  IntentRouterContext,
} from "@openchart/app/lib/widget/intent/provider";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";
import {
  findErrorToast,
  renderWithToaster as render,
} from "@openchart/app/testing/test-utils";

const listing = (symbol: string, provider = "test"): ProviderListing => ({
  provider: ProviderId.make(provider),
  listing: { symbol, currency: "USD" },
});
const daily = {
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
  modes: ["history", "live"],
} as const;

function ViewChart() {
  useViewChart();
  return null;
}

function setup({ focused }: { focused?: number } = {}) {
  const cell = (symbol: string) =>
    createCell(listing(symbol), {
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
    });
  const chart: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1x2",
    cells: [cell("AAPL"), cell("MSFT")],
    links: [],
  };
  const patch = vi.fn(
    async (input: {
      operations: { path: string; value: CellDefinition[] }[];
    }) => ({
      ...chart,
      revision: 2,
      cells: input.operations.find((op) => op.path === "/cells")!.value,
    }),
  );
  const getCapabilities = vi.fn<
    (listing: ProviderListing) => Promise<(typeof daily)[]>
  >(async () => [daily]);
  const transport = {
    url: "test",
    rpc: { resources: { chart: { patch: { mutate: patch } } } },
  } as unknown as AppTransport;
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(chartDetail(transport, chart.id).queryKey, chart);
  const focusedCells =
    focused === undefined ? {} : { [chart.id]: chart.cells[focused]!.id };
  let router!: IntentRouter;
  function CaptureRouter({ children }: PropsWithChildren) {
    router = useContext(IntentRouterContext)!;
    return children;
  }
  render(
    <QueryClientProvider client={client}>
      <FeedReactContext.Provider
        value={{ bars: { getCapabilities } } as unknown as FeedClient}
      >
        <ChartSelectionContext.Provider
          value={{ activeChartId: chart.id, focusedCells, focus: vi.fn() }}
        >
          <WidgetIntentProvider>
            <CaptureRouter>
              <WidgetContext.Provider
                value={{
                  placementId: "wdg_chart",
                  dashboardId: "dsh_test",
                  transport,
                  holdControls: () => () => {},
                  placeBeside: vi.fn(),
                }}
              >
                <ChartGridProvider chartId={chart.id} transport={transport}>
                  <ViewChart />
                </ChartGridProvider>
              </WidgetContext.Provider>
            </CaptureRouter>
          </WidgetIntentProvider>
        </ChartSelectionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>,
  );
  const raise = (symbol: string, provider?: string) =>
    router.raise(
      viewChart,
      { listing: listing(symbol, provider) },
      { placementId: "wdg_list" },
    );
  const savedSymbols = () =>
    patch.mock
      .lastCall![0].operations.find((op) => op.path === "/cells")!
      .value.map((saved) => getMainSource(saved).listing.symbol);
  return { chart, patch, getCapabilities, raise, savedSymbols };
}

test("shows the listing in the focused cell and leaves the other cell alone", async () => {
  const { patch, getCapabilities, raise, savedSymbols } = setup({ focused: 1 });
  await expect(raise("NVDA")).resolves.toEqual({
    status: "handled",
    placementId: "wdg_chart",
  });
  expect(getCapabilities).toHaveBeenCalledExactlyOnceWith(listing("NVDA"));
  expect(patch).toHaveBeenCalledOnce();
  expect(patch.mock.lastCall![0]).toMatchObject({ expectedRevision: 1 });
  expect(savedSymbols()).toEqual(["AAPL", "NVDA"]);
});

test("without a focused cell the first visible cell shows the listing", async () => {
  const { raise, savedSymbols } = setup();
  await raise("NVDA", "yfinance");
  expect(savedSymbols()).toEqual(["NVDA", "MSFT"]);
});

test("a listing the target cell already shows saves nothing", async () => {
  const { patch, raise } = setup({ focused: 0 });
  await expect(raise("AAPL")).resolves.toMatchObject({ status: "handled" });
  expect(patch).not.toHaveBeenCalled();
});

test("a source without chart data fails with one toast and keeps the chart", async () => {
  const { patch, getCapabilities, raise } = setup({ focused: 0 });
  getCapabilities.mockResolvedValueOnce([]);
  await expect(raise("NVDA")).resolves.toMatchObject({ status: "failed" });
  expect(
    await findErrorToast("This source does not currently provide chart data."),
  ).toHaveTextContent("Couldn’t show this symbol");
  expect(patch).not.toHaveBeenCalled();
});

test("a failed save is reported once, under this request's title", async () => {
  const { patch, raise } = setup({ focused: 0 });
  patch.mockRejectedValueOnce(new Error("Revision conflict"));
  await expect(raise("NVDA")).resolves.toMatchObject({ status: "failed" });
  await findErrorToast("Revision conflict");
  const region = screen.getByRole("region", { name: /Notifications/ });
  await waitFor(() =>
    expect(within(region).getAllByRole("listitem")).toHaveLength(1),
  );
  expect(within(region).getByRole("listitem")).toHaveTextContent(
    "Couldn’t show this symbol",
  );
});
