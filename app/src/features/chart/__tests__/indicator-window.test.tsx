// Purpose: Window replacement never removes Resource panes or mismatches retained values to the main timeline.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Field, Float64, Schema } from "apache-arrow";
import { EMPTY, Observable, type Subscriber } from "rxjs";
import { expect, it, vi } from "vitest";
import { v2 } from "@openchart/chart-core";
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { fromPoints, fromRows } from "@openchart/timeseries";
import { useTea, type Node } from "@openchart/app/hooks/use-tea";
import {
  chartIds,
  createCell,
  type CellDefinition,
} from "@openchart/app/features/chart/api/queries";
import { ChartPanes } from "@openchart/app/features/chart/components/chart-panes";
import { ChartSeries } from "@openchart/app/features/chart/components/chart-series";
import { TeaVisuals } from "@openchart/app/features/chart/components/tea-visuals";
import { ChartContext } from "@openchart/app/lib/chart/context";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

const client = vi.hoisted(() => ({
  compile: vi.fn(),
  observe: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => client,
}));

it("keeps study panes through loading, rapid scrolling, errors and symbol changes; only Resource removal removes a pane", async () => {
  localStorage.clear();
  const series = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAA", currency: "USD" },
    resolution: "1d" as const,
    session: "regular" as const,
    adjustment: "raw" as const,
  };
  // Each Indicator's single output sits in its own study pane.
  const study = (indicatorId: string): CellDefinition["panes"][number] => ({
    id: chartIds.pane.create(),
    series: [
      {
        id: chartIds.series.create(),
        role: "normal" as const,
        source: { kind: "indicator" as const, indicatorId, output: "value" },
      },
    ],
  });
  const base = createCell(series, series);
  let cell: CellDefinition = {
    ...base,
    panes: [...base.panes, study("ind_first"), study("ind_second")],
  };
  let indicators = ["ind_first", "ind_second"];
  const firstId = cell.panes[1]!.series[0]!.id;
  const secondId = cell.panes[2]!.series[0]!.id;
  const paneIds = ["pane-main", cell.panes[1]!.id, cell.panes[2]!.id];
  const store = createChartStore(v2.createState({ id: "windows" }));
  const layouts: string[][] = [];
  const chart: ChartRuntime = {
    id: "windows",
    store,
    output$: EMPTY,
    renderer: {} as v2.ChartRenderer,
    mutate: (recipe) => {
      store.setState((state) => {
        recipe(state);
      }, true);
      layouts.push(store.getState().panes.map((pane) => pane.id));
    },
  };
  const preferences = createChartPreferences("windows");
  const calls: Subscriber<Tea.Message>[] = [];
  client.compile.mockResolvedValue({
    id: "node",
    declaration: {
      kind: "indicator",
      title: "Study",
      overlay: false,
      timeframe: "",
    },
    definition: {
      parameters: [],
      inputs: new Schema([]),
      outputs: new Schema([
        new Field(
          "value",
          new Float64(),
          true,
          new Map([["tea:write", "set"]]),
        ),
      ]),
      requests: {},
    },
  } satisfies Tea.CompileResponse);
  client.observe.mockImplementation(
    () =>
      new Observable<Tea.Message>((sink) => {
        calls.push(sink);
      }),
  );
  client.dispose.mockResolvedValue(undefined);
  const input: Node = {
    source: {
      entry: "study.tea",
      sources: { "study.tea": 'emit "value" close' },
    },
    ...Tea.barsInputs(series),
    parameters: {},
    requests: {},
    from: 0,
    to: "now",
    countBack: 10,
    warmupBars: Tea.standardWarmupBars,
  };
  const fieldMap = { x: "time", value: "value" };
  function Study({ input }: { input: Node }) {
    const tea = useTea(input);
    return (
      <TeaVisuals
        sourceId="ind_first"
        compiled={tea.compiled}
        frame={tea.data}
        preferences={preferences}
        bindings={[
          {
            id: firstId,
            output: "value",
            pane: 1,
            paneId: paneIds[1]!,
            mainPane: false,
          },
        ]}
      />
    );
  }
  const tree = (request: Node = input, expanded = false) => (
    <ChartContext.Provider value={chart}>
      <ChartPanes panes={cell.panes} />
      <ChartSeries
        id={cell.panes[0]!.series[0]!.id}
        type="Line"
        source="provider"
        pane={0}
        axisId="right"
        main
        fieldMap={fieldMap}
        options={{}}
        axisOptions={{}}
        data={
          expanded
            ? [
                { time: -1, value: 5 },
                { time: 1, value: 6 },
              ]
            : [{ time: 1, value: 6 }]
        }
      />
      {indicators.includes("ind_first") ? <Study input={request} /> : null}
      <ChartSeries
        id={secondId}
        type="Line"
        source="computed"
        pane={cell.panes.length - 1}
        axisId={`pane:${paneIds[2]}`}
        fieldMap={fieldMap}
        options={{}}
        axisOptions={{}}
        data={[]}
      />
    </ChartContext.Provider>
  );
  const queryClient = new QueryClient();
  const view = render(tree(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  expect(store.getState().panes.map((pane) => pane.id)).toEqual(paneIds);
  await waitFor(() => expect(calls).toHaveLength(1));
  const data = fromPoints({}, [{ time: 1000, value: 7 }]);
  const snapshot = (frame = data) => ({
    type: "snapshot" as const,
    config: { inputs: {}, map: {}, parameters: {}, requests: {} },
    rid: "run",
    snapshot: { range: { from: -4000, to: 2000 }, data: frame },
  });
  act(() => {
    calls[0]!.next(snapshot());
    chart.mutate((state) => {
      state.panes.forEach((pane, index) => {
        pane.height = [300, 150, 150][index]!;
      });
    });
  });
  layouts.length = 0;
  view.rerender(tree({ ...input, from: -1000 }, true));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[0]!.closed).toBe(true);
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), firstId)?.data,
  ).toMatchObject([
    { time: -1, value: NaN },
    { time: 1, value: 7 },
  ]);
  view.rerender(tree({ ...input, from: -2000 }, true));
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[1]!.closed).toBe(true);
  act(() => calls[2]!.error(new Error("Refresh failed")));
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), firstId)?.data.at(-1),
  ).toMatchObject({ value: 7 });
  view.rerender(tree({ ...input, from: -3000 }, true));
  await waitFor(() => expect(calls).toHaveLength(4));
  act(() => calls[3]!.next(snapshot(fromRows(data.schema, []))));
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), firstId)?.data.every((row) =>
      Number.isNaN((row as { value: unknown }).value),
    ),
  ).toBe(true);
  view.rerender(
    tree(
      {
        ...input,
        ...Tea.barsInputs({
          ...series,
          listing: { ...series.listing, symbol: "BBB" },
        }),
      },
      true,
    ),
  );
  await waitFor(() => expect(calls).toHaveLength(5));
  expect(v2.ChartStateUtils.getSeries(store.getState(), firstId)?.data).toEqual(
    [],
  );
  expect(
    layouts.every((ids) => JSON.stringify(ids) === JSON.stringify(paneIds)),
  ).toBe(true);
  expect(store.getState().panes.map((pane) => pane.height)).toEqual([
    300, 150, 150,
  ]);
  // The remove macro drops the Indicator, its bindings and the pane they emptied.
  cell = {
    ...cell,
    panes: cell.panes.filter((pane) => pane.id !== paneIds[1]),
  };
  indicators = ["ind_second"];
  view.rerender(tree());
  expect(store.getState().panes.map((pane) => pane.id)).toEqual([
    "pane-main",
    paneIds[2],
  ]);
  expect(
    v2.ChartStateModel.getSeriesObject(store.getState(), secondId)?.paneId,
  ).toBe(paneIds[2]);
  expect(calls[4]!.closed).toBe(true);
  view.unmount();
});
