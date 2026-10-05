import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { findErrorToast } from "@openchart/app/testing/test-utils";
// Purpose: Presentation changes never reopen Tea; React owns visual cleanup.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Bool,
  Field,
  Float64,
  List,
  Schema,
  Struct,
  Utf8,
  TimestampMillisecond,
} from "apache-arrow";
import { v2 } from "@openchart/chart-core";
import { ProviderId } from "@openchart/market";
import type { Primitive } from "@openchart/chart-core/primitive";
import * as Tea from "@openchart/tea";
import { fromPoints, fromRows } from "@openchart/timeseries";
import { EMPTY, Observable, of, type Subscriber } from "rxjs";
import { beforeEach, expect, it, vi } from "vitest";
import { useTea, type Node } from "@openchart/app/hooks/use-tea";
import {
  TeaVisuals,
  type TeaVisualBinding,
} from "@openchart/app/features/chart/components/tea-visuals";
import { ChartContext } from "@openchart/app/lib/chart/context";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { SeriesLegend } from "@openchart/app/features/chart/components/series-legend";
import {
  createChartPreferences,
  defaultSeriesPreferences,
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
  close: vi.fn(),
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => mocks,
}));
const node: Tea.CompileResponse = {
  id: "compiled",
  declaration: {
    kind: "indicator",
    title: "Test",
    overlay: true,
    timeframe: "",
  },
  definition: {
    parameters: [],
    inputs: new Schema([]),
    outputs: new Schema([
      new Field("value", new Float64(), true, new Map([["tea:write", "set"]])),
    ]),
    requests: {},
  },
};
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  mocks.compile.mockResolvedValue(node);
  mocks.dispose.mockResolvedValue(undefined);
});
it("restyles, moves and replaces data without replacing the execution, and removes stale visuals", async () => {
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
  const preferences = createChartPreferences("chart");
  const input: Node = {
    source: {
      entry: "study.tea",
      sources: { "study.tea": 'emit "value" close' },
    },
    parameters: {},
    ...Tea.barsInputs({
      provider: ProviderId.make("test"),
      listing: { symbol: "AAA", currency: "USD" },
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
    }),
    requests: {},
    from: 0,
    to: "now",
    countBack: 10,
    warmupBars: Tea.standardWarmupBars,
  };
  let sink!: Subscriber<Tea.Message>;
  const stop = vi.fn();
  mocks.observe.mockReturnValue(
    new Observable<Tea.Message>((subscriber) => {
      sink = subscriber;
      return stop;
    }),
  );
  function Source({ bindings }: { bindings: TeaVisualBinding[] }) {
    const tea = useTea(input);
    return (
      <ChartContext.Provider value={chart}>
        <TeaVisuals
          sourceId="indicator"
          compiled={tea.compiled}
          frame={tea.data}
          bindings={bindings}
          preferences={preferences}
        />
      </ChartContext.Provider>
    );
  }
  const binding: TeaVisualBinding = {
    id: "output",
    output: "value",
    pane: 0,
    paneId: "main",
    mainPane: true,
  };
  const queryClient = new QueryClient();
  const view = render(<Source bindings={[binding]} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(mocks.observe).toHaveBeenCalledOnce());
  act(() =>
    sink.next({
      type: "snapshot",
      config: { inputs: {}, map: {}, parameters: {}, requests: {} },
      rid: "run",
      snapshot: {
        range: { from: 0, to: 3000 },
        data: fromPoints({}, [
          { time: 1000, value: 7 },
          { time: 2000, value: 9 },
        ]),
      },
    }),
  );
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), "output")?.data,
  ).toMatchObject([
    { time: 1, value: 7 },
    { time: 2, value: 9 },
  ]);
  act(() =>
    preferences.setState({
      series: {
        output: { ...defaultSeriesPreferences, type: "Line", color: "#ff0000" },
      },
    }),
  );
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), "output")?.options,
  ).toMatchObject({ color: "#ff0000", title: "value" });
  view.rerender(<Source bindings={[binding, { ...binding, id: "second" }]} />);
  act(() =>
    preferences.setState((state) => ({
      series: {
        ...state.series,
        output: { ...state.series.output!, ownAxis: true },
        second: { ...defaultSeriesPreferences, type: "Line", ownAxis: true },
      },
    })),
  );
  for (const id of ["output", "second"])
    expect(
      v2.ChartStateModel.getSeriesObject(store.getState(), id)?.axisId,
    ).toBe("indicator:axis");
  view.rerender(
    <Source
      bindings={[{ ...binding, pane: 1, paneId: "study", mainPane: false }]}
    />,
  );
  expect(
    v2.ChartStateModel.getSeriesObject(store.getState(), "output")?.paneId,
  ).toBe(store.getState().panes[1]?.id);
  expect(mocks.observe).toHaveBeenCalledOnce();
  expect(mocks.compile).toHaveBeenCalledExactlyOnceWith(input.source);
  act(() =>
    sink.next({
      type: "updates",
      data: fromRows(fromPoints({}, [{ time: 2000, value: 1 }]).schema, [
        { time: 2000, value: null },
      ]),
    }),
  );
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), "output")?.data,
  ).toMatchObject([
    { time: 1, value: 7 },
    { time: 2, value: null },
  ]);
  // Missing output after a binding edit must not leave the last curve visible.
  view.rerender(<Source bindings={[{ ...binding, output: "removed" }]} />);
  expect(await findErrorToast("no longer exists")).toHaveTextContent(
    "no longer exists",
  );
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), "output")?.data,
  ).toBeUndefined();
  expect(mocks.observe).toHaveBeenCalledOnce();
  view.rerender(<Source bindings={[binding]} />);
  act(() =>
    chart.mutate((state) => {
      state.lockedSeriesId = "output";
    }),
  );
  view.unmount();
  expect(store.getState().lockedSeriesId).toBeUndefined();
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), "output"),
  ).toBeUndefined();
  expect(stop).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" }),
  );
});

it("keeps Tea colors and widths authoritative until explicitly overridden, then restores them", async () => {
  const store = createChartStore(v2.createState({ id: "styles" }));
  const chart: ChartRuntime = {
    id: "styles",
    store,
    renderer: {} as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const preferences = createChartPreferences("styles");
  const visualNode = {
    ...node,
    definition: {
      ...node.definition,
      outputs: new Schema([
        new Field(
          "value",
          new Struct([]),
          true,
          new Map([
            ["tea:write", "set"],
            ["tea:typeId", "visual.Plot"],
          ]),
        ),
      ]),
    },
  };
  const plotSchema = new Schema([
    new Field("time", new TimestampMillisecond(), false),
    new Field(
      "value",
      new Struct([
        new Field("series", new Float64(), true),
        new Field("title", new Utf8(), false),
        new Field(
          "color",
          new Struct(
            ["r", "g", "b", "a"].map(
              (name) => new Field(name, new Float64(), false),
            ),
          ),
          true,
        ),
        new Field("linewidth", new Float64(), false),
        new Field("style", new Utf8(), false),
        new Field("offset", new Float64(), false),
      ]),
      true,
    ),
  ]);
  const frame = (lineWidth: number) =>
    fromRows(plotSchema, [
      {
        time: 1000,
        value: {
          series: 7,
          title: "Curve",
          color: { r: 10, g: 20, b: 30, a: 128 },
          linewidth: lineWidth,
          style: "line",
          offset: 0,
        },
      },
    ]);
  const bindings = [
    { id: "output", output: "value", pane: 0, paneId: "main", mainPane: true },
  ];
  const tree = (width: number) => (
    <ChartContext.Provider value={chart}>
      <TeaVisuals
        sourceId="indicator"
        compiled={visualNode}
        frame={frame(width)}
        bindings={bindings}
        preferences={preferences}
      />
    </ChartContext.Provider>
  );
  const view = render(tree(3));
  const rendered = () =>
    v2.ChartStateUtils.getSeries(store.getState(), "output")!;
  expect(rendered().options).toMatchObject({
    title: "Curve",
    lineWidth: 3,
    color: "rgba(10, 20, 30, 0.5019607843137255)",
  });
  act(() => updateSeriesStyles(preferences, ["output"], { color: "#ff0000" }));
  expect(rendered().data[0]).toMatchObject({ color: "#ff0000" });
  view.rerender(tree(4));
  expect(rendered().options).toMatchObject({ lineWidth: 4, color: "#ff0000" });
  expect(preferences.getState().series.output).toEqual({ color: "#ff0000" });
  act(() => updateSeriesStyles(preferences, ["output"], { color: undefined }));
  expect(rendered().data[0]).toMatchObject({
    color: "rgba(10, 20, 30, 0.5019607843137255)",
  });
  expect(preferences.getState().series.output).toEqual({});
  view.unmount();
});

// These Struct fields match Tea's visual.tea outputs, including nominal metadata.
const textField = (name: string) => new Field(name, new Utf8(), false);
const numberField = (name: string) => new Field(name, new Float64(), true);
const boolField = (name: string) => new Field(name, new Bool(), false);
const colorField = (name: string) =>
  new Field(name, new Struct(["r", "g", "b", "a"].map(numberField)), true);
function visualField(name: string, type: string, fields: Field[]) {
  return new Field(
    name,
    new Struct(fields),
    true,
    new Map([
      ["tea:write", "set"],
      ["tea:typeId", `visual.${type}`],
    ]),
  );
}
const plotFields = [
  textField("id"),
  numberField("series"),
  textField("title"),
  colorField("color"),
  numberField("linewidth"),
  textField("style"),
  boolField("trackprice"),
  numberField("histbase"),
  numberField("offset"),
  boolField("editable"),
  numberField("show_last"),
  textField("display"),
  textField("format"),
  numberField("precision"),
];
const shapeFields = [
  textField("id"),
  boolField("series"),
  textField("title"),
  textField("style"),
  textField("location"),
  colorField("color"),
  numberField("offset"),
  textField("text"),
  colorField("textcolor"),
  textField("size"),
  boolField("editable"),
  numberField("show_last"),
  textField("display"),
  boolField("force_overlay"),
];
const mixedFields = [
  visualField("lower", "Plot", plotFields),
  visualField("upper", "Plot", plotFields),
  new Field("raw", new Float64(), true, new Map([["tea:write", "set"]])),
  visualField("band", "Fill", [
    textField("id"),
    textField("first"),
    textField("second"),
    colorField("color"),
    textField("title"),
    boolField("editable"),
    textField("display"),
  ]),
  visualField("local_signal", "Shape", shapeFields),
  visualField("price_signal", "Shape", shapeFields),
];
const mixedNode = {
  ...node,
  declaration: {
    kind: "indicator",
    title: "Mixed visuals",
    overlay: false,
    timeframe: "",
  },
  definition: { ...node.definition, outputs: new Schema(mixedFields) },
} satisfies Tea.CompileResponse;
const mixedSchema = new Schema([
  new Field("time", new TimestampMillisecond(), false),
  ...mixedFields,
]);
function mixedFrame(decorations = true, hiddenUpper = false) {
  const color = { r: 70, g: 170, b: 150, a: 150 };
  const plot = (id: string, value: number, style: string, offset: number) => ({
    id,
    series: value,
    title: id,
    color,
    linewidth: 2,
    style,
    trackprice: false,
    histbase: 0,
    offset,
    editable: true,
    show_last: 0,
    display: hiddenUpper && id === "upper" ? "none" : "all",
    format: "inherit",
    precision: 2,
  });
  const shape = (id: string, overlay: boolean) => ({
    id,
    series: true,
    title: "Confirmed signal",
    style: "triangleup",
    location: "belowbar",
    color,
    offset: 0,
    text: "Confirmed",
    textcolor: color,
    size: "tiny",
    editable: true,
    show_last: 0,
    display: "all",
    force_overlay: overlay,
  });
  return fromRows(
    mixedSchema,
    [1000, 2000].map((time) => ({
      time,
      lower: plot("lower", 20, "area", 0),
      upper: plot("upper", 70, "stepline", 26),
      raw: 45,
      band: decorations
        ? {
            id: "band",
            first: "lower",
            second: "upper",
            color,
            title: "Threshold band",
            editable: true,
            display: "all",
          }
        : null,
      local_signal: decorations ? shape("local_signal", false) : null,
      price_signal: decorations ? shape("price_signal", true) : null,
    })),
  );
}
function mixedBindings(owner: string): TeaVisualBinding[] {
  return mixedFields.map((field) => ({
    id: `${owner}:${field.name}`,
    output: field.name,
    pane: 1,
    paneId: "study",
    mainPane: false,
  }));
}
function visualChart(id: string) {
  const state = v2.createState({ id });
  v2.ChartStateUtils.addSeries(state, {
    id: "price",
    type: "Candlestick",
    pane: 0,
    yAxisId: "right",
  });
  v2.ChartStateModel.getSeriesObject(state, "price")!.role = "main";
  v2.ChartStateUtils.setSeriesData(state, "price", [
    { time: 1, open: 40, high: 50, low: 35, close: 45 },
    { time: 2, open: 45, high: 55, low: 40, close: 50 },
  ]);
  const store = createChartStore(state);
  const contributions = new Map<
    string,
    Map<string, readonly Primitive.SeriesPrimitive[]>
  >();
  const setSeriesPrimitives = vi.fn(
    (
      target: string,
      owner: string,
      primitives: readonly Primitive.SeriesPrimitive[],
    ) => {
      const owners =
        contributions.get(target) ??
        new Map<string, readonly Primitive.SeriesPrimitive[]>();
      if (primitives.length) owners.set(owner, primitives);
      else owners.delete(owner);
      contributions.set(target, owners);
    },
  );
  const canvas = document.createElement("canvas");
  const chart: ChartRuntime = {
    id,
    store,
    renderer: {
      canvas,
      setSeriesPrimitives,
      primitiveAt: vi.fn(),
    } as unknown as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((draft) => {
        recipe(draft);
      }, true),
  };
  return { chart, contributions, setSeriesPrimitives };
}

it("projects mixed nominal visuals without creating scalar series for shapes or fills, and replaces their owned contributions", () => {
  const { chart, contributions, setSeriesPrimitives } = visualChart("mixed");
  const preferences = createChartPreferences("mixed");
  const bindings = mixedBindings("study-a");
  const tree = (frame = mixedFrame()) => (
    <ChartContext.Provider value={chart}>
      <TeaVisuals
        sourceId="study-a"
        compiled={mixedNode}
        frame={frame}
        bindings={bindings}
        preferences={preferences}
      />
    </ChartContext.Provider>
  );
  const view = render(tree());
  const seriesIds = Object.values(chart.store.getState().objects)
    .filter((object) => object.kind === "series")
    .map((object) => object.id)
    .sort();
  expect(seriesIds).toEqual([
    "price",
    "study-a:lower",
    "study-a:raw",
    "study-a:upper",
  ]);
  expect(
    contributions
      .get("study-a:lower")
      ?.get("study-a")
      ?.map((primitive) => primitive.id),
  ).toEqual([
    "study-a:study-a:band:false",
    "study-a:study-a:local_signal:false",
  ]);
  expect(
    contributions
      .get("price")
      ?.get("study-a")
      ?.map((primitive) => primitive.id),
  ).toEqual(["study-a:study-a:price_signal:true"]);
  expect(
    v2.ChartStateUtils.getSeries(chart.store.getState(), "study-a:lower")?.type,
  ).toBe("Area");
  expect(
    v2.ChartStateUtils.getSeries(chart.store.getState(), "study-a:upper")
      ?.options,
  ).toMatchObject({ xOffset: 26, lineType: "step" });
  expect(
    v2.ChartStateUtils.getSeries(chart.store.getState(), "study-a:upper")?.data,
  ).toMatchObject([
    { time: 1, value: 70 },
    { time: 2, value: 70 },
  ]);
  const first = contributions.get("price")?.get("study-a");
  view.rerender(tree(mixedFrame(false)));
  expect(contributions.get("price")?.has("study-a")).toBe(false);
  expect(contributions.get("study-a:lower")?.has("study-a")).toBe(false);
  expect(setSeriesPrimitives).toHaveBeenCalledWith("price", "study-a", []);
  view.rerender(tree());
  expect(contributions.get("price")?.get("study-a")).not.toBe(first);
  view.unmount();
  expect(contributions.get("price")?.has("study-a")).toBe(false);
  expect(contributions.get("study-a:lower")?.has("study-a")).toBe(false);
  expect(
    v2.ChartStateUtils.getSeries(chart.store.getState(), "price"),
  ).toBeDefined();
  expect(mocks.compile).not.toHaveBeenCalled();
  expect(mocks.observe).not.toHaveBeenCalled();
});

it("removing one indicator clears only its own decorations on the shared price series", () => {
  const { chart, contributions, setSeriesPrimitives } = visualChart("owners");
  const preferences = createChartPreferences("owners");
  const frame = mixedFrame();
  const a = mixedBindings("study-a"),
    b = mixedBindings("study-b");
  const tree = (includeA: boolean) => (
    <ChartContext.Provider value={chart}>
      {includeA ? (
        <TeaVisuals
          key="a"
          sourceId="study-a"
          compiled={mixedNode}
          frame={frame}
          bindings={a}
          preferences={preferences}
        />
      ) : null}
      <TeaVisuals
        key="b"
        sourceId="study-b"
        compiled={mixedNode}
        frame={frame}
        bindings={b}
        preferences={preferences}
      />
    </ChartContext.Provider>
  );
  const view = render(tree(true));
  expect([...contributions.get("price")!.keys()].sort()).toEqual([
    "study-a",
    "study-b",
  ]);
  const retained = contributions.get("price")!.get("study-b");
  setSeriesPrimitives.mockClear();
  view.rerender(tree(false));
  expect(contributions.get("price")!.has("study-a")).toBe(false);
  expect(contributions.get("price")!.get("study-b")).toBe(retained);
  expect(setSeriesPrimitives).toHaveBeenCalledWith("price", "study-a", []);
  expect(setSeriesPrimitives).not.toHaveBeenCalledWith("price", "study-b", []);
  view.unmount();
  expect(contributions.get("price")!.size).toBe(0);
});

it("source Hide then Show restores an authored hidden fill anchor without restarting Tea", async () => {
  const { chart, contributions } = visualChart("hidden-anchor");
  const preferences = createChartPreferences("hidden-anchor");
  const bindings = mixedBindings("study-a");
  const frame = mixedFrame(true, true);
  const seriesIds = bindings.slice(0, 3).map(({ id }) => id);
  const visibilityIds = bindings.map(({ id }) => id);
  const input: Node = {
    source: { entry: "cloud.tea", sources: { "cloud.tea": "cloud source" } },
    parameters: {},
    ...Tea.barsInputs({
      provider: ProviderId.make("test"),
      listing: { symbol: "AAA", currency: "USD" },
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
    }),
    requests: {},
    from: 0,
    to: 3000,
    countBack: 2,
    warmupBars: 0,
  };
  mocks.compile.mockResolvedValue(mixedNode);
  mocks.observe.mockReturnValue(
    of({
      type: "snapshot",
      rid: "run",
      snapshot: { range: { from: 0, to: 3000 }, data: frame },
    }),
  );
  function Source() {
    const execution = useTea(input);
    return (
      <ChartContext.Provider value={chart}>
        <TeaVisuals
          sourceId="study-a"
          compiled={execution.compiled}
          frame={execution.data}
          bindings={bindings}
          preferences={preferences}
        />
        <SeriesLegend
          sourceId="study-a"
          seriesIds={seriesIds}
          visibilityIds={visibilityIds}
          order={0}
          localStore={preferences}
          disabled={false}
          describe={() => ({ title: "Cloud", content: "Study values" })}
        />
      </ChartContext.Provider>
    );
  }
  const queryClient = new QueryClient();
  const view = render(
    <TooltipProvider>
      <Source />
    </TooltipProvider>,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  const upper = () =>
    v2.ChartStateUtils.getSeries(chart.store.getState(), "study-a:upper");
  const lower = () =>
    v2.ChartStateUtils.getSeries(chart.store.getState(), "study-a:lower");
  const band = () =>
    contributions
      .get("study-a:lower")
      ?.get("study-a")
      ?.some((primitive) => primitive.id === "study-a:study-a:band:false");
  await waitFor(() => expect(upper()?.options.visible).toBe(false));
  expect(lower()?.options.visible).toBe(true);
  expect(band()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Hide series" }));
  expect(lower()?.options.visible).toBe(false);
  expect(band()).toBeUndefined();
  expect(contributions.get("price")?.has("study-a")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Show series" }));
  expect(upper()?.options.visible).toBe(false);
  expect(lower()?.options.visible).toBe(true);
  expect(band()).toBe(true);
  expect(contributions.get("price")?.has("study-a")).toBe(true);
  expect(
    preferences.getState().series["study-a:upper"]?.visible,
  ).toBeUndefined();
  expect(mocks.compile).toHaveBeenCalledOnce();
  expect(mocks.observe).toHaveBeenCalledOnce();
  view.unmount();
});

it("draws the last profile written for each box start and follows visibility", () => {
  const store = createChartStore(v2.createState({ id: "profiles" }));
  const chart: ChartRuntime = {
    id: "profiles",
    store,
    renderer: {} as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const preferences = createChartPreferences("profiles");
  const color = new Struct(
    ["r", "g", "b", "a"].map((name) => new Field(name, new Float64(), false)),
  );
  const list = (fields: Field[]) =>
    new List(new Field("item", new Struct(fields), true));
  const profileType = new Struct([
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
  ]);
  const visualNode = {
    ...node,
    definition: {
      ...node.definition,
      outputs: new Schema([
        new Field(
          "profile",
          new Struct([]),
          true,
          new Map([
            ["tea:write", "set"],
            ["tea:typeId", "visual.VerticalProfile"],
          ]),
        ),
      ]),
    },
  };
  const teal = { r: 0, g: 128, b: 128, a: 255 };
  const written = (from: number, time: number, volume: number) => ({
    time,
    profile: {
      from,
      to: time + 60_000,
      rows: [
        {
          low: 9,
          high: 10,
          segments: [{ value: volume, color: teal, title: "Up volume" }],
        },
      ],
      levels: [{ y: 9.5, color: null, title: "Point of control" }],
      display: "all",
    },
  });
  const frame = fromRows(
    new Schema([
      new Field("time", new TimestampMillisecond(), false),
      new Field("profile", profileType, true),
    ]),
    [written(0, 0, 1), written(0, 60_000, 2), written(120_000, 120_000, 5)],
  );
  const view = render(
    <ChartContext.Provider value={chart}>
      <TeaVisuals
        sourceId="indicator"
        compiled={visualNode}
        frame={frame}
        bindings={[
          {
            id: "output",
            output: "profile",
            pane: 0,
            paneId: "main",
            mainPane: true,
          },
        ]}
        preferences={preferences}
      />
    </ChartContext.Provider>,
  );
  const profiles = () =>
    Object.values(store.getState().objects).flatMap((object) =>
      object.kind === "vertical-profile" ? [object] : [],
    );
  expect(
    profiles().map(({ axisId, paneId, profile }) => ({
      axisId,
      paneId,
      profile,
    })),
  ).toEqual([
    {
      axisId: "right",
      paneId: v2.ChartStateModel.MAIN_PANE_ID,
      profile: {
        box: { kind: "time", from: 0, to: 120 },
        rows: [
          {
            low: 9,
            high: 10,
            segments: [
              { value: 2, color: "rgba(0, 128, 128, 1)", title: "Up volume" },
            ],
          },
        ],
        levels: [
          {
            y: 9.5,
            color: "rgba(120, 123, 134, 0.5)",
            title: "Point of control",
          },
        ],
        visible: true,
      },
    },
    expect.objectContaining({
      profile: expect.objectContaining({
        box: { kind: "time", from: 120, to: 180 },
      }),
    }),
  ]);
  // Style colors repaint each profile's titled parts.
  act(() =>
    updateSeriesStyles(preferences, ["output"], {
      partColors: { "Point of control": "#ffa500" },
    }),
  );
  expect(profiles().map(({ profile }) => profile.levels[0]!.color)).toEqual([
    "#ffa500",
    "#ffa500",
  ]);
  // Hidden profiles stay placed, so Style still lists their parts.
  act(() => updateSeriesStyles(preferences, ["output"], { visible: false }));
  expect(profiles().map(({ profile }) => profile.visible)).toEqual([
    false,
    false,
  ]);
  act(() => updateSeriesStyles(preferences, ["output"], { visible: true }));
  expect(profiles().map(({ profile }) => profile.visible)).toEqual([
    true,
    true,
  ]);
  view.unmount();
  expect(profiles()).toEqual([]);
  expect(() =>
    v2.ChartStateModel.assertModelReady(store.getState()),
  ).not.toThrow();
});

it("shows each chart bar the last row that opened inside it", () => {
  const store = createChartStore(v2.createState({ id: "finer" }));
  const chart: ChartRuntime = {
    id: "finer",
    store,
    renderer: {} as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const day = 86_400_000,
    hour = 3_600_000;
  chart.mutate((state) => {
    v2.ChartStateUtils.addSeries(state, {
      id: "price",
      type: "Line",
      fieldMap: { x: "time", value: "close" },
      data: [0, day, 2 * day].map((time) => ({ time: time / 1000, close: 1 })),
    });
    v2.ChartStateModel.getSeriesObject(state, "price")!.role = "main";
  });
  // Hourly rows, as from a script with `timeframe = "auto"` on a daily
  // chart; the second day has none.
  const frame = fromPoints({}, [
    { time: 0, value: 1 },
    { time: 23 * hour, value: 2 },
    { time: 2 * day, value: 3 },
    { time: 2 * day + hour, value: 4 },
  ]);
  const view = render(
    <ChartContext.Provider value={chart}>
      <TeaVisuals
        sourceId="indicator"
        compiled={node}
        frame={frame}
        bindings={[
          {
            id: "output",
            output: "value",
            pane: 0,
            paneId: "main",
            mainPane: true,
          },
        ]}
        preferences={createChartPreferences("finer")}
      />
    </ChartContext.Provider>,
  );
  expect(
    v2.ChartStateUtils.getSeries(store.getState(), "output")?.data,
  ).toMatchObject([
    { time: 0, value: 2 },
    { time: day / 1000, value: NaN },
    { time: (2 * day) / 1000, value: 4 },
  ]);
  view.unmount();
});
