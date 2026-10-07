// Purpose: The visible range's volume profile runs the built-in range script over the bars on screen.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Field,
  Float64,
  List,
  Schema,
  Struct,
  TimestampMillisecond,
  Utf8,
} from "apache-arrow";
import { EMPTY, NEVER, Observable, type Subscriber } from "rxjs";
import { expect, it, vi } from "vitest";
import { v2 } from "@openchart/chart-core";
import {
  FeedVersion,
  Resolution,
  type BarsCapabilities,
} from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { fromRows } from "@openchart/timeseries";
import { Drawing } from "@openchart/chart-core";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  chartDetail,
  chartIds,
  createCell,
  type CellDefinition,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { MarketSource } from "@openchart/app/features/chart/components/sources/market";
import {
  FixedRangeVolumeProfiles,
  RangeVolumeProfile,
  VisibleRangeVolumeProfile,
  type ProfileBars,
} from "@openchart/app/features/chart/components/sources/volume-profile";
import { ProfileSettingsForm } from "@openchart/app/features/chart/components/profile-settings-form";
import { ChartContext } from "@openchart/app/lib/chart/context";
import type { FeedClient } from "@openchart/app/lib/feed/client";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  FeedReactContext,
  FeedVersionContext,
} from "@openchart/app/lib/feed/provider";
import {
  createChartPreferences,
  updateSeriesStyles,
} from "@openchart/app/lib/chart/preferences";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  observe: vi.fn(),
  dispose: vi.fn(),
  snapshot: vi.fn(),
  builtin: vi.fn(),
  drawings: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => mocks,
}));
vi.mock("@openchart/app/hooks/use-chart-grid", () => ({
  useChartGrid: () => ({
    chartId: "cht_test",
    transport: {
      url: "test",
      rpc: {
        indicators: { chartBuiltin: { query: mocks.builtin } },
        resources: {
          chart: { patch: { mutate: mocks.patch } },
          drawing: { list: { query: mocks.drawings } },
        },
      },
    },
  }),
}));

const hour = 3_600_000;
const day = 86_400_000;
const series = {
  provider: ProviderId.make("test"),
  listing: { symbol: "AAA", currency: "USD" },
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
} as const;

/** Capabilities offering `resolutions`, by default at the series' session and adjustment. */
const offered = (
  resolutions: readonly Resolution[],
  session: "regular" | "extended" = series.session,
  adjustment: "raw" | "split" = series.adjustment,
): BarsCapabilities =>
  resolutions.map((resolution) => ({
    resolution,
    session,
    adjustment,
    modes: ["history", "live"],
  }));

/**
 * Query, Feed and tooltips for one test. The Feed offers `capabilities` (or
 * what a function returns on each read), none by default so a profile reads
 * the chart's own resolution, and never sends bars. `nextVersion` publishes a
 * new Feed version for the next render.
 */
function providers(
  capabilities:
    | BarsCapabilities
    | Promise<BarsCapabilities>
    | (() => Promise<BarsCapabilities>) = [],
) {
  // As in the app, a failed query is not retried.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let version = FeedVersion.make("test");
  const feed = {
    bars: {
      observe: () => NEVER,
      getCapabilities: () =>
        typeof capabilities === "function"
          ? capabilities()
          : Promise.resolve(capabilities),
    },
  } as unknown as FeedClient;
  return {
    queryClient,
    nextVersion: () => {
      version = FeedVersion.make(`${version}+`);
    },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <FeedReactContext.Provider value={feed}>
          <FeedVersionContext.Provider value={version}>
            <TooltipProvider>{children}</TooltipProvider>
          </FeedVersionContext.Provider>
        </FeedReactContext.Provider>
      </QueryClientProvider>
    ),
  };
}

/**
 * A chart without a renderer, whose store the sources update. Its main series
 * holds one bar opening at `newest`, by default now, which tells a range run
 * how far the market's data reaches; `null` leaves it without bars.
 */
function newChart(
  id: string,
  newest: number | null = Date.now(),
): ChartRuntime {
  const store = createChartStore(v2.createState({ id }));
  const chart: ChartRuntime = {
    id,
    store,
    // Closing a settings dialog focuses the canvas.
    renderer: {
      canvas: document.createElement("canvas"),
    } as unknown as v2.ChartRenderer,
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
      fieldMap: { x: "time", value: "close" },
      data: [],
    });
    v2.ChartStateModel.getSeriesObject(state, "price")!.role = "main";
  });
  if (newest !== null) setBars(chart, [newest]);
  return chart;
}

/** Give the chart main bars opening at `times`. */
function setBars(chart: ChartRuntime, times: number[]) {
  chart.mutate((state) =>
    v2.ChartStateUtils.setSeriesData(
      state,
      "price",
      times.map((time) => ({
        time: time / 1000,
        open: 10,
        high: 11,
        low: 9,
        close: 10,
      })),
    ),
  );
}

/** Daily main bars opening at `times`, showing the bars from index `from` to `to`. */
function showBars(
  chart: ChartRuntime,
  times: number[],
  from: number,
  to: number,
) {
  setBars(chart, times);
  chart.mutate((state) => v2.ChartStateUtils.setVisibleRange(state, from, to));
}

/** The resolution of the bars each range run read, in order. */
const runResolutions = () =>
  mocks.observe.mock.calls.map(
    ([request]) =>
      ((request as Tea.ObserveRequest).inputs.bars as { resolution: string })
        .resolution,
  );

/** What the provider says when it can't serve a series over a window. */
const unservable = () =>
  new Tea.Error({
    code: "upstream",
    message: "The data source could not complete this operation.",
  });

const color = new Struct(
  ["r", "g", "b", "a"].map((name) => new Field(name, new Float64(), false)),
);
const list = (fields: Field[]) =>
  new List(new Field("item", new Struct(fields), true));
const outputs = new Schema([
  new Field("time", new TimestampMillisecond(), false),
  new Field(
    "profile",
    new Struct([
      new Field("from", new Float64(), false),
      new Field("to", new Float64(), false),
      new Field(
        "rows",
        list([
          new Field("low", new Float64(), false),
          new Field("high", new Float64(), false),
          new Field(
            "segments",
            list([
              new Field("value", new Float64(), false),
              new Field("color", color, true),
              new Field("title", new Utf8(), false),
            ]),
            false,
          ),
        ]),
        false,
      ),
      new Field(
        "levels",
        list([
          new Field("y", new Float64(), false),
          new Field("color", color, true),
          new Field("title", new Utf8(), false),
        ]),
        false,
      ),
      new Field("display", new Utf8(), false),
    ]),
    true,
  ),
]);

/** Serve the range script's location, source and compilation; returns its observation's sink. */
function runsRangeScript() {
  vi.clearAllMocks();
  mocks.builtin.mockResolvedValue({
    workspaceId: "wsp_test",
    path: "indicators/builtin/volume-profile-range.tea",
  });
  mocks.snapshot.mockResolvedValue({
    entry: "indicators/builtin/volume-profile-range.tea",
    sources: { "indicators/builtin/volume-profile-range.tea": "range" },
  });
  mocks.compile.mockResolvedValue({
    id: "range",
    declaration: {
      kind: "indicator",
      title: "Range",
      overlay: true,
      timeframe: "",
    },
    definition: {
      parameters: [
        { name: "rangeStart", type: "int", default: 0 },
        { name: "rangeEnd", type: "int", default: 0 },
        { name: "rows", type: "int", defaultValue: 24 },
      ],
      inputs: new Schema([]),
      outputs: new Schema([]),
      requests: {},
    },
  });
  mocks.dispose.mockResolvedValue(undefined);
  let sink!: Subscriber<Tea.Message>;
  mocks.observe.mockReturnValue(
    new Observable<Tea.Message>((subscriber) => {
      sink = subscriber;
    }),
  );
  return () => sink;
}

/** One drawn profile row from start to end, as the range script writes it. */
function snapshotOf(start: number, end: number): Tea.Message {
  return {
    type: "snapshot",
    rid: "run",
    config: { inputs: {}, map: {}, parameters: {}, requests: {} },
    snapshot: {
      range: { from: start, to: end },
      data: fromRows(outputs, [
        {
          time: end - day,
          profile: {
            from: start,
            to: end,
            rows: [
              {
                low: 9,
                high: 11,
                segments: [
                  {
                    value: 5,
                    color: { r: 0, g: 0, b: 0, a: 255 },
                    title: "Up volume",
                  },
                ],
              },
            ],
            levels: [],
            display: "all",
          },
        },
      ]),
    },
  };
}

it("profiles the bars on screen against the price axis and follows visibility", async () => {
  const chart = newChart("vpvr");
  const { store } = chart;
  const times = Array.from({ length: 40 }, (_, index) => index * day);
  showBars(chart, times, 10, 30);
  const visible = v2.ChartStateUtils.getVisibleRange(store.getState());
  const start = times[Math.ceil(visible.from)]!;
  const end = times[Math.min(39, Math.floor(visible.to))]! + day;

  const sink = runsRangeScript();
  const preferences = createChartPreferences("vpvr");
  const { queryClient, wrapper } = providers();
  const view = render(
    <ChartContext.Provider value={chart}>
      <VisibleRangeVolumeProfile
        id="profile"
        pane={0}
        axisId="right"
        series={series}
        localStore={preferences}
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledOnce());
  // These bars are long past, so the run stops at the range's end.
  expect(mocks.observe.mock.calls[0]![0]).toMatchObject({
    parameters: { rangeStart: start, rangeEnd: end },
    from: start,
    to: end,
    warmupBars: 0,
  });
  act(() =>
    sink().next({
      type: "snapshot",
      rid: "run",
      config: { inputs: {}, map: {}, parameters: {}, requests: {} },
      snapshot: {
        range: { from: start, to: end },
        data: fromRows(outputs, [
          { time: start, profile: null },
          {
            time: end - day,
            profile: {
              from: start,
              to: end,
              rows: [
                {
                  low: 9,
                  high: 11,
                  segments: [
                    {
                      value: 5,
                      color: { r: 0, g: 0, b: 0, a: 255 },
                      title: "Up volume",
                    },
                  ],
                },
              ],
              levels: [],
              display: "all",
            },
          },
        ]),
      },
    }),
  );
  const profiles = () =>
    Object.values(store.getState().objects).flatMap((object) =>
      object.kind === "vertical-profile" ? [object.profile] : [],
    );
  expect(profiles()).toEqual([
    expect.objectContaining({
      box: { kind: "edge", side: "right", width: 0.3 },
      rows: [expect.objectContaining({ low: 9, high: 11 })],
    }),
  ]);
  // Style colors repaint the drawn profile without another run.
  act(() =>
    updateSeriesStyles(preferences, ["profile"], {
      partColors: { "Up volume": "#ff0000" },
    }),
  );
  expect(profiles()[0]!.rows[0]!.segments[0]!.color).toBe("#ff0000");
  // A hidden profile stays placed, so Style still lists its parts.
  act(() => updateSeriesStyles(preferences, ["profile"], { visible: false }));
  expect(profiles()).toEqual([expect.objectContaining({ visible: false })]);
  expect(mocks.observe).toHaveBeenCalledOnce();
  view.unmount();
  queryClient.clear();
});

it("keeps the last profile drawn while a new range runs, but not for other bars", async () => {
  const chart = newChart("range");
  const { store } = chart;
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers();
  const range = (
    end: number,
    adjustment: "raw" | "split" = series.adjustment,
    symbol: string = series.listing.symbol,
  ) => (
    <ChartContext.Provider value={chart}>
      <RangeVolumeProfile
        id="range"
        pane={0}
        axisId="right"
        series={{
          ...series,
          adjustment,
          listing: { ...series.listing, symbol },
        }}
        start={10 * day}
        end={end}
        box={{ kind: "time", from: 10 * 86_400, to: end / 1000 }}
        visible
      />
    </ChartContext.Provider>
  );
  const boxes = () =>
    Object.values(store.getState().objects).flatMap((object) =>
      object.kind === "vertical-profile" ? [object.profile.box] : [],
    );
  const view = render(range(20 * day), { wrapper });
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledOnce());
  act(() => sink().next(snapshotOf(10 * day, 20 * day)));
  expect(boxes()).toEqual([
    { kind: "time", from: 10 * 86_400, to: 20 * 86_400 },
  ]);
  // The longer range's run has no rows yet: the last profile fills its box.
  view.rerender(range(30 * day));
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(2));
  expect(boxes()).toEqual([
    { kind: "time", from: 10 * 86_400, to: 30 * 86_400 },
  ]);
  // Other bars of the same listing keep the run mounted; their prices differ,
  // so the last profile is not drawn on them.
  view.rerender(range(30 * day, "split"));
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(3));
  expect(boxes()).toEqual([]);
  act(() => sink().next(snapshotOf(10 * day, 30 * day)));
  view.rerender(range(30 * day, "split", "BBB"));
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledTimes(4));
  expect(boxes()).toEqual([]);
  view.unmount();
  queryClient.clear();
});

it("profiles each visible fixed-range drawing between its anchors", async () => {
  const chart = newChart("frvp");
  const { store } = chart;
  const sink = runsRangeScript();
  const scope = {
    dashboardId: "dsh_test",
    provider: series.provider,
    listing: series.listing,
  };
  const row = (data: Drawing.Item) => ({
    id: `drw_${data.id}`,
    ...scope,
    data,
  });
  const anchors = [
    { time: 10 * 86_400, price: 10 },
    { time: 20 * 86_400, price: 10 },
  ];
  mocks.drawings.mockResolvedValue({
    items: [
      row(Drawing.create("volume_profile", anchors, { id: "range" })),
      row(
        Drawing.create("volume_profile", anchors, { id: "off", hidden: true }),
      ),
      row(
        Drawing.create(
          "rectangle",
          [anchors[0]!, { time: 20 * 86_400, price: 12 }],
          { id: "box" },
        ),
      ),
    ],
    nextCursor: null,
  });
  const { queryClient, wrapper } = providers();
  const view = render(
    <ChartContext.Provider value={chart}>
      <FixedRangeVolumeProfiles
        scope={scope}
        settings={{ resolution: "1d", session: "regular", adjustment: "raw" }}
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledOnce());
  expect(mocks.observe.mock.calls[0]![0]).toMatchObject({
    parameters: { rangeStart: 10 * day, rangeEnd: 20 * day },
    warmupBars: 0,
  });
  act(() => sink().next(snapshotOf(10 * day, 20 * day)));
  expect(
    Object.values(store.getState().objects).flatMap((object) =>
      object.kind === "vertical-profile" ? [object.profile.box] : [],
    ),
  ).toEqual([{ kind: "time", from: 10 * 86_400, to: 20 * 86_400 }]);
  view.unmount();
  queryClient.clear();
});

/**
 * The resolution a range run reads for a market at `resolution` offering
 * `capabilities`, on a chart whose newest bar opens at `newest`.
 */
async function runResolution(
  resolution: Resolution,
  capabilities: Parameters<typeof providers>[0],
  start: number,
  end: number,
  newest = Date.now(),
) {
  runsRangeScript();
  const { queryClient, wrapper } = providers(capabilities);
  const view = render(
    <ChartContext.Provider value={newChart("resolution", newest)}>
      <RangeVolumeProfile
        id="range"
        pane={0}
        axisId="right"
        series={{ ...series, resolution }}
        start={start}
        end={end}
        box={{ kind: "time", from: start / 1000, to: end / 1000 }}
        visible
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledOnce());
  view.unmount();
  queryClient.clear();
  return runResolutions()[0];
}

// These ranges end after now, so a run reads just the range.
it.each([
  {
    rule: "the finest resolution whose bars fit about 5,000",
    chart: "1d",
    capabilities: offered(Resolution.literals),
    span: 5_000 * hour,
    chosen: "1h",
  },
  {
    rule: "the next coarser one past 5,000 bars",
    chart: "1d",
    capabilities: offered(Resolution.literals),
    span: 5_001 * hour,
    chosen: "4h",
  },
  {
    rule: "only resolutions the provider offers",
    chart: "1d",
    capabilities: offered(["30m", "1d"]),
    span: 1_000 * hour,
    chosen: "30m",
  },
  {
    rule: "only at the chart's session and adjustment",
    chart: "1d",
    capabilities: [
      ...offered(["15m"], "extended"),
      ...offered(["15m"], "regular", "split"),
      ...offered(["30m", "1d"]),
    ],
    span: 1_000 * hour,
    chosen: "30m",
  },
  {
    rule: "never finer than 1m",
    chart: "1h",
    capabilities: offered(Resolution.literals),
    span: hour,
    chosen: "1m",
  },
  {
    rule: "never coarser than the chart",
    chart: "4h",
    capabilities: offered(Resolution.literals),
    span: 3_650 * day,
    chosen: "4h",
  },
] as const)(
  "a range profile reads $rule",
  async ({ chart, capabilities, span, chosen }) => {
    const end = Date.now() + day;
    expect(await runResolution(chart, capabilities, end - span, end)).toBe(
      chosen,
    );
  },
);

it("waits for the provider's capabilities before choosing", async () => {
  runsRangeScript();
  let offer!: (capabilities: BarsCapabilities) => void;
  const { queryClient, wrapper } = providers(
    new Promise((resolve) => {
      offer = resolve;
    }),
  );
  const end = Date.now() + day;
  const view = render(
    <ChartContext.Provider value={newChart("wait")}>
      <RangeVolumeProfile
        id="range"
        pane={0}
        axisId="right"
        series={series}
        start={end - 300 * day}
        end={end}
        box={{ kind: "time", from: (end - 300 * day) / 1000, to: end / 1000 }}
        visible
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(mocks.builtin).toHaveBeenCalled());
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  // The script is found, but nothing reads or runs it yet.
  expect(mocks.snapshot).not.toHaveBeenCalled();
  act(() => offer(offered(Resolution.literals)));
  await waitFor(() => expect(mocks.observe).toHaveBeenCalled());
  expect(runResolutions()).toEqual(["4h"]);
  view.unmount();
  queryClient.clear();
});

it("runs a past range over its own bars only, and budgets just those", async () => {
  // These 30 days fit 2,880 15m bars; reading on until now, 400 days, would
  // fit only 4h ones.
  const start = Date.now() - 400 * day;
  expect(
    await runResolution(
      "1d",
      offered(Resolution.literals),
      start,
      start + 30 * day,
    ),
  ).toBe("15m");
  expect(mocks.observe.mock.calls[0]![0]).toMatchObject({
    from: start,
    to: start + 30 * day,
  });
});

it("runs a range over its own bars only once the chart has a bar opening at or after its end", async () => {
  // As on a market whose data runs a day behind the clock: a range ending
  // after its newest bar opened may still hold that bar while it forms.
  const newest = Date.now() - day;
  const to = async (end: number) => {
    await runResolution("1d", [], end - 10 * day, end, newest);
    return (mocks.observe.mock.calls[0]![0] as Tea.ObserveRequest).to;
  };
  expect(await to(newest)).toBe(newest);
  expect(await to(newest + 1)).toBe("now");
});

it("waits for the chart's bars before running a range", async () => {
  const chart = newChart("bars", null);
  runsRangeScript();
  const { queryClient, wrapper } = providers();
  const end = Date.now() - 10 * day;
  const view = render(
    <ChartContext.Provider value={chart}>
      <RangeVolumeProfile
        id="range"
        pane={0}
        axisId="right"
        series={series}
        start={end - 10 * day}
        end={end}
        box={{ kind: "time", from: (end - 10 * day) / 1000, to: end / 1000 }}
        visible
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(mocks.builtin).toHaveBeenCalled());
  await settle();
  expect(mocks.observe).not.toHaveBeenCalled();
  act(() => setBars(chart, [Date.now()]));
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledOnce());
  expect(mocks.observe.mock.calls[0]![0]).toMatchObject({ to: end });
  view.unmount();
  queryClient.clear();
});

it("runs a range once more on the chart's resolution when the provider can't serve finer bars", async () => {
  const chart = newChart("fallback");
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(Resolution.literals));
  const end = Date.now() + day;
  const range = (days: number) => (
    <ChartContext.Provider value={chart}>
      <RangeVolumeProfile
        id="range"
        pane={0}
        axisId="right"
        series={series}
        start={end - days * day}
        end={end}
        box={{ kind: "time", from: (end - days * day) / 1000, to: end / 1000 }}
        visible
      />
    </ChartContext.Provider>
  );
  const profiles = () =>
    Object.values(chart.store.getState().objects).filter(
      (object) => object.kind === "vertical-profile",
    );
  const view = render(range(300), { wrapper });
  await waitFor(() => expect(runResolutions()).toEqual(["4h"]));
  act(() => sink().next(snapshotOf(end - 300 * day, end)));
  expect(profiles()).toHaveLength(1);
  // The next range's 4h bars fail, so it runs on the chart's 1d, while the
  // last profile stays drawn.
  view.rerender(range(250));
  await waitFor(() => expect(runResolutions()).toEqual(["4h", "4h"]));
  act(() => sink().error(unservable()));
  await waitFor(() => expect(runResolutions()).toEqual(["4h", "4h", "1d"]));
  expect(mocks.observe.mock.calls[2]![0]).toMatchObject({
    parameters: { rangeStart: end - 250 * day, rangeEnd: end },
  });
  expect(profiles()).toHaveLength(1);
  // When the chart's own bars fail too, the failure stays; nothing runs again.
  act(() => sink().error(unservable()));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(runResolutions()).toEqual(["4h", "4h", "1d"]);
  // A new range tries finer bars again: 100 days are 4,800 30m bars.
  view.rerender(range(100));
  await waitFor(() =>
    expect(runResolutions()).toEqual(["4h", "4h", "1d", "30m"]),
  );
  view.unmount();
  queryClient.clear();
});

it("reads the chart's resolution when the provider's capabilities fail to load", async () => {
  const end = Date.now() + day;
  expect(
    await runResolution(
      "1d",
      () => Promise.reject(new Error("Capabilities are unavailable")),
      end - 300 * day,
      end,
    ),
  ).toBe("1d");
});

/**
 * A range profile ending tomorrow over the last `days` days, on `chart`, with
 * the bars and number of volume bars `settings` chose.
 */
function lastDays(
  chart: ChartRuntime,
  end: number,
  days: number,
  settings: Partial<Parameters<typeof RangeVolumeProfile>[0]> = {},
) {
  return (
    <ChartContext.Provider value={chart}>
      <RangeVolumeProfile
        id="range"
        pane={0}
        axisId="right"
        series={series}
        start={end - days * day}
        end={end}
        box={{ kind: "time", from: (end - days * day) / 1000, to: end / 1000 }}
        visible
        {...settings}
      />
    </ChartContext.Provider>
  );
}

const drawnProfiles = (chart: ChartRuntime) =>
  Object.values(chart.store.getState().objects).filter(
    (object) => object.kind === "vertical-profile",
  );
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 20)));

it("steps to the next coarser offered bars when finer ones fail", async () => {
  // As on Yahoo: 92 days are 4,416 30m bars, which it keeps for 59 days only,
  // and 2,208 1h bars, which it keeps for 729.
  const chart = newChart("step");
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(["30m", "1h", "1d"]));
  const end = Date.now() + day;
  const view = render(lastDays(chart, end, 92), { wrapper });
  await waitFor(() => expect(runResolutions()).toEqual(["30m"]));
  act(() => sink().error(unservable()));
  await waitFor(() => expect(runResolutions()).toEqual(["30m", "1h"]));
  view.unmount();
  queryClient.clear();
});

it("reads the bars and the number of volume bars its settings chose", async () => {
  const chart = newChart("chosen");
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(Resolution.literals));
  const end = Date.now() + day;
  // 300 days are 86,400 5m bars, far past the default's 5,000; a choice
  // reads them.
  const view = render(
    lastDays(chart, end, 300, { resolution: "5m", rows: 50 }),
    { wrapper },
  );
  await waitFor(() => expect(runResolutions()).toEqual(["5m"]));
  expect(mocks.observe.mock.calls[0]![0]).toMatchObject({
    parameters: { rangeStart: end - 300 * day, rangeEnd: end, rows: 50 },
  });
  // Bars the provider can't serve step to the next coarser ones that fit.
  act(() => sink().error(unservable()));
  await waitFor(() => expect(runResolutions()).toEqual(["5m", "15m"]));
  // A new choice tries its bars again, while they stay near 100,000: 300 days
  // are 432,000 1m bars, so the finest that fit, 5m, are read instead.
  view.rerender(lastDays(chart, end, 300, { resolution: "1m" }));
  await waitFor(() => expect(runResolutions()).toEqual(["5m", "15m", "5m"]));
  // Without a number of volume bars, the script's own 24 applies.
  expect(mocks.observe.mock.calls[2]![0]).toMatchObject({
    parameters: { rows: 24 },
  });
  view.unmount();
  queryClient.clear();
});

it("says why it reads other bars than its choice: a read too large, or a provider that can't serve them", async () => {
  const chart = newChart("note");
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(["1m", "5m", "1h", "1d"]));
  const end = Date.now() + day;
  const onBars = vi.fn();
  // 300 days are 432,000 1m bars, past the 100,000 a choice may read.
  const view = render(lastDays(chart, end, 300, { resolution: "1m", onBars }), {
    wrapper,
  });
  await waitFor(() =>
    expect(onBars).toHaveBeenLastCalledWith({
      resolution: "5m",
      note: "1m would read about 432,000 bars on this range.",
    }),
  );
  // 30 days fit 1h bars, which the provider can't serve that far back.
  view.rerender(lastDays(chart, end, 30, { resolution: "1h", onBars }));
  await waitFor(() => expect(runResolutions().at(-1)).toBe("1h"));
  act(() =>
    sink().error(
      new Tea.Error({
        code: "upstream",
        message: "Yahoo Finance only keeps this data from 2024-10-05.",
      }),
    ),
  );
  await waitFor(() =>
    expect(onBars).toHaveBeenLastCalledWith({
      resolution: "1d",
      note: "Yahoo Finance only keeps this data from 2024-10-05.",
    }),
  );
  // The choice in use says nothing.
  view.rerender(lastDays(chart, end, 30, { resolution: "5m", onBars }));
  await waitFor(() =>
    expect(onBars).toHaveBeenLastCalledWith({
      resolution: "5m",
      note: undefined,
    }),
  );
  view.unmount();
  queryClient.clear();
});

it("settings name the bars in use, and why, when they aren't the saved choice", async () => {
  const { queryClient, wrapper } = providers(offered(["1h", "1d"]));
  const form = (inUse: ProfileBars) => (
    <ProfileSettingsForm
      series={series}
      saved={{ resolution: "1h" }}
      inUse={inUse}
      onSave={async () => {}}
    />
  );
  const view = render(
    form({
      resolution: "1d",
      note: "Yahoo Finance only keeps this data from 2024-10-05.",
    }),
    { wrapper },
  );
  expect(
    screen.getByText(
      "Using 1d: Yahoo Finance only keeps this data from 2024-10-05.",
    ),
  ).toBeInTheDocument();
  view.rerender(form({ resolution: "1h" }));
  expect(screen.queryByText(/^Using/)).not.toBeInTheDocument();
  view.unmount();
  queryClient.clear();
});

it.each([
  { rule: "the provider doesn't offer", resolution: "1m" },
  { rule: "is coarser than the chart", resolution: "1W" },
] as const)(
  "keeps the default pick for a choice that $rule",
  async ({ resolution }) => {
    const chart = newChart("unusable");
    runsRangeScript();
    const { queryClient, wrapper } = providers(offered(["4h", "1d", "1W"]));
    const view = render(
      lastDays(chart, Date.now() + day, 300, { resolution }),
      { wrapper },
    );
    await waitFor(() => expect(runResolutions()).toEqual(["4h"]));
    view.unmount();
    queryClient.clear();
  },
);

it("falls back only when the provider can't serve the bars before the run draws", async () => {
  const chart = newChart("no-fallback");
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(Resolution.literals));
  const end = Date.now() + day;
  const view = render(lastDays(chart, end, 300), { wrapper });
  await waitFor(() => expect(runResolutions()).toEqual(["4h"]));
  // A failure after the run drew, such as a dropped connection, keeps its bars
  // and its profile.
  act(() => sink().next(snapshotOf(end - 300 * day, end)));
  act(() => sink().error(unservable()));
  await settle();
  expect(runResolutions()).toEqual(["4h"]);
  expect(drawnProfiles(chart)).toHaveLength(1);
  // Neither does a failure that isn't the provider's.
  view.rerender(lastDays(chart, end, 250));
  await waitFor(() => expect(runResolutions()).toEqual(["4h", "4h"]));
  act(() =>
    sink().error(
      new Tea.Error({ code: "invalid_data", message: "Invalid Tea response" }),
    ),
  );
  await settle();
  expect(runResolutions()).toEqual(["4h", "4h"]);
  view.unmount();
  queryClient.clear();
});

it("keeps the run and its profile while a new Feed version reloads capabilities", async () => {
  const chart = newChart("version");
  const sink = runsRangeScript();
  let reads = 0;
  let answer!: (capabilities: BarsCapabilities) => void;
  const { queryClient, wrapper, nextVersion } = providers(() =>
    ++reads === 1
      ? Promise.resolve(offered(Resolution.literals))
      : new Promise((resolve) => {
          answer = resolve;
        }),
  );
  const end = Date.now() + day;
  const view = render(lastDays(chart, end, 300), { wrapper });
  await waitFor(() => expect(runResolutions()).toEqual(["4h"]));
  act(() => sink().next(snapshotOf(end - 300 * day, end)));
  nextVersion();
  view.rerender(lastDays(chart, end, 300));
  await waitFor(() => expect(reads).toBe(2));
  expect(drawnProfiles(chart)).toHaveLength(1);
  act(() => answer(offered(Resolution.literals)));
  await settle();
  expect(runResolutions()).toEqual(["4h"]);
  expect(drawnProfiles(chart)).toHaveLength(1);
  view.unmount();
  queryClient.clear();
});

it("names the resolution the visible range's profile reads in its legend", async () => {
  const chart = newChart("legend");
  const today = Math.floor(Date.now() / day) * day;
  // The last 20 of 40 daily bars, through today's: 20 days are 1,920 15m bars
  // and 5,760 5m ones.
  showBars(
    chart,
    Array.from({ length: 40 }, (_, index) => today - (39 - index) * day),
    20,
    39,
  );
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(Resolution.literals));
  const legend = document.body.appendChild(document.createElement("div"));
  const binding = {
    id: "csr_profile",
    pane: 0,
    main: false,
    output: "volumeProfile" as const,
  };
  const view = render(
    <ChartContext.Provider value={chart}>
      <MarketSource
        input={{ id: "cms_main", series, bindings: [binding] }}
        cell={
          {
            panes: [{ id: "cpn_main", series: [{ id: binding.id }] }],
          } as unknown as CellDefinition
        }
        targets={new Map([["cpn_main", legend]])}
        localStore={createChartPreferences("legend")}
        disabled={false}
        onRemove={() => {}}
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(legend).toHaveTextContent("Visible range · 15m"));
  // The label renders before the run subscribes; wait for its observation.
  await waitFor(() => expect(sink()).toBeDefined());
  // Those bars can't be served, so the profile reads the next coarser ones.
  act(() => sink().error(unservable()));
  await waitFor(() => expect(legend).toHaveTextContent("Visible range · 30m"));
  view.unmount();
  legend.remove();
  queryClient.clear();
});

it("saves the visible range profile's settings and colors its parts in Style", async () => {
  const chart = newChart("settings");
  const today = Math.floor(Date.now() / day) * day;
  showBars(
    chart,
    Array.from({ length: 40 }, (_, index) => today - (39 - index) * day),
    20,
    39,
  );
  const sink = runsRangeScript();
  const { queryClient, wrapper } = providers(offered(Resolution.literals));
  const base = createCell(
    { provider: series.provider, listing: series.listing },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const main = base.panes[0]!;
  const source = base.marketSources[0]!;
  const profile = {
    id: chartIds.series.create(),
    role: "normal",
    source: {
      kind: "market",
      marketSourceId: source.id,
      output: "volumeProfile",
    },
  } as const;
  const cell: CellDefinition = {
    ...base,
    panes: [{ ...main, series: [...main.series, profile] }],
  };
  const saved: ChartResource = {
    // The chart the mocked grid edits.
    id: "cht_test" as ChartResource["id"],
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [cell],
    links: [],
  };
  queryClient.setQueryData(
    chartDetail({} as AppTransport, "cht_test").queryKey,
    saved,
  );
  mocks.patch.mockResolvedValue({ ...saved, revision: 2 });
  const preferences = createChartPreferences("settings");
  const legend = document.body.appendChild(document.createElement("div"));
  const user = userEvent.setup();
  const view = render(
    <ChartContext.Provider value={chart}>
      <MarketSource
        input={{
          id: source.id,
          series,
          bindings: [
            { id: profile.id, pane: 0, main: false, output: "volumeProfile" },
          ],
        }}
        cell={cell}
        targets={new Map([[main.id, legend]])}
        localStore={preferences}
        disabled={false}
        onRemove={() => {}}
      />
    </ChartContext.Provider>,
    { wrapper },
  );
  await waitFor(() => expect(legend).toHaveTextContent("Visible range · 15m"));
  await waitFor(() => expect(sink()).toBeDefined());
  act(() => sink().next(snapshotOf(today - 20 * day, today + day)));
  await user.click(
    within(legend).getByRole("button", { name: "Series settings" }),
  );
  // Inputs show the bars in use until another is chosen.
  await user.click(screen.getByRole("button", { name: "Lower timeframe" }));
  await user.click(screen.getByRole("menuitem", { name: "5m" }));
  fireEvent.change(screen.getByLabelText("Number of volume bars"), {
    target: { value: "50" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
  expect(mocks.patch.mock.calls[0]![0]).toEqual({
    id: "cht_test",
    expectedRevision: 1,
    operations: [
      {
        op: "replace",
        path: "/cells",
        value: [
          {
            ...cell,
            panes: [
              {
                ...main,
                series: [
                  ...main.series,
                  { ...profile, resolution: "5m", rows: 50 },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  // Style lists each titled part in its drawn color and saves a new one.
  await user.click(screen.getByRole("tab", { name: "Style" }));
  expect(screen.getByLabelText("Up volume")).toHaveValue("#000000");
  fireEvent.change(screen.getByLabelText("Up volume"), {
    target: { value: "#123456" },
  });
  expect(preferences.getState().series[profile.id]?.partColors).toEqual({
    "Up volume": "rgba(18, 52, 86, 1)",
  });
  view.unmount();
  legend.remove();
  queryClient.clear();
});
