// Purpose: A Dashboard Watchlist row shows its listing on the Dashboard's chart through the ViewChart intent.
import { defineId } from "@openchart/identifier";
import { ProviderId, type ProviderListing } from "@openchart/market";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NEVER } from "rxjs";
import { useRef } from "react";
import type { GridLayoutProps } from "react-grid-layout";

import { widgetRegistry } from "@openchart/app/app/widgets/widget-registry";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  chartDetail,
  chartList,
  createCell,
  type CellDefinition,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { chartWidget } from "@openchart/app/features/chart/components/widget";
import { getMainSource } from "@openchart/app/features/chart/utils/resource";
import { DashboardView } from "@openchart/app/features/dashboard/components/dashboard-view";
import { useWidget } from "@openchart/app/hooks/use-widget";
import type { FeedClient } from "@openchart/app/lib/feed/client";
import { FeedReactContext } from "@openchart/app/lib/feed/provider";
import { WidgetIntentProvider } from "@openchart/app/lib/widget/intent/provider";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import { renderWithToaster as render } from "@openchart/app/testing/test-utils";

vi.mock("react-grid-layout", async (original) => ({
  ...(await original<typeof import("react-grid-layout")>()),
  default: (props: GridLayoutProps) => <div>{props.children}</div>,
  useContainerWidth: () => ({
    width: 1200,
    mounted: true,
    containerRef: useRef<HTMLDivElement>(null),
  }),
}));
// Rows need quotes to render; their Feed behavior has its own tests.
vi.mock("@openchart/app/hooks/use-bars", () => ({
  useBarsCapabilities: () => ({ error: null, refetch: vi.fn(), data: [] }),
  useBars: () => ({ status: "loading", current: { updates: NEVER } }),
}));

const listing = (symbol: string): ProviderListing => ({
  provider: ProviderId.make("yfinance"),
  listing: { symbol, currency: "USD" },
});
const daily = {
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
  modes: ["history", "live"],
} as const;

// Stands in for the renderer: the chart feature's real placement adapter
// resolves the Chart and answers ViewChart; this only shows what was saved.
function SavedSymbol() {
  const { dashboardId, transport } = useWidget();
  const list = useQuery(chartList(transport, dashboardId));
  const chart = useQuery(chartDetail(transport, list.data?.[0]?.id ?? ""));
  const cell = chart.data?.cells[0];
  return <p>Chart shows {cell ? getMainSource(cell).listing.symbol : "…"}</p>;
}
const chart: WidgetDefinition = {
  ...chartWidget,
  Controls: undefined,
  Content: SavedSymbol,
};

const placementId = defineId("wdg", "WidgetPlacement.ID");
const placement = (kind: string, x: number) => ({
  id: placementId.make(`wdg_${kind}`),
  kind,
  layout: { x, y: 0, w: 6, h: 12 },
});

function setup(widgets: Dashboard["widgets"]) {
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").make("dsh_test"),
    name: "Research",
    favorite: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    widgets,
  };
  const saved: ChartResource = {
    id: defineId("cht", "Chart.ID").make("cht_test"),
    dashboardId: dashboard.id,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [createCell(listing("AAPL"), daily)],
    links: [],
  } as ChartResource;
  const watchlist = {
    id: "wtl_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    name: "Markets",
    columns: [{ id: "wcl_price", metric: { kind: "price" } }],
    sections: [
      {
        id: "wsc_plain",
        items: ["MSFT", "NVDA", "TSLA"].map((symbol) => ({
          id: `wit_${symbol}`,
          ...listing(symbol),
        })),
        sections: [],
      },
    ],
  };
  let revision = saved.revision;
  const patch = vi.fn(
    async (input: {
      operations: { path: string; value: CellDefinition[] }[];
    }) => ({
      ...saved,
      revision: ++revision,
      cells: input.operations.find((op) => op.path === "/cells")!.value,
    }),
  );
  const transport = {
    url: "http://watchlist-chart.test",
    rpc: {
      resources: {
        dashboard: { get: { query: vi.fn().mockResolvedValue(dashboard) } },
        chart: { patch: { mutate: patch } },
        watchlist: {
          list: {
            query: vi
              .fn()
              .mockResolvedValue({ items: [watchlist], nextCursor: null }),
          },
          get: { query: vi.fn().mockResolvedValue(watchlist) },
        },
      },
    },
  } as unknown as AppTransport;
  const feed = {
    bars: { getCapabilities: vi.fn(async () => [daily]) },
  } as unknown as FeedClient;
  const client = createQueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(
    dashboardQueryOptions(transport, dashboard.id).queryKey,
    dashboard,
  );
  client.setQueryData(chartList(transport, dashboard.id).queryKey, [saved]);
  client.setQueryData(chartDetail(transport, saved.id).queryKey, saved);
  localStorage.clear();
  render(
    <QueryClientProvider client={client}>
      <FeedReactContext.Provider value={feed}>
        <TooltipProvider>
          {/* The same scopes DashboardPage gives its widgets. */}
          <ChartSelectionProvider>
            <WidgetIntentProvider>
              <DashboardView
                id={dashboard.id}
                transport={transport}
                registry={{ chart, watchlist: widgetRegistry.watchlist }}
                renderHeader={() => null}
              />
            </WidgetIntentProvider>
          </ChartSelectionProvider>
        </TooltipProvider>
      </FeedReactContext.Provider>
    </QueryClientProvider>,
  );
  return { patch, user: userEvent.setup() };
}

const savedSymbols = (patch: ReturnType<typeof setup>["patch"]) =>
  patch.mock.calls.map(
    ([input]) =>
      getMainSource(
        input.operations.find((op) => op.path === "/cells")!.value[0]!,
      ).listing.symbol,
  );

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 1200, height: 760 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

test("clicking a Watchlist row shows its listing on the Dashboard's chart", async () => {
  const { patch, user } = setup([
    placement("chart", 0),
    placement("watchlist", 6),
  ]);
  expect(await screen.findByText("Chart shows AAPL")).toBeVisible();
  await user.click(await screen.findByRole("treeitem", { name: "NVDA" }));
  expect(await screen.findByText("Chart shows NVDA")).toBeVisible();
  expect(patch).toHaveBeenCalledOnce();
  expect(patch.mock.lastCall![0]).toMatchObject({
    id: "cht_test",
    expectedRevision: 1,
  });
});

test("rapid picks apply the first and the latest symbol, skipping those in between", async () => {
  const { patch, user } = setup([
    placement("chart", 0),
    placement("watchlist", 6),
  ]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const save = patch.getMockImplementation()!;
  patch.mockImplementationOnce(async (input) => {
    await held;
    return save(input);
  });
  for (const symbol of ["MSFT", "NVDA", "TSLA"])
    await user.click(await screen.findByRole("treeitem", { name: symbol }));
  release();
  expect(await screen.findByText("Chart shows TSLA")).toBeVisible();
  expect(savedSymbols(patch)).toEqual(["MSFT", "TSLA"]);
});

test("without a chart on the Dashboard a row click changes nothing", async () => {
  const { patch, user } = setup([placement("watchlist", 0)]);
  await user.click(await screen.findByRole("treeitem", { name: "NVDA" }));
  await waitFor(() =>
    expect(screen.getByRole("treeitem", { name: "NVDA" })).toHaveFocus(),
  );
  expect(patch).not.toHaveBeenCalled();
});
