// Purpose: A Workspace Dataset draws each bar's latest known observation on the chart's own timeline.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMPTY } from "rxjs";
import { expect, it, vi } from "vitest";
import { v2 } from "@openchart/chart-core";
import { FeedVersion } from "@openchart/feed";
import { fromPoints } from "@openchart/timeseries";
import type { CellDefinition } from "@openchart/app/features/chart/api/queries";
import { DatasetSource } from "@openchart/app/features/chart/components/sources/dataset";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { ChartContext } from "@openchart/app/lib/chart/context";
import { ChartGridContext } from "@openchart/app/lib/chart/grid";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
import type { FeedClient } from "@openchart/app/lib/feed";
import {
  FeedReactContext,
  FeedVersionContext,
} from "@openchart/app/lib/feed/provider";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const day = 86_400_000;

function notFound() {
  return Object.assign(new Error("Not found"), {
    data: { code: "NOT_FOUND" },
  });
}

it("carries sparse observations forward across the chart's bars", async () => {
  const store = createChartStore(v2.createState({ id: "chart" }));
  const chart: ChartRuntime = {
    id: "chart",
    store,
    renderer: {} as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  chart.mutate((state) => {
    v2.ChartStateUtils.addSeries(state, {
      id: "price",
      type: "Candlestick",
      pane: 0,
      yAxisId: "right",
    });
    v2.ChartStateModel.getSeriesObject(state, "price")!.role = "main";
    v2.ChartStateUtils.setSeriesData(
      state,
      "price",
      [1, 2, 3, 4].map((index) => ({
        time: (index * day) / 1000,
        close: 100,
      })),
    );
  });
  // Day 1, then a reading inside day 3's bar; days 2 and 4 hold the last value.
  const frame = fromPoints({}, [
    { time: day, cpi: 1 },
    { time: 3 * day + 3_600_000, cpi: 3 },
  ]);
  const select = vi.fn().mockResolvedValue({ data: frame });
  const transport = {
    url: "test",
    rpc: {
      resources: {
        workspace_dataset: {
          get: {
            query: vi.fn().mockResolvedValue({
              id: "wsd_cpi",
              name: "US CPI",
              source: { workspaceId: "wsp_test", path: "datasets/cpi.csv" },
              collection: null,
            }),
          },
        },
      },
    },
  } as unknown as AppTransport;
  const cell = {
    id: "ccl_a",
    panes: [
      {
        id: "cpn_a",
        series: [
          {
            id: "csr_cpi",
            role: "normal",
            source: { kind: "dataset", datasetId: "wsd_cpi", output: "cpi" },
          },
        ],
      },
    ],
  } as unknown as CellDefinition;
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FeedReactContext.Provider
        value={{ series: { select } } as unknown as FeedClient}
      >
        <FeedVersionContext.Provider value={FeedVersion.make("v1")}>
          <ChartGridContext.Provider
            value={{
              chartId: "cht_a",
              transport,
              focusedId: cell.id,
              setFocused: vi.fn(),
              maximizedId: undefined,
              toggleMaximized: vi.fn(),
              mounted: new Map(),
              register: () => () => {},
            }}
          >
            <ChartContext.Provider value={chart}>
              <TooltipProvider>
                <DatasetSource
                  datasetId="wsd_cpi"
                  cell={cell}
                  targets={new Map()}
                  localStore={createChartPreferences("chart")}
                  disabled={false}
                  onRemove={vi.fn()}
                />
              </TooltipProvider>
            </ChartContext.Provider>
          </ChartGridContext.Provider>
        </FeedVersionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      v2.ChartStateModel.getSeriesObject(
        store.getState(),
        "csr_cpi",
      )?.series.data.map((row) => (row as { value: number | null }).value),
    ).toEqual([1, 1, 3, 3]),
  );
  expect(select).toHaveBeenCalledExactlyOnceWith(
    { id: "wsd_cpi" },
    expect.anything(),
  );
});

it("skips the bindings of a deleted Dataset without reading Feed", async () => {
  const store = createChartStore(v2.createState({ id: "chart" }));
  const chart = {
    id: "chart",
    store,
    renderer: {} as v2.ChartRenderer,
    output$: EMPTY,
    mutate: () => {},
  } as ChartRuntime;
  const select = vi.fn();
  const get = vi.fn().mockRejectedValue(notFound());
  const transport = {
    url: "test",
    rpc: { resources: { workspace_dataset: { get: { query: get } } } },
  } as unknown as AppTransport;
  const cell = {
    id: "ccl_a",
    panes: [
      {
        id: "cpn_a",
        series: [
          {
            id: "csr_cpi",
            role: "normal",
            source: { kind: "dataset", datasetId: "wsd_gone", output: "cpi" },
          },
        ],
      },
    ],
  } as unknown as CellDefinition;
  const { container } = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FeedReactContext.Provider
        value={{ series: { select } } as unknown as FeedClient}
      >
        <FeedVersionContext.Provider value={FeedVersion.make("v1")}>
          <ChartGridContext.Provider
            value={{
              chartId: "cht_a",
              transport,
              focusedId: cell.id,
              setFocused: vi.fn(),
              maximizedId: undefined,
              toggleMaximized: vi.fn(),
              mounted: new Map(),
              register: () => () => {},
            }}
          >
            <ChartContext.Provider value={chart}>
              <DatasetSource
                datasetId="wsd_gone"
                cell={cell}
                targets={new Map()}
                localStore={createChartPreferences("chart")}
                disabled={false}
                onRemove={vi.fn()}
              />
            </ChartContext.Provider>
          </ChartGridContext.Provider>
        </FeedVersionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  expect(select).not.toHaveBeenCalled();
});
