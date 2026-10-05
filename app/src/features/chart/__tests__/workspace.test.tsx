import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import { findErrorToast } from "@openchart/app/testing/test-utils";
// Purpose: Exercise immutable chart state and independently cancelled market inputs together.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Drawing, v2 } from "@openchart/chart-core";
import {
  FeedError,
  FeedReasons,
  FeedVersion,
  type BarsMessage,
  type BarsRequest,
} from "@openchart/feed";
import { BarColumns, ProviderId } from "@openchart/market";
import { defineDataFrame } from "@openchart/timeseries";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Array as EffectArray, Schema } from "effect";
import { StrictMode, useCallback, useState } from "react";
import { Observable, type Subscriber } from "rxjs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

import { ChartLegend } from "@openchart/app/features/chart/components/legend";
import { MarketSource } from "@openchart/app/features/chart/components/sources/market";
import type { MarketSeriesInput } from "@openchart/app/hooks/use-market-series-source";
import {
  chartDetail,
  chartIds,
  type CellDefinition,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { QueryClientProvider } from "@tanstack/react-query";
import { defineId } from "@openchart/identifier";
import { ChartGridContext } from "@openchart/app/lib/chart/grid";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  fitGridTracks,
  resizeGridTracks,
} from "@openchart/app/features/chart/utils/grid-layout";
import { ChartCore } from "@openchart/app/lib/chart/core";
import { indexToTime, timeToIndex } from "@openchart/app/lib/chart/data";
import {
  createChartPreferences,
  SeriesPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import { observeBars } from "@openchart/app/lib/feed/bars";
import type { FeedClient } from "@openchart/app/lib/feed/client";
import {
  FeedReactContext,
  FeedVersionContext,
} from "@openchart/app/lib/feed/provider";

// A source's native columns sit beside the required Bar vocabulary.
const NativeBars = defineDataFrame({
  ...BarColumns,
  trades: Schema.Finite,
  final: Schema.Boolean,
  note: Schema.String,
});

const mocks = vi.hoisted(() => ({
  resize: (() => {}) as (width: number, height: number) => void,
  renderers: [] as Array<{
    config: v2.RendererConfig;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("@openchart/chart-core", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@openchart/chart-core")>();
  return {
    ...original,
    v2: {
      ...original.v2,
      createRenderer: (config: v2.RendererConfig) => {
        const canvas = document.createElement("canvas");
        config.container.append(canvas);
        const dispose = vi.fn(() => canvas.remove());
        mocks.renderers.push({ config, dispose });
        return {
          canvas,
          id: config.getState().id,
          render: vi.fn(),
          scheduleResize: vi.fn(),
          setSuspended: vi.fn(),
          dispose,
        };
      },
    },
  };
});
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  mocks.renderers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        mocks.resize = (width, height) =>
          this.callback([{ contentRect: { width, height } }]);
        mocks.resize(600, 400);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (key: string) =>
      key === "--background"
        ? document.documentElement.classList.contains("dark")
          ? "#000000"
          : "#ffffff"
        : "#168863",
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps shared outer bounds fixed, clamps minimum widths, and restores time-based positions", () => {
  const initial = { columns: [0.5, 0.5], rows: [0.5, 0.5] };
  const next = resizeGridTracks(initial, "columns", 0, 800, 1000, 180);
  expect(next.columns[0]).toBeCloseTo(0.82);
  expect(next.columns[1]).toBeCloseTo(0.18);
  expect(next.rows).toBe(initial.rows);
  expect(resizeGridTracks(initial, "columns", 1, 100, 1000, 180)).toBe(initial);
  expect(fitGridTracks([0.9, 0.1], 2, 200, 180)).toEqual([0.5, 0.5]);
  const original = [1000, 2000, 4000],
    expanded = [-1000, 0, ...original];
  const time = indexToTime(original, 1.5, 1000);
  expect(time).toBe(3000);
  expect(timeToIndex(expanded, time, 1000)).toBe(3.5);
});

function MarketScene({
  cell,
  inputs,
  localStore,
  showLegend,
}: {
  cell: CellDefinition;
  inputs: readonly MarketSeriesInput[];
  localStore: ChartPreferencesStore;
  showLegend: boolean;
}) {
  const [targets, setTargets] = useState<ReadonlyMap<string, HTMLDivElement>>(
    () => new Map(),
  );
  const register = useCallback((id: string, node: HTMLDivElement | null) => {
    setTargets((previous) => {
      if (previous.get(id) === node || (!node && !previous.has(id)))
        return previous;
      const next = new Map(previous);
      if (node) next.set(id, node);
      else next.delete(id);
      return next;
    });
  }, []);
  return (
    <>
      {showLegend ? (
        <ChartLegend panes={cell.panes} register={register} />
      ) : null}
      {inputs.map((input) => (
        <MarketSource
          key={input.id}
          input={input}
          cell={cell}
          targets={targets}
          localStore={localStore}
          disabled={false}
          onRemove={() => {}}
        />
      ))}
    </>
  );
}

function setup() {
  const calls: Array<{
    request: BarsRequest;
    sink: Subscriber<BarsMessage>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const client: FeedClient = {
    bars: {
      observe: (request) =>
        observeBars(
          new Observable((sink) => {
            const stop = vi.fn();
            calls.push({ request, sink, stop });
            return stop;
          }),
          request,
        ),
      getCapabilities: vi.fn(),
    },
    calendar: { getCalendar: vi.fn() },
    logos: { getLogo: vi.fn() },
    symbology: {
      index: vi.fn(),
      indexStatus: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
    },
    close: vi.fn(),
  };
  const queryClient = createQueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const resourceId = defineId("cht", "Chart.ID").create();
  const patch = vi.fn().mockImplementation(async (request) => {
    const previous = queryClient.getQueryData<ChartResource>(
      chartDetail(transport, resourceId).queryKey,
    )!;
    return {
      ...previous,
      revision: previous.revision + 1,
      ...Object.fromEntries(
        request.operations.map(
          (operation: { path: string; value: unknown }) => [
            operation.path.slice(1),
            operation.value,
          ],
        ),
      ),
    };
  });
  const transport = {
    rpc: { resources: { chart: { patch: { mutate: patch } } } },
  } as unknown as AppTransport;
  const grid = {
    chartId: resourceId,
    transport,
    focusedId: undefined,
    setFocused: vi.fn(),
    maximizedId: undefined,
    toggleMaximized: vi.fn(),
    mounted: new Map(),
    register: vi.fn(),
  };
  // No stored style: the binding's output alone makes csr_volume a histogram.
  const local = createChartPreferences("test");
  let runtime: ChartRuntime;
  const onReady = (chart: ChartRuntime) => {
    runtime = chart;
    return () => {};
  };
  const input = (
    symbol: string,
    main: boolean,
    resolution: "1m" | "1d" = "1m",
  ) => ({
    id: main ? "cms_primary" : "cms_comparison",
    series: {
      provider: ProviderId.make("test"),
      listing: { symbol, currency: "USD" },
      resolution,
      session: "regular" as const,
      adjustment: "raw" as const,
    },
    bindings: main
      ? [
          { id: "csr_volume", pane: 1, main: false, output: "volume" as const },
          { id: "csr_price", pane: 0, main: true, output: "price" as const },
        ]
      : [
          {
            id: "csr_compare",
            pane: 0,
            main: false,
            output: "price" as const,
          },
        ],
  });
  const tree = (
    symbol = "AAPL",
    comparison = false,
    resolution: "1m" | "1d" = "1m",
    showLegend = true,
  ) => {
    const inputs = [
      input(symbol, true, resolution),
      ...(comparison ? [input("MSFT", false, resolution)] : []),
    ];
    const cell: CellDefinition = {
      id: chartIds.cell.make("ccl_test"),
      resolution,
      session: "regular",
      adjustment: "raw",
      marketSources: inputs.map((source) => ({
        id: chartIds.source.make(source.id),
        provider: source.series.provider,
        listing: source.series.listing,
      })),
      panes: [0, 1].flatMap((pane) => {
        const series = inputs.flatMap((source) =>
          source.bindings
            .filter((binding) => binding.pane === pane)
            .map((binding) => {
              const id = chartIds.series.make(binding.id);
              const market = {
                kind: "market" as const,
                marketSourceId: chartIds.source.make(source.id),
              };
              // Only a price binding may be main.
              return binding.output === "volume"
                ? {
                    id,
                    role: "normal" as const,
                    source: { ...market, output: binding.output },
                  }
                : {
                    id,
                    role: binding.main
                      ? ("main" as const)
                      : ("normal" as const),
                    source: { ...market, output: binding.output },
                  };
            }),
        );
        return EffectArray.isArrayNonEmpty(series)
          ? [{ id: chartIds.pane.make(`cpn_${pane}`), series }]
          : [];
      }),
    };
    queryClient.setQueryData(chartDetail(transport, resourceId).queryKey, {
      id: resourceId,
      dashboardId: "dsh_test",
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
      preset: "1",
      cells: [cell],
      links: [],
    } satisfies ChartResource);
    return (
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ChartGridContext.Provider value={grid}>
            <TooltipProvider>
              <FeedVersionContext.Provider value={FeedVersion.make("test")}>
                <FeedReactContext.Provider value={client}>
                  <ChartCore id="ccl_test" onReady={onReady}>
                    <MarketScene
                      cell={cell}
                      inputs={inputs}
                      localStore={local}
                      showLegend={showLegend}
                    />
                  </ChartCore>
                </FeedReactContext.Provider>
              </FeedVersionContext.Provider>
            </TooltipProvider>
          </ChartGridContext.Provider>
        </QueryClientProvider>
      </StrictMode>
    );
  };
  const view = render(tree());
  const active = (symbol: string) =>
    [...calls]
      .reverse()
      .find(
        (call) => call.request.listing.symbol === symbol && !call.sink.closed,
      )!;
  const data = (symbol: string, close = 2, time = 1000) =>
    NativeBars.create({
      labels: { symbol },
      rows: [
        {
          time,
          open: 1,
          high: 4,
          low: 1,
          close,
          volume: 10,
          trades: 3,
          final: false,
          note: "native",
        },
      ],
    });
  const snapshot = (symbol: string) =>
    act(() =>
      active(symbol).sink.next({
        type: "snapshot",
        snapshot: {
          data: data(symbol),
          range: { from: 0, to: 100000 },
          hasMoreBefore: false,
        },
      }),
    );
  return {
    view: {
      ...view,
      unmount: () => {
        view.unmount();
        queryClient.clear();
      },
    },
    patch,
    queryClient,
    client,
    tree,
    calls,
    active,
    data,
    snapshot,
    local,
    get runtime() {
      return runtime!;
    },
  };
}

function minuteHistory(to: number) {
  return NativeBars.create({
    labels: { symbol: "AAPL" },
    rows: Array.from({ length: 200 }, (_, index) => ({
      time: to - (200 - index) * 60_000,
      open: 1,
      high: 4,
      low: 1,
      close: 2,
      volume: 10,
      trades: 3,
      final: false,
      note: "native",
    })),
  });
}

it("loads history and saves the viewport even when live updates arrive during the pan debounce", async () => {
  vi.useFakeTimers();
  const fixture = setup();
  const channel = fixture.active("AAPL");
  const to = Date.now();
  const data = minuteHistory(to);
  act(() =>
    channel.sink.next({
      type: "snapshot",
      snapshot: {
        data,
        range: { from: data.get(0)!.time, to },
        hasMoreBefore: true,
      },
    }),
  );
  const originalCalls = fixture.calls.length;
  const renderer = mocks.renderers.at(-1)!;
  act(() => {
    fixture.runtime.mutate((state) =>
      v2.ChartStateUtils.setVisibleRange(state, -30, 70),
    );
    renderer.config.onVisibleRangeChange!({ from: -30, to: 70 });
  });
  for (const close of [2.1, 2.2]) {
    await act(async () => vi.advanceTimersByTime(100));
    act(() =>
      channel.sink.next({
        type: "updates",
        data: fixture.data("AAPL", close, data.get(199)!.time),
      }),
    );
  }
  expect(fixture.calls).toHaveLength(originalCalls);
  await act(async () => vi.advanceTimersByTime(100));
  expect(fixture.calls).toHaveLength(originalCalls + 1);
  expect(fixture.active("AAPL").request).toMatchObject({
    from: to - 330 * 60_000,
    to: "now",
    countBack: channel.request.countBack + 125,
  });
  expect(fixture.local.getState().viewport).toEqual({
    from: to - 230 * 60_000,
    to: to - 130 * 60_000,
  });
  expect(channel.stop).toHaveBeenCalledOnce();
  fixture.view.unmount();
});

it.each([true, false])(
  "loads before the first bar across covered trading gaps only when history exists (hasMoreBefore = %s)",
  async (hasMoreBefore) => {
    vi.useFakeTimers();
    const fixture = setup();
    const to = Date.now();
    act(() =>
      fixture.active("AAPL").sink.next({
        type: "snapshot",
        snapshot: {
          data: minuteHistory(to),
          range: { from: to - 300 * 60_000, to },
          hasMoreBefore,
        },
      }),
    );
    const originalCalls = fixture.calls.length;
    const renderer = mocks.renderers.at(-1)!;
    const pan = (from: number) =>
      act(() => {
        fixture.runtime.mutate((state) =>
          v2.ChartStateUtils.setVisibleRange(state, from, from + 100),
        );
        renderer.config.onVisibleRangeChange!({ from, to: from + 100 });
      });
    // The ordinal axis needs earlier bars even if the estimated time is a covered gap.
    pan(-50);
    await act(async () => vi.advanceTimersByTime(300));
    expect(fixture.calls).toHaveLength(originalCalls + Number(hasMoreBefore));
    // Further panning must not reopen a request while the snapshot is pending.
    pan(-110);
    await act(async () => vi.advanceTimersByTime(300));
    expect(fixture.calls).toHaveLength(originalCalls + Number(hasMoreBefore));
    fixture.view.unmount();
  },
);

it("gives each display its pane legend and connects native selection, visibility and style controls", async () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  const channel = fixture.active("AAPL");
  const price = screen.getByRole("group", { name: "AAPL legend" });
  const volume = screen.getByRole("group", { name: "AAPL Volume legend" });
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_price")
      ?.options,
  ).toMatchObject({ title: "AAPL" });
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_volume")
      ?.options.title,
  ).toBeUndefined();
  expect(
    within(screen.getByRole("group", { name: "Pane 1 legend" })).getByRole(
      "group",
      { name: "AAPL legend" },
    ),
  ).toBe(price);
  expect(
    within(screen.getByRole("group", { name: "Pane 2 legend" })).getByRole(
      "group",
      { name: "AAPL Volume legend" },
    ),
  ).toBe(volume);
  fireEvent.mouseEnter(price);
  expect(fixture.runtime.store.getState().hoveredSeriesId).toBe("csr_price");
  fireEvent.mouseLeave(price);
  expect(fixture.runtime.store.getState().hoveredSeriesId).toBeUndefined();
  const user = userEvent.setup();
  const select = within(price).getByRole("button", {
    name: "Select AAPL series",
  });
  act(() => select.focus());
  await user.keyboard("{Enter}");
  expect(select).toHaveAttribute("aria-pressed", "true");
  fireEvent.mouseEnter(volume);
  expect(fixture.runtime.store.getState().focusedSeriesId).toBe("csr_price");
  expect(
    within(price).getByRole("button", { name: "Remove series" }),
  ).toBeDisabled();
  expect(
    within(volume).getByRole("button", { name: "Remove series" }),
  ).toBeEnabled();
  await user.click(within(volume).getByRole("button", { name: "Hide series" }));
  expect(
    within(volume).getByRole("button", { name: "Show series" }),
  ).toHaveFocus();
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_volume")
      ?.options.visible,
  ).toBe(false);
  await user.click(within(volume).getByRole("button", { name: "Show series" }));
  await user.click(
    within(price).getByRole("button", { name: "Series settings" }),
  );
  fireEvent.change(screen.getByLabelText("Up wick"), {
    target: { value: "#123456" },
  });
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_price")
      ?.options,
  ).toMatchObject({ wickUpColor: "#123456" });
  expect(fixture.active("AAPL")).toBe(channel);
  await user.keyboard("{Escape}");
  fixture.view.unmount();
});

it("changes a comparison's captured source through the existing picker without replacing main", async () => {
  const fixture = setup();
  fixture.view.rerender(fixture.tree("AAPL", true));
  fixture.snapshot("AAPL");
  fixture.snapshot("MSFT");
  vi.mocked(fixture.client.symbology.search).mockResolvedValue([
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "GOOG", currency: "USD" },
    },
  ]);
  vi.mocked(fixture.client.bars.getCapabilities).mockResolvedValue([
    {
      resolution: "1m",
      session: "regular",
      adjustment: "raw",
      modes: ["history", "delayed"],
    },
  ]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Change MSFT symbol" }));
  await user.type(
    screen.getByRole("textbox", { name: "Search symbols" }),
    "GOOG",
  );
  await user.click(await screen.findByRole("button", { name: /GOOG/ }));
  await waitFor(() => expect(fixture.patch).toHaveBeenCalledTimes(1));
  expect(fixture.patch.mock.calls[0]![0]).toMatchObject({
    expectedRevision: 1,
    operations: [
      {
        path: "/cells",
        value: [
          {
            id: "ccl_test",
            marketSources: [
              { id: "cms_primary", listing: { symbol: "AAPL" } },
              { id: "cms_comparison", listing: { symbol: "GOOG" } },
            ],
          },
        ],
      },
    ],
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fixture.view.unmount();
});

it("resizes chart state and canvas with its container without reopening data or losing the viewport", () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  const { runtime } = fixture;
  const rendererCount = mocks.renderers.length;
  const channel = fixture.active("AAPL");
  const viewport = runtime.store.getState().config.xAxis;
  const series = v2.ChartStateUtils.getSeries(
    runtime.store.getState(),
    "csr_price",
  )!.data;
  for (const [width, height] of [
    [900, 600],
    [420, 240],
  ] as const) {
    act(() => mocks.resize(width, height));
    expect(runtime.store.getState().config.chart.dimensions).toMatchObject({
      width,
      height,
    });
    expect(runtime.renderer.scheduleResize).toHaveBeenLastCalledWith(
      width,
      height,
    );
    expect(runtime.store.getState().config.xAxis).toBe(viewport);
    expect(
      v2.ChartStateUtils.getSeries(runtime.store.getState(), "csr_price")!.data,
    ).toBe(series);
  }
  expect(fixture.runtime).toBe(runtime);
  expect(mocks.renderers).toHaveLength(rendererCount);
  expect(fixture.active("AAPL")).toBe(channel);
  expect(channel.stop).not.toHaveBeenCalled();
  fixture.view.unmount();
});

it("updates canvas colors from the app theme without remounting and releases its observer", async () => {
  const fixture = setup();
  const { runtime } = fixture;
  const rendererCount = mocks.renderers.length;
  expect(runtime.store.getState().config.chart.layout.background).toBe(
    "#ffffff",
  );
  await act(async () => {
    document.documentElement.classList.add("dark");
  });
  expect(runtime.store.getState().config.chart.layout.background).toBe(
    "#000000",
  );
  expect(fixture.runtime).toBe(runtime);
  expect(mocks.renderers).toHaveLength(rendererCount);
  fixture.view.unmount();
  const committed = runtime.store.getState();
  await act(async () => {
    document.documentElement.classList.remove("dark");
  });
  expect(runtime.store.getState()).toBe(committed);
});

it("shares price/volume data, preserves immutable versions, and does not reopen unchanged inputs", async () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  await waitFor(() =>
    expect(
      v2.ChartStateUtils.getSeries(
        fixture.runtime.store.getState(),
        "csr_price",
      )?.data,
    ).toHaveLength(1),
  );
  const state = fixture.runtime.store.getState(),
    before = v2.ChartStateUtils.getSeries(state, "csr_price")!.data;
  const channel = fixture.active("AAPL");
  act(() =>
    channel.sink.next({ type: "updates", data: fixture.data("AAPL", 3) }),
  );
  const next = fixture.runtime.store.getState();
  expect(next).not.toBe(state);
  expect(before).toMatchObject([{ close: 2 }]);
  expect(v2.ChartStateUtils.getSeries(next, "csr_price")?.data).toMatchObject([
    { time: 1, close: 3, trades: 3, final: false, note: "native" },
  ]);
  expect(
    v2.ChartStateUtils.getSeries(next, "csr_volume")?.fieldMap,
  ).toMatchObject({ value: "volume" });
  act(() =>
    fixture.local.setState((state) => ({
      series: {
        ...state.series,
        csr_price: SeriesPreferences.parse({ type: "Line" }),
      },
    })),
  );
  expect(fixture.active("AAPL")).toBe(channel);
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_price")
      ?.data,
  ).toMatchObject([{ close: 3 }]);
  fixture.view.rerender(fixture.tree("AAPL", true));
  fixture.snapshot("MSFT");
  expect(fixture.active("AAPL")).toBe(channel);
  const comparison = fixture.active("MSFT");
  act(() =>
    fixture.runtime.mutate((draft) => {
      draft.lockedSeriesId = "csr_compare";
      draft.magnetSeriesId = "csr_compare";
    }),
  );
  fixture.view.rerender(fixture.tree());
  expect(comparison.stop).toHaveBeenCalledOnce();
  expect(
    v2.ChartStateUtils.getSeries(
      fixture.runtime.store.getState(),
      "csr_compare",
    ),
  ).toBeUndefined();
  expect(fixture.runtime.store.getState().lockedSeriesId).toBeUndefined();
  expect(fixture.runtime.store.getState().magnetSeriesId).toBeUndefined();
  const drawing = Drawing.create("trend_line", [
    { time: 1, price: 1 },
    { time: 2, price: 2 },
  ]);
  act(() =>
    fixture.runtime.mutate((draft) =>
      v2.ChartStateModel.upsertDrawingObject(draft, drawing),
    ),
  );
  const previousDrawing = v2.ChartStateModel.drawingItems(
    fixture.runtime.store.getState(),
  )[0];
  act(() =>
    fixture.runtime.mutate((draft) => {
      v2.ChartStateModel.drawingItems(draft)[0]!.style.lineWidth = 5;
      draft.lockedSeriesId = "csr_price";
    }),
  );
  expect(previousDrawing).toMatchObject({ style: { lineWidth: 1 } });
  expect(
    v2.ChartStateModel.drawingItems(fixture.runtime.store.getState())[0],
  ).toMatchObject({ style: { lineWidth: 5 } });
  act(() =>
    mocks.renderers.at(-1)!.config.setState((draft) => {
      delete draft.lockedSeriesId;
    }),
  );
  expect("lockedSeriesId" in fixture.runtime.store.getState()).toBe(false);
  const version = fixture.runtime.store.getState();
  act(() =>
    fixture.runtime.mutate((draft) => {
      draft.drawings.activeTool = "trend_line";
    }),
  );
  expect(version.drawings.activeTool).not.toBe("trend_line");
  expect(fixture.runtime.store.getState().drawings.activeTool).toBe(
    "trend_line",
  );
  act(() =>
    mocks.renderers.at(-1)!.config.setState((draft) => {
      delete draft.drawings.activeTool;
    }),
  );
  expect("activeTool" in fixture.runtime.store.getState().drawings).toBe(false);
  fixture.view.unmount();
  for (const call of fixture.calls) expect(call.stop).toHaveBeenCalledOnce();
  for (const renderer of mocks.renderers)
    expect(renderer.dispose).toHaveBeenCalledOnce();
});

it("keeps the previous symbol label, rejects retired updates, and exposes retry", async () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  await waitFor(() =>
    expect(
      v2.ChartStateUtils.getSeries(
        fixture.runtime.store.getState(),
        "csr_price",
      )?.data,
    ).toHaveLength(1),
  );
  const old = fixture.active("AAPL");
  fixture.view.rerender(fixture.tree("MSFT"));
  await waitFor(() => expect(old.stop).toHaveBeenCalledOnce());
  expect(screen.getByText("AAPL", { exact: true })).toBeInTheDocument();
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_price")
      ?.options.title,
  ).toBe("AAPL");
  act(() =>
    old.sink.next({ type: "updates", data: fixture.data("AAPL", 999) }),
  );
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_price")
      ?.data,
  ).toMatchObject([{ close: 2 }]);
  act(() =>
    fixture.active("MSFT").sink.error(
      new FeedError({
        reason: new FeedReasons.SourceUnavailable({
          provider: ProviderId.make("yfinance"),
        }),
      }),
    ),
  );
  const failureToast = await findErrorToast(
    "Yahoo Finance is unavailable right now.",
  );
  act(() =>
    within(failureToast).getByRole("button", { name: "Retry" }).click(),
  );
  fixture.snapshot("MSFT");
  await screen.findByText("MSFT", { exact: true });
  expect(
    v2.ChartStateUtils.getSeries(fixture.runtime.store.getState(), "csr_price")
      ?.options.title,
  ).toBe("MSFT");
  // Finish Sonner's removal animation before destroying its browser environment.
  await waitFor(() => expect(failureToast).not.toBeInTheDocument());
  fixture.view.unmount();
});

it("offers no Retry for a failure that cannot succeed on retry", async () => {
  const fixture = setup();
  act(() =>
    fixture.active("AAPL").sink.error(
      new FeedError({
        reason: new FeedReasons.AccessDenied({
          provider: ProviderId.make("openchart"),
        }),
      }),
    ),
  );
  const failureToast = await findErrorToast("OpenChart Cloud denied access.");
  expect(
    within(failureToast).queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  fixture.view.unmount();
  await waitFor(() => expect(failureToast).not.toBeInTheDocument());
});

it("follows appended bars without resetting zoom and holds a historical viewport", async () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  const source = fixture.active("AAPL");
  const records = Array.from({ length: 100 }, (_, index) => ({
    time: (index + 2) * 60000,
    open: 1,
    high: 4,
    low: 1,
    close: 2,
    volume: 10,
    trades: 3,
    final: false,
    note: "native",
  }));
  act(() =>
    source.sink.next({
      type: "updates",
      data: NativeBars.create({ labels: { symbol: "AAPL" }, rows: records }),
    }),
  );
  const initialSpacing = v2.XScale.getAxis(
    fixture.runtime.store.getState().config.xAxis,
  ).spacing.barSpacing;
  const append = (time: number) =>
    act(() =>
      source.sink.next({
        type: "updates",
        data: fixture.data("AAPL", 3, time),
      }),
    );
  append(102 * 60000);
  expect(
    v2.XScale.getAxis(fixture.runtime.store.getState().config.xAxis).spacing
      .barSpacing,
  ).toBe(initialSpacing);
  expect(
    v2.ChartStateUtils.getVisibleRange(fixture.runtime.store.getState()).to,
  ).toBe(102);
  act(() =>
    fixture.runtime.mutate((state) =>
      v2.ChartStateUtils.setVisibleRange(state, 20, 60),
    ),
  );
  const before = v2.ChartStateUtils.getVisibleRange(
    fixture.runtime.store.getState(),
  );
  append(103 * 60000);
  expect(
    v2.ChartStateUtils.getVisibleRange(fixture.runtime.store.getState()),
  ).toEqual(before);
  fixture.view.unmount();
});

it("recomputes a latest window when switching from daily to minute data", async () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  fixture.view.rerender(fixture.tree("AAPL", false, "1d"));
  await waitFor(() =>
    expect(fixture.active("AAPL").request.resolution).toBe("1d"),
  );
  const daily = fixture.active("AAPL");
  expect(daily.request.from).toBeLessThan(Date.now() - 86400000);
  const count = fixture.calls.length;
  fixture.view.rerender(fixture.tree("AAPL", false, "1m"));
  await waitFor(() =>
    expect(fixture.active("AAPL").request.resolution).toBe("1m"),
  );
  expect(fixture.active("AAPL").request.from).toBeGreaterThan(
    Date.now() - 86400000,
  );
  expect(fixture.calls).toHaveLength(count + 1);
  expect(daily.stop).toHaveBeenCalledOnce();
  fixture.view.unmount();
});

it("keeps market execution and chart updates alive when legend surfaces are removed", () => {
  const fixture = setup();
  fixture.snapshot("AAPL");
  const channel = fixture.active("AAPL");
  const callCount = fixture.calls.length;
  fixture.view.rerender(fixture.tree("AAPL", false, "1m", false));
  expect(
    screen.queryByRole("group", { name: "Pane 1 legend" }),
  ).not.toBeInTheDocument();
  expect(channel.stop).not.toHaveBeenCalled();
  act(() =>
    channel.sink.next({ type: "updates", data: fixture.data("AAPL", 7, 2000) }),
  );
  expect(
    v2.ChartStateUtils.getSeries(
      fixture.runtime.store.getState(),
      "csr_price",
    )?.data.at(-1),
  ).toMatchObject({ time: 2, close: 7 });
  fixture.view.rerender(fixture.tree());
  expect(
    screen.getByRole("group", { name: "AAPL legend" }),
  ).toBeInTheDocument();
  expect(fixture.calls).toHaveLength(callCount);
  expect(channel.stop).not.toHaveBeenCalled();
  fixture.view.unmount();
  expect(channel.stop).toHaveBeenCalledOnce();
});
