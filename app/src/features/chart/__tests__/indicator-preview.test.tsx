// Purpose: Cached real bars stay finite: viewing, input edits and pan/zoom cannot open Feed.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Field, Float64, Schema } from "apache-arrow";
import { Observable, Subject, type Subscriber } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { v2 } from "@openchart/chart-core";
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { fromPoints } from "@openchart/timeseries";
import type { IndicatorExample } from "@openchart/app/features/chart/api/indicator-examples";
import { IndicatorPreview } from "@openchart/app/features/chart/components/indicator-preview";
import { ChartContext } from "@openchart/app/lib/chart/context";
import type { ChartCoreProps } from "@openchart/app/lib/chart/core";
import {
  createChartStore,
  type ChartOutput,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

const mocks = vi.hoisted(() => ({
  tea: {
    url: "test",
    compile: vi.fn(),
    snapshot: vi.fn(),
    observe: vi.fn(),
    dispose: vi.fn(),
  },
  feed: vi.fn(() => {
    throw new Error("Historical previews must not acquire Feed");
  }),
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => mocks.tea,
}));
vi.mock("@openchart/app/hooks/use-datafeed", () => ({
  useDatafeed: mocks.feed,
  useFeedVersion: mocks.feed,
}));
vi.mock("@openchart/app/lib/chart/core", () => ({
  ChartCore: ({ id, children }: ChartCoreProps) => {
    const [chart] = useState(() => makeRuntime(id));
    return (
      <ChartContext.Provider value={chart}>{children}</ChartContext.Provider>
    );
  },
}));

const runtimes: (ChartRuntime & { output$: Subject<ChartOutput> })[] = [];
function makeRuntime(id: string) {
  const store = createChartStore(v2.createState({ id }));
  const chart = {
    id,
    store,
    renderer: {
      canvas: document.createElement("canvas"),
      setSeriesPrimitives: vi.fn(),
      primitiveAt: vi.fn(() => null),
    } as unknown as v2.ChartRenderer,
    output$: new Subject<ChartOutput>(),
    mutate: (recipe: Parameters<ChartRuntime["mutate"]>[0]) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  runtimes.push(chart);
  return chart;
}
const source = { workspaceId: "wsp_test", path: "study.tea" };
const start = Date.parse("2024-01-01T00:00:00Z");
const day = 86400000;
const row = (time: number, close: number) => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 123,
});
const daily: Omit<IndicatorExample, "history"> = {
  id: "btcusdt-1d",
  series: {
    provider: ProviderId.make("binance"),
    listing: { symbol: "BTCUSDT", currency: "USDT" },
    resolution: "1d",
    session: "24h",
    adjustment: "raw",
  },
  rows: [row(start - day, 41000), row(start, 42000), row(start + day, 43000)],
  from: start,
  to: start + 2 * day,
  provenance: {
    sourceUrl: "https://test.invalid/history",
    sourceUrls: ["https://test.invalid/history"],
    retrievedAt: "2026-10-03T00:00:00Z",
    requestedRange: { from: start - day, to: start + 2 * day },
    firstBarTime: start - day,
    lastBarTime: start + day,
    rowCount: 3,
    sha256: "0".repeat(64),
  },
};
// The same market's weeks, which request.security lines read.
const weekly: Omit<IndicatorExample, "history"> = {
  ...daily,
  id: "btcusdt-1W",
  series: { ...daily.series, resolution: "1W" },
  rows: [row(start - day, 41000)],
};
const example: IndicatorExample = { ...daily, history: [weekly] };
const compilation: Tea.CompileResponse = {
  id: "compiled",
  declaration: {
    kind: "indicator",
    title: "Study",
    overlay: true,
    timeframe: "",
  },
  definition: {
    parameters: [
      {
        name: "length",
        title: "Length",
        type: "int",
        control: "input.int",
        defaultValue: 14,
        active: null,
        constraints: null,
        enumType: null,
        group: null,
        inline: null,
        tooltip: null,
        confirm: false,
        display: "all",
        seriesSid: null,
      },
    ],
    inputs: Tea.barsSchema,
    outputs: new Schema([
      new Field("value", new Float64(), true, new Map([["tea:write", "set"]])),
    ]),
    requests: {},
  },
};
let studies: {
  request: Tea.ObserveRequest;
  sink: Subscriber<Tea.Message>;
  stop: ReturnType<typeof vi.fn>;
}[];
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  studies = [];
  runtimes.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.tea.snapshot.mockResolvedValue({
    entry: source.path,
    sources: { [source.path]: 'emit "value" close' },
  });
  mocks.tea.compile.mockResolvedValue(compilation);
  mocks.tea.dispose.mockResolvedValue(undefined);
  mocks.tea.observe.mockImplementation(
    (request: Tea.ObserveRequest) =>
      new Observable((sink: Subscriber<Tea.Message>) => {
        const stop = vi.fn();
        studies.push({ request, sink, stop });
        return stop;
      }),
  );
});
afterEach(() => {
  expect(mocks.feed).not.toHaveBeenCalled();
  client.clear();
});

function preview(props: Partial<Parameters<typeof IndicatorPreview>[0]> = {}) {
  return (
    <QueryClientProvider client={client}>
      <IndicatorPreview source={source} example={example} {...props} />
    </QueryClientProvider>
  );
}
function emitStudy(index: number, value: number) {
  studies[index]!.sink.next({
    type: "snapshot",
    rid: "run",
    config: { inputs: {}, map: {}, parameters: {}, requests: {} },
    snapshot: {
      range: { from: example.from, to: example.to },
      data: fromPoints({}, [
        { time: start, value },
        { time: start + day, value: value + 1 },
      ]),
    },
  });
}
function data(id: string) {
  return v2.ChartStateUtils.getSeries(runtimes.at(-1)!.store.getState(), id)
    ?.data;
}

it("supplies cached warmup while rendering only the fixed historical range, without Feed", async () => {
  const view = render(preview());
  await waitFor(() => expect(studies).toHaveLength(1));
  // The run reads only supplied history: the example's days, and its weeks
  // for request.security lines.
  expect(studies[0]!.request).toMatchObject({
    from: example.from,
    to: example.to,
    countBack: 2,
    inputs: {
      bars: { _tag: "Samples", ...example.series, rows: example.rows },
    },
    samples: [{ _tag: "Samples", ...weekly.series, rows: weekly.rows }],
  });
  expect(data("preview-price")).toMatchObject([
    { time: start / 1000, close: 42000 },
    { time: (start + day) / 1000, close: 43000 },
  ]);
  expect(screen.queryByRole("caption")).not.toBeInTheDocument();
  expect(screen.getByRole("figure")).not.toHaveTextContent(
    /Historical|binance|BTCUSDT|2024/,
  );
  expect(runtimes[0]!.renderer.canvas).toHaveAttribute(
    "aria-label",
    "Study preview",
  );
  expect(
    v2.ChartStateUtils.getSeries(runtimes[0]!.store.getState(), "preview-price")
      ?.options.title,
  ).toBe("");
  act(() => emitStudy(0, 41500));
  expect(data("preview-output-0")).toMatchObject([
    { value: 41500 },
    { value: 41501 },
  ]);
  for (const id of ["preview-price", "preview-output-0"])
    expect(
      v2.ChartStateUtils.getSeries(runtimes[0]!.store.getState(), id)?.options,
    ).toMatchObject({ lastValueVisible: false, valueLineVisible: false });
  view.rerender(preview({ interactive: true }));
  for (const id of ["preview-price", "preview-output-0"])
    expect(
      v2.ChartStateUtils.getSeries(runtimes[0]!.store.getState(), id)?.options,
    ).toMatchObject({ lastValueVisible: true, valueLineVisible: true });
  expect(mocks.tea.compile).toHaveBeenCalledOnce();
  expect(studies).toHaveLength(1);
  view.unmount();
  expect(studies[0]!.stop).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(mocks.tea.dispose).toHaveBeenCalledWith({ id: "compiled" }),
  );
});

it("pan and zoom cannot expand the calculation window; input edits recompute the same supplied rows", async () => {
  const view = render(preview({ interactive: true }));
  await waitFor(() => expect(studies).toHaveLength(1));
  act(() => {
    emitStudy(0, 41500);
    runtimes[0]!.output$.next({ type: "range", from: -1000, to: 1000 });
  });
  expect(studies).toHaveLength(1);
  view.rerender(preview({ interactive: true, parameters: { length: 21 } }));
  await waitFor(() => expect(studies).toHaveLength(2));
  expect(studies[1]!.request).toMatchObject({
    from: example.from,
    to: example.to,
    countBack: 2,
    parameters: { length: 21 },
    inputs: { bars: { _tag: "Samples", rows: example.rows } },
  });
  expect(studies[0]!.stop).toHaveBeenCalledOnce();
  expect(mocks.tea.compile).toHaveBeenCalledOnce();
  expect(data("preview-output-0")).toEqual([]);
  expect(data("preview-price")).toHaveLength(2);
  expect(runtimes[0]!.renderer.canvas.tabIndex).toBe(0);
});

it("replaces an example without retaining the previous market's study or late results", async () => {
  const view = render(preview());
  await waitFor(() => expect(studies).toHaveLength(1));
  act(() => emitStudy(0, 41500));
  const other: IndicatorExample = {
    ...example,
    id: "aapl-1d",
    series: {
      ...example.series,
      provider: ProviderId.make("yfinance"),
      listing: { symbol: "AAPL", currency: "USD" },
      session: "regular",
      adjustment: "split",
    },
    rows: [row(start - day, 2200), row(start, 2300), row(start + day, 2400)],
  };
  view.rerender(preview({ example: other }));
  await waitFor(() => expect(studies).toHaveLength(2));
  expect(studies[0]!.stop).toHaveBeenCalledOnce();
  act(() => emitStudy(0, 99999));
  expect(data("preview-price")).toMatchObject([
    { close: 2300 },
    { close: 2400 },
  ]);
  expect(data("preview-output-0")).toEqual([]);
  expect(studies[1]!.request.inputs).toMatchObject({
    bars: { _tag: "Samples", ...other.series, rows: other.rows },
  });
  expect(screen.getByRole("figure")).not.toHaveTextContent(
    /Historical|yfinance|AAPL/,
  );
  act(() => emitStudy(1, 2290));
  expect(data("preview-output-0")).toMatchObject([
    { value: 2290 },
    { value: 2291 },
  ]);
});

it("runs a study with requests on the example's history alone, showing what the service refuses", async () => {
  mocks.tea.compile.mockResolvedValue({
    ...compilation,
    definition: {
      ...compilation.definition,
      requests: { hourly: { ...compilation.definition, target: null } },
    },
  });
  render(preview({ interactive: true }));
  await waitFor(() => expect(studies).toHaveLength(1));
  // The service fills request children from these Samples or refuses them;
  // it never reads Feed for this run.
  expect(studies[0]!.request.samples).toEqual([
    {
      _tag: "Samples",
      ...weekly.series,
      schema: Tea.barsSchema,
      rows: weekly.rows,
    },
  ]);
  act(() =>
    studies[0]!.sink.error(
      new Tea.Error({
        code: "invalid_request",
        message: "hourly: the supplied history has no BTCUSDT 1h bars.",
      }),
    ),
  );
  expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  expect(data("preview-output-0")).toEqual([]);
});

it("retries a failed finite execution and does not manufacture indicator output", async () => {
  render(preview({ interactive: true }));
  await waitFor(() => expect(studies).toHaveLength(1));
  act(() => studies[0]!.sink.error(new Error("Execution failed")));
  expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  expect(data("preview-output-0")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(studies).toHaveLength(2));
  expect(studies[1]!.request.to).toBe(example.to);
});

it("does not execute when the example has only warmup and no displayed bars", () => {
  render(preview({ example: { ...example, rows: [example.rows[0]!] } }));
  expect(screen.getByText("No preview data available")).toBeInTheDocument();
  expect(mocks.tea.compile).not.toHaveBeenCalled();
  expect(mocks.tea.observe).not.toHaveBeenCalled();
});

it("bounds a curated scenario before later prices and signals while retaining cached warmup", async () => {
  render(preview({ endTime: start + day }));
  await waitFor(() => expect(studies).toHaveLength(1));
  expect(studies[0]!.request).toMatchObject({
    from: start,
    to: start + day,
    countBack: 1,
    inputs: { bars: { _tag: "Samples", rows: example.rows } },
  });
  expect(data("preview-price")).toMatchObject([
    { time: start / 1000, close: 42000 },
  ]);
  expect(data("preview-price")).toHaveLength(1);
});
