// Purpose: Window replacement never removes Resource panes or mismatches retained values to the main timeline.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Field, Float64, Schema } from "apache-arrow";
import { EMPTY, Observable, Subject, type Subscriber } from "rxjs";
import { expect, it, vi } from "vitest";
import { v2 } from "@openchart/chart-core";
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { fromPoints, fromRows } from "@openchart/timeseries";
import { useTea, type Node } from "@openchart/app/hooks/use-tea";
import { useChartWindow } from "@openchart/app/hooks/use-chart-window";
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
import { indexToTime, mainTimeline } from "@openchart/app/lib/chart/data";
import {
  createChartStore,
  type ChartOutput,
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

it.each(["1m", "1d"] as const)(
  "expands historical study demand on resize without following retained frames (%s)",
  async (resolution) => {
    vi.useFakeTimers();
    const now = Date.now();
    const step = resolution === "1m" ? 60_000 : 86_400_000;
    const times = Array.from(
      { length: 1000 },
      (_, index) =>
        now -
        2000 * step +
        (index + (resolution === "1d" ? Math.floor(index / 5) * 2 : 0)) * step,
    );
    // The daily target ends inside a three-day trading gap: its native rounded
    // right edge is less than one bar, but more than one UTC day, away.
    const target = {
      from: times[800]!,
      to: times[879]! + 0.75 * (times[880]! - times[879]!),
    };
    const state = v2.createState({ id: "study-resize" });
    v2.ChartStateUtils.resize(state, 600, 400);
    const id = v2.ChartStateUtils.addSeries(state, {
      id: "main",
      type: "Line",
      data: times.map((time) => ({ time: time / 1000, value: 1 })),
    });
    v2.ChartStateModel.getSeriesObject(state, id)!.role = "main";
    v2.ChartStateUtils.setVisibleRange(state, 800, 879.75);
    const store = createChartStore(state);
    const output = new Subject<ChartOutput>();
    const chart: ChartRuntime = {
      id: "study-resize",
      store,
      output$: output,
      renderer: {} as v2.ChartRenderer,
      mutate: (recipe) => store.setState(recipe, true),
    };
    const preferences = createChartPreferences("study-resize", target);
    const series = {
      provider: ProviderId.make("tradingview"),
      listing: { symbol: "NQ1!", venue: "CME_MINI", currency: "USD" },
      resolution,
      session: "regular" as const,
      adjustment: "split" as const,
    };
    const view = renderHook(() => useChartWindow(chart, series, preferences));
    const paint = () =>
      output.next({
        type: "range",
        source: "render",
        ...v2.ChartStateUtils.getVisibleRange(store.getState()),
      });
    try {
      const initial = view.result.current;
      act(() => {
        chart.mutate((draft) =>
          v2.ChartStateUtils.setVisibleRange(draft, 400, 950),
        );
        paint();
      });
      await act(async () => vi.advanceTimersByTime(300));
      expect(view.result.current).toEqual(initial);
      act(() => {
        chart.mutate((draft) => {
          v2.ChartStateUtils.setVisibleRange(draft, 800, 879.75);
          v2.ChartStateUtils.resize(draft, 1800, 400);
        });
        paint();
      });
      await act(async () => vi.advanceTimersByTime(300));
      const range = v2.ChartStateUtils.getVisibleRange(store.getState());
      expect(range.from).toBeLessThan(800);
      const visibleFrom = indexToTime(
        mainTimeline(store.getState()),
        range.from,
        step,
      );
      expect(view.result.current.from).toBeLessThanOrEqual(visibleFrom);
      expect(view.result.current.to).toBe(initial.to);
      expect(view.result.current.countBack).toBeGreaterThanOrEqual(
        range.to - range.from,
      );
      expect(preferences.getState().viewport).toEqual(target);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  },
);

it("replaces an attached study with a finite jump window and ignores paints of retained bars", async () => {
  localStorage.clear();
  const now = Date.now();
  const minute = 60_000;
  const series = {
    provider: ProviderId.make("tradingview"),
    listing: { symbol: "NQ1!", venue: "CME_MINI", currency: "USD" },
    resolution: "1m" as const,
    session: "regular" as const,
    adjustment: "split" as const,
  };
  const store = createChartStore(v2.createState({ id: "jump-study" }));
  const output = new Subject<ChartOutput>();
  const chart: ChartRuntime = {
    id: "jump-study",
    store,
    output$: output,
    renderer: {} as v2.ChartRenderer,
    mutate: (recipe) => store.setState(recipe, true),
  };
  chart.mutate((state) => {
    v2.ChartStateUtils.resize(state, 600, 400);
    v2.ChartStateUtils.addSeries(state, {
      id: "main",
      type: "Line",
      source: "provider",
      pane: 0,
      yAxisId: "right",
      fieldMap: { x: "time", value: "close" },
    });
    v2.ChartStateModel.getSeriesObject(state, "main")!.role = "main";
    v2.ChartStateUtils.setSeriesData(
      state,
      "main",
      Array.from({ length: 200 }, (_, index) => ({
        time: (now - (200 - index) * minute) / 1000,
        close: index,
      })),
    );
  });
  const preferences = createChartPreferences("jump-study");
  const calls: {
    request: Tea.ObserveRequest;
    sink: Subscriber<Tea.Message>;
  }[] = [];
  client.compile.mockResolvedValue({
    id: "jump-node",
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
    (request: Tea.ObserveRequest) =>
      new Observable<Tea.Message>((sink) => {
        calls.push({ request, sink });
      }),
  );
  client.dispose.mockResolvedValue(undefined);
  function Study() {
    const window = useChartWindow(chart, series, preferences);
    useTea({
      source: {
        entry: "jump.tea",
        sources: { "jump.tea": 'emit "value" close' },
      },
      ...Tea.barsInputs(series),
      requests: {},
      parameters: {},
      ...window,
      warmupBars: Tea.standardWarmupBars,
    });
    return null;
  }
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Study />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.request.to).toBe("now");
  const target = {
    from: now - 365 * 86_400_000,
    to: now - 365 * 86_400_000 + 80 * minute,
  };
  act(() => preferences.setState({ viewport: target }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[0]!.sink.closed).toBe(true);
  expect(calls[1]!.request).toMatchObject({
    from: target.from,
    to: target.to + minute,
  });
  vi.useFakeTimers();
  try {
    act(() =>
      output.next({ type: "range", source: "render", from: 100, to: 200 }),
    );
    await act(async () => vi.advanceTimersByTime(300));
    expect(calls).toHaveLength(2);
    const nearby = {
      from: target.from - 20 * minute,
      to: target.to - 20 * minute,
    };
    act(() => preferences.setState({ viewport: nearby }));
    expect(calls).toHaveLength(3);
    expect(calls[2]!.request.from).toBeLessThanOrEqual(nearby.from);
    expect(calls[2]!.request.to).toBe(target.to + minute);
    act(() =>
      chart.mutate((state) =>
        v2.ChartStateUtils.setSeriesData(
          state,
          "main",
          Array.from({ length: 200 }, (_, index) => ({
            time: (target.to - (200 - index) * minute) / 1000,
            close: index,
          })),
        ),
      ),
    );
    act(() => preferences.setState({ viewport: null }));
    expect(calls.at(-1)!.request.to).toBe("now");
    const latest = calls.at(-1)!.request;
    act(() =>
      output.next({ type: "range", source: "render", from: 100, to: 200 }),
    );
    await act(async () => vi.advanceTimersByTime(300));
    expect(calls.at(-1)!.request).toBe(latest);
    expect(latest.from).toBeGreaterThan(now - 86_400_000);
    act(() => {
      chart.mutate((state) => v2.ChartStateUtils.resize(state, 3000, 400));
      output.next({ type: "range", source: "render", from: -300, to: 200 });
    });
    await act(async () => vi.advanceTimersByTime(300));
    expect(calls.at(-1)!.request.countBack).toBeGreaterThanOrEqual(500);
    expect(calls.at(-1)!.request.from).toBeGreaterThan(now - 86_400_000);
    view.unmount();
    expect(calls.at(-1)!.sink.closed).toBe(true);
  } finally {
    vi.useRealTimers();
    queryClient.clear();
  }
});
