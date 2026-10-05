// Purpose: One indicator legend aggregates every output, including outputs in other panes.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Field, Float64, Schema, Struct } from "apache-arrow";
import { v2 } from "@openchart/chart-core";
import { barsSeries, type Resolution } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { ProviderId } from "@openchart/market";
import { fromPoints } from "@openchart/timeseries";
import { EMPTY } from "rxjs";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  createCell,
  chartIds,
  type CellDefinition,
  type IndicatorResource,
} from "@openchart/app/features/chart/api/queries";
import { ChartMenus } from "@openchart/app/features/chart/components/menus";
import {
  moveSeries,
  removeSeries,
} from "@openchart/app/features/chart/utils/resource";
import { IndicatorSource } from "@openchart/app/features/chart/components/sources/indicator";
import { ChartContext } from "@openchart/app/lib/chart/context";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import {
  WorkspaceFileNavigation,
  workspaceQueryKeys,
} from "@openchart/app/lib/workspace/workspace";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
const mocks = vi.hoisted(() => ({
  tea: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  reload: vi.fn(),
  remove: vi.fn(),
  snapshot: vi.fn(),
}));
// Execution is stubbed; the live file still reads through the real useTeaSource.
vi.mock("@openchart/app/hooks/use-tea", async (original) => ({
  ...(await original<typeof import("@openchart/app/hooks/use-tea")>()),
  useTea: mocks.tea,
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => mocks,
}));
// This test seeds native readouts directly; projection has its own integration tests.
vi.mock("@openchart/app/features/chart/components/tea-visuals", () => ({
  TeaVisuals: () => null,
}));
vi.mock("@openchart/app/hooks/use-chart-grid", () => ({
  useChartGrid: () => ({
    chartId: "cht_test",
    transport: {
      rpc: {
        resources: {
          chart: { get: { query: mocks.get } },
          indicator: {
            patch: { mutate: mocks.patch },
            reload: { mutate: mocks.reload },
          },
          macro: { removeIndicator: { mutate: mocks.remove } },
        },
      },
    },
  }),
}));

it("shows colored crosshair values in one row, toggles all outputs, edits each output, opens its code, and saves, reloads and removes the Indicator", async () => {
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const user = userEvent.setup();
  const base = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAA", currency: "USD" },
    },
    {
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
    },
  );
  // Workspace identities are server-branded; the wire value is a plain string.
  let indicator = {
    id: "ind_bands",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_test",
    cellId: base.id,
    source: { workspaceId: "wsp_test", path: "bands.tea" },
    snapshot: { "bands.tea": "bands" },
    parameterOverrides: {},
  } as unknown as IndicatorResource;
  // Outputs name the Indicator by value; one was moved to its own pane.
  const bindings = ["basis", "upper", "lower"].map((output) => ({
    id: chartIds.series.create(),
    role: "normal" as const,
    source: { kind: "indicator" as const, indicatorId: indicator.id, output },
  }));
  const [basis, upper, lower] = bindings;
  let cell: CellDefinition = {
    ...base,
    panes: [
      { ...base.panes[0]!, series: [...base.panes[0]!.series, basis!, lower!] },
      { id: chartIds.pane.make("cpn_study"), series: [upper!] },
    ],
  };
  const store = createChartStore(v2.createState({ id: "legend" }));
  const chart: ChartRuntime = {
    id: "legend",
    store,
    renderer: { canvas: document.createElement("canvas") } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const colors = ["#0000ff", "#00ff00", "#ffff00"];
  chart.mutate((state) =>
    bindings.forEach((binding, i) => {
      v2.ChartStateUtils.addSeries(state, {
        id: binding.id,
        type: "Line",
        pane: i === 1 ? 1 : 0,
        options: { color: colors[i], lineWidth: i === 0 ? 2.5 : 1 },
        fieldMap: { x: "time", value: "value" },
      });
      v2.ChartStateUtils.setSeriesData(state, binding.id, [
        {
          time: 1,
          value: 10 + i,
          title: ["Basis", "Upper", "Lower"][i],
          color: i === 2 ? "#ff8800" : colors[i],
        },
        {
          time: 2,
          value: 20 + i,
          title: ["Basis", "Upper", "Lower"][i],
          color: colors[i],
        },
      ]);
    }),
  );
  mocks.tea.mockReturnValue({
    status: "ready",
    compiled: {
      declaration: {
        kind: "indicator",
        title: "Bollinger Bands",
        overlay: true,
        timeframe: "",
      },
      definition: {
        requests: {},
        parameters: [
          {
            name: "source",
            title: "Source",
            type: "source",
            defaultValue: "close",
          },
          {
            name: "show",
            title: "Show bands",
            type: "bool",
            defaultValue: true,
          },
          { name: "length", title: "Length", type: "int", defaultValue: 20 },
        ],
        outputs: new Schema(
          ["basis", "upper", "lower"].map(
            (name) =>
              new Field(
                name,
                new Float64(),
                true,
                new Map([["tea:write", "set"]]),
              ),
          ),
        ),
      },
    },
  });
  const preferences = createChartPreferences("legend");
  const alertable = new Map<string, ReadonlySet<string>>();
  const main = document.createElement("div"),
    study = document.createElement("div");
  document.body.append(main, study);
  const targets = new Map([
    [cell.panes[0]!.id, main],
    [cell.panes[1]!.id, study],
  ]);
  const queryClient = new QueryClient();
  mocks.snapshot.mockResolvedValue({
    entry: "bands.tea",
    sources: { "bands.tea": "bands" },
  });
  mocks.get.mockResolvedValue({
    id: "cht_test",
    revision: 1,
    cells: [cell],
    links: [],
    preset: "single",
  });
  mocks.patch.mockImplementation(async () => ({
    ...indicator,
    revision: 2,
    parameterOverrides: { length: 25, source: "open" },
  }));
  mocks.reload.mockImplementation(async () => indicator);
  mocks.remove.mockResolvedValue({
    chart: { id: "cht_test", revision: 2, cells: [], links: [] },
  });
  const onMove = vi.fn((id: string, paneId: string) => {
    cell = moveSeries(cell, id, paneId);
  });
  const openFile = vi.fn();
  const tree = (navigation: typeof openFile | null = openFile) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceFileNavigation.Provider value={navigation}>
        <TooltipProvider>
          <ChartContext.Provider value={chart}>
            <ChartMenus
              cell={cell}
              localStore={preferences}
              onMove={onMove}
              onRemove={vi.fn()}
            />
            <IndicatorSource
              indicator={indicator}
              cell={cell}
              targets={targets}
              localStore={preferences}
              disabled={false}
              alertable={alertable}
            />
          </ChartContext.Provider>
        </TooltipProvider>
      </WorkspaceFileNavigation.Provider>
    </QueryClientProvider>
  );
  const view = render(tree());
  try {
    const legend = screen.getByRole("group", {
      name: "Bollinger Bands legend",
    });
    expect(
      within(legend).queryByRole("button", {
        name: "Inputs for Bollinger Bands",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(legend).getAllByRole("button", {
        name: "Series settings",
      }),
    ).toHaveLength(1);
    expect(
      within(legend).getByRole("button", { name: "Series placement" }),
    ).toBeInTheDocument();
    expect(main).toContainElement(legend);
    expect(study).toBeEmptyDOMElement();
    expect(
      within(
        within(legend).getByRole("toolbar", {
          name: "Bollinger Bands actions",
        }),
      )
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Reload Bollinger Bands",
      "Remove Bollinger Bands",
      "Hide series",
      "Series settings",
      "Open code",
      "Series placement",
    ]);
    // The live source file opens; the chart keeps running its snapshot.
    await user.click(within(legend).getByRole("button", { name: "Open code" }));
    expect(openFile).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "wsp_test",
      path: "bands.tea",
    });
    view.rerender(tree(null));
    expect(
      within(legend).queryByRole("button", { name: "Open code" }),
    ).not.toBeInTheDocument();
    view.rerender(tree());
    expect(
      screen.queryByRole("group", { name: "Upper legend" }),
    ).not.toBeInTheDocument();
    expect(within(legend).getAllByRole("group")).toHaveLength(3);
    // Alerts may read every numeric output of the compiled Indicator.
    expect(alertable.get(indicator.id)).toEqual(
      new Set(["basis", "upper", "lower"]),
    );
    expect(
      within(legend).getByRole("group", { name: "Basis: 20" }),
    ).toBeInTheDocument();
    const lowerValue = within(legend).getByRole("group", { name: "Lower: 22" });
    expect(
      within(lowerValue).getByTestId("indicator-output-color"),
    ).toHaveStyle({ background: "#ffff00" });
    act(() =>
      chart.mutate((state) => {
        state.crosshair.visible = true;
        state.crosshair.logicalIndex = 0;
      }),
    );
    expect(
      within(
        within(legend).getByRole("group", { name: "Lower: 12" }),
      ).getByTestId("indicator-output-color"),
    ).toHaveStyle({ background: "#ff8800" });
    fireEvent.click(
      within(legend).getByRole("button", { name: "Hide series" }),
    );
    for (const binding of bindings)
      expect(preferences.getState().series[binding.id]?.visible).toBe(false);
    fireEvent.click(
      within(legend).getByRole("button", { name: "Show series" }),
    );
    for (const binding of bindings)
      expect(
        preferences.getState().series[binding.id]?.visible,
      ).toBeUndefined();
    await user.click(
      within(legend).getByRole("button", { name: "Series settings" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Series settings" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Source" }));
    await user.click(screen.getByRole("menuitem", { name: "open" }));
    expect(mocks.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("switch", { name: "Show bands" }));
    expect(
      screen.getByRole("switch", { name: "Show bands" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Reset Show bands" }));
    expect(screen.getByRole("switch", { name: "Show bands" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Length"), {
      target: { value: "25" },
    });
    await user.click(screen.getByRole("tab", { name: "Style" }));
    expect(screen.getByLabelText("Basis")).toHaveValue("#0000ff");
    expect(screen.getByLabelText("Upper")).toHaveValue("#00ff00");
    expect(screen.getByLabelText("Lower")).toHaveValue("#ffff00");
    expect(screen.getByLabelText("Line width")).toHaveValue(2.5);
    fireEvent.change(screen.getByLabelText("Upper"), {
      target: { value: "#123456" },
    });
    expect(preferences.getState().series[upper!.id]).toEqual({
      color: "#123456",
    });
    await user.click(screen.getByRole("button", { name: "Reset Upper color" }));
    expect(screen.getByLabelText("Upper")).toHaveValue("#00ff00");
    expect(preferences.getState().series[upper!.id]).toEqual({});
    await user.click(screen.getByRole("button", { name: "Output" }));
    await user.click(screen.getByRole("menuitem", { name: "Lower" }));
    fireEvent.change(screen.getByLabelText("Line width"), {
      target: { value: "3" },
    });
    expect(preferences.getState().series[lower!.id]?.lineWidth).toBe(3);
    expect(preferences.getState().series[basis!.id]?.lineWidth).not.toBe(3);
    await user.click(screen.getByRole("tab", { name: "Inputs" }));
    expect(screen.getByLabelText("Length")).toHaveValue(25);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({
        id: indicator.id,
        expectedRevision: 1,
        operations: [
          {
            op: "replace",
            path: "/parameterOverrides",
            value: { length: 25, source: "open" },
          },
        ],
      }),
    );
    await user.keyboard("{Escape}");
    await user.click(
      within(legend).getByRole("button", { name: "Series placement" }),
    );
    expect(screen.getByText("Indicator placement")).toBeInTheDocument();
    const moveAxis = screen.getByRole("menuitem", { name: "Move axis to" });
    act(() => moveAxis.focus());
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "Left" }));
    for (const binding of bindings)
      expect(preferences.getState().series[binding.id]?.ownAxis).toBe(true);
    expect(preferences.getState().axes[`${indicator.id}:axis`]?.side).toBe(
      "left",
    );
    await user.click(
      within(legend).getByRole("button", { name: "Series placement" }),
    );
    const movePane = screen.getByRole("menuitem", { name: "Move to pane" });
    act(() => movePane.focus());
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "New pane" }));
    expect(onMove).toHaveBeenCalledWith(basis!.id, "new");
    expect(
      cell.panes
        .at(-1)!
        .series.map((series) => series.id)
        .sort(),
    ).toEqual(bindings.map((series) => series.id).sort());
    // One-output indicators expose the same placement menu.
    cell = cell.panes
      .flatMap((pane) => pane.series)
      .filter(
        (series) =>
          series.source.kind === "indicator" && series.id !== basis!.id,
      )
      .reduce((current, series) => removeSeries(current, series.id), cell);
    view.rerender(tree());
    expect(
      within(legend).getByRole("button", { name: "Series placement" }),
    ).toBeInTheDocument();
    // An attachment with no render bindings still has one place to show errors/actions.
    cell = cell.panes
      .flatMap((pane) => pane.series)
      .filter((series) => series.source.kind === "indicator")
      .reduce((current, series) => removeSeries(current, series.id), cell);
    view.rerender(tree());
    expect(
      screen.getAllByRole("group", { name: "Bollinger Bands legend" }),
    ).toHaveLength(1);
    await user.click(
      within(legend).getByRole("button", {
        name: "Series settings",
      }),
    );
    expect(screen.getByLabelText("Length")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Style" })).toBeDisabled();
    await user.keyboard("{Escape}");
    // The saved Indicator arrives at a new revision: Tea re-observes its same snapshot, Reload expects it.
    indicator = await mocks.patch.mock.results[0]!.value;
    view.rerender(tree());
    expect(mocks.tea).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: { entry: "bands.tea", sources: { "bands.tea": "bands" } },
        parameters: { length: 25, source: "open" },
        warmupBars: Tea.standardWarmupBars,
      }),
    );
    await user.click(
      within(legend).getByRole("button", { name: "Reload Bollinger Bands" }),
    );
    await waitFor(() =>
      expect(mocks.reload).toHaveBeenCalledExactlyOnceWith({
        id: indicator.id,
        expectedRevision: 2,
      }),
    );
    const remove = within(legend).getByRole("button", {
      name: "Remove Bollinger Bands",
    });
    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);
    // Removal is one chart macro against the cached chart revision.
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
        chartId: "cht_test",
        expectedRevision: 1,
        indicatorId: indicator.id,
      }),
    );
  } finally {
    view.unmount();
    main.remove();
    study.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
  }
});

it("marks Reload while the Indicator's file or an import differs from its snapshot", async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const user = userEvent.setup();
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAA", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const saved = { "bands.tea": 'import "lib.tea"', "lib.tea": "v1" };
  let indicator = {
    id: "ind_bands",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_test",
    cellId: cell.id,
    source: { workspaceId: "wsp_test", path: "bands.tea" },
    snapshot: saved,
    parameterOverrides: {},
  } as unknown as IndicatorResource;
  mocks.tea.mockReturnValue({
    status: "ready",
    compiled: {
      declaration: { title: "Bands" },
      definition: { requests: {}, parameters: [], outputs: new Schema([]) },
    },
  });
  const store = createChartStore(v2.createState({ id: "changed" }));
  const chart: ChartRuntime = {
    id: "changed",
    store,
    renderer: { canvas: document.createElement("canvas") } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const preferences = createChartPreferences("changed");
  const main = document.createElement("div");
  document.body.append(main);
  const targets = new Map([[cell.panes[0]!.id, main]]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Workspace changes refetch the live file the way the SSE subscription does.
  const serve = async (files: Record<string, string> | Error) => {
    mocks.snapshot.mockImplementation(async () => {
      if (files instanceof Error) throw files;
      return { entry: "bands.tea", sources: files };
    });
    await act(() =>
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.all }),
    );
  };
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChartContext.Provider value={chart}>
          <IndicatorSource
            indicator={indicator}
            cell={cell}
            targets={targets}
            localStore={preferences}
            disabled={false}
            alertable={new Map()}
          />
        </ChartContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  mocks.snapshot.mockResolvedValue({ entry: "bands.tea", sources: saved });
  const view = render(tree());
  try {
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(
      { workspaceId: "wsp_test", path: "bands.tea" },
      expect.anything(),
    );
    expect(
      screen.getByRole("button", { name: "Reload Bands" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("indicator-file-changed"),
    ).not.toBeInTheDocument();
    // An edited import changes what Reload would snapshot.
    const edited = { ...saved, "lib.tea": "v2" };
    await serve(edited);
    const changed = await screen.findByRole("button", {
      name: "Reload Bands to apply its changed file",
    });
    expect(within(changed).getByTestId("indicator-file-changed")).toBeVisible();
    // A missing file keeps its own error surfaces instead of the marker.
    await serve(new Error("compile_failed"));
    await screen.findByRole("button", { name: "Reload Bands" });
    await serve(edited);
    await user.click(
      await screen.findByRole("button", {
        name: "Reload Bands to apply its changed file",
      }),
    );
    await waitFor(() =>
      expect(mocks.reload).toHaveBeenCalledExactlyOnceWith({
        id: "ind_bands",
        expectedRevision: 1,
      }),
    );
    indicator = { ...indicator, revision: 2, snapshot: edited };
    view.rerender(tree());
    expect(
      screen.getByRole("button", { name: "Reload Bands" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("indicator-file-changed"),
    ).not.toBeInTheDocument();
  } finally {
    view.unmount();
    main.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
  }
});

it("read-only legends keep values without actions, settings or menus", async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAA", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const indicator = {
    id: "ind_view",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_test",
    cellId: cell.id,
    source: { workspaceId: "wsp_test", path: "bands.tea" },
    snapshot: { "bands.tea": "v1" },
    parameterOverrides: {},
  } as unknown as IndicatorResource;
  mocks.tea.mockReturnValue({
    status: "ready",
    compiled: {
      declaration: { title: "Bands" },
      definition: { requests: {}, parameters: [], outputs: new Schema([]) },
    },
  });
  mocks.snapshot.mockResolvedValue({
    entry: "bands.tea",
    sources: { "bands.tea": "v1" },
  });
  const store = createChartStore(v2.createState({ id: "view" }));
  const chart: ChartRuntime = {
    id: "view",
    store,
    renderer: { canvas: document.createElement("canvas") } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const main = document.createElement("div");
  document.body.append(main);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChartContext.Provider value={chart}>
          <IndicatorSource
            indicator={indicator}
            cell={cell}
            targets={new Map([[cell.panes[0]!.id, main]])}
            localStore={createChartPreferences("view")}
            disabled={false}
            readOnly
            alertable={new Map()}
          />
        </ChartContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  try {
    const legend = await screen.findByRole("group", { name: "Bands legend" });
    expect(within(legend).getByLabelText("Bands prices")).toBeVisible();
    expect(within(legend).getByText("Bands")).toBeVisible();
    expect(within(legend).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(legend).queryByRole("toolbar", { name: "Bands actions" }),
    ).not.toBeInTheDocument();
  } finally {
    view.unmount();
    main.remove();
    queryClient.clear();
  }
});

it("places an Indicator that only draws profiles by its binding, after the price", async () => {
  vi.clearAllMocks();
  const base = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAA", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const indicator = {
    id: "ind_profile",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_test",
    cellId: base.id,
    source: { workspaceId: "wsp_test", path: "profile.tea" },
    snapshot: { "profile.tea": "v1" },
    parameterOverrides: {},
  } as unknown as IndicatorResource;
  // After the price and volume bindings, as adding an Indicator places it.
  const cell: CellDefinition = {
    ...base,
    panes: [
      {
        ...base.panes[0]!,
        series: [
          ...base.panes[0]!.series,
          {
            id: chartIds.series.create(),
            role: "normal",
            source: {
              kind: "indicator",
              indicatorId: indicator.id,
              output: "profile",
            },
          },
        ],
      },
    ],
  };
  mocks.tea.mockReturnValue({
    status: "ready",
    compiled: {
      declaration: { title: "Profile" },
      definition: {
        requests: {},
        parameters: [],
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
    },
  });
  mocks.snapshot.mockResolvedValue({
    entry: "profile.tea",
    sources: { "profile.tea": "v1" },
  });
  const store = createChartStore(v2.createState({ id: "profile" }));
  const chart: ChartRuntime = {
    id: "profile",
    store,
    renderer: { canvas: document.createElement("canvas") } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const main = document.createElement("div");
  document.body.append(main);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChartContext.Provider value={chart}>
          <IndicatorSource
            indicator={indicator}
            cell={cell}
            targets={new Map([[cell.panes[0]!.id, main]])}
            localStore={createChartPreferences("profile")}
            disabled={false}
            readOnly
            alertable={new Map()}
          />
        </ChartContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  try {
    const legend = await screen.findByRole("group", {
      name: "Profile legend",
    });
    // The legend's ordered wrapper has no accessible role.
    // eslint-disable-next-line testing-library/no-node-access
    expect(legend.parentElement).toHaveStyle({ order: "2" });
  } finally {
    view.unmount();
    main.remove();
    queryClient.clear();
  }
});

it("names the data a script reads beyond the chart's own bars", async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const market = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAA", currency: "USD" },
  };
  const settings = { session: "regular", adjustment: "raw" } as const;
  const cell = createCell(market, { resolution: "1h", ...settings });
  const indicator = {
    id: "ind_reads",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_test",
    cellId: cell.id,
    source: { workspaceId: "wsp_test", path: "profile.tea" },
    snapshot: { "profile.tea": "v1" },
    parameterOverrides: {},
  } as unknown as IndicatorResource;
  const child = (
    listing: typeof market.listing,
    resolution: string,
  ): Tea.NodeConfig =>
    ({
      inputs: {
        bars: {
          _tag: "Bars",
          provider: market.provider,
          listing,
          resolution,
          ...settings,
          schema: Tea.barsSchema,
        },
      },
      map: {},
      parameters: {},
      requests: {},
    }) as unknown as Tea.NodeConfig;
  mocks.tea.mockReturnValue({
    status: "ready",
    compiled: {
      declaration: { title: "Profile" },
      definition: { requests: {}, parameters: [], outputs: new Schema([]) },
    },
    config: {
      inputs: {},
      map: {},
      parameters: {},
      requests: {
        period: child(market.listing, "1d"),
        lower: child(market.listing, "1h"),
        other: child({ symbol: "BBB", currency: "USD" }, "1d"),
        ref: {
          ...child(market.listing, "1d"),
          inputs: { node: { _tag: "NodeRef" } },
        },
      },
    },
  });
  mocks.snapshot.mockResolvedValue({
    entry: "profile.tea",
    sources: { "profile.tea": "v1" },
  });
  const store = createChartStore(v2.createState({ id: "reads" }));
  const chart: ChartRuntime = {
    id: "reads",
    store,
    renderer: { canvas: document.createElement("canvas") } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const main = document.createElement("div");
  document.body.append(main);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChartContext.Provider value={chart}>
          <IndicatorSource
            indicator={indicator}
            cell={cell}
            targets={new Map([[cell.panes[0]!.id, main]])}
            localStore={createChartPreferences("reads")}
            disabled={false}
            readOnly
            alertable={new Map()}
          />
        </ChartContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  try {
    const legend = await screen.findByRole("group", {
      name: "Profile legend",
    });
    expect(
      within(legend).getByLabelText("Also reads 1d, BBB 1d data"),
    ).toHaveTextContent("1d · BBB 1d");
  } finally {
    view.unmount();
    main.remove();
    queryClient.clear();
  }
});

it("names finer bars an auto script runs on first, and from when its rows start", async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const market = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAA", currency: "USD" },
  };
  const settings = { session: "regular", adjustment: "raw" } as const;
  const cell = createCell(market, { resolution: "1d", ...settings });
  const indicator = {
    id: "ind_auto",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_test",
    cellId: cell.id,
    source: { workspaceId: "wsp_test", path: "profile.tea" },
    snapshot: { "profile.tea": "v1" },
    parameterOverrides: {},
  } as unknown as IndicatorResource;
  const bars = (resolution: Resolution): Tea.NodeConfig => ({
    ...Tea.barsInputs(barsSeries(market, { resolution, ...settings })),
    parameters: {},
    requests: {},
  });
  // The config a run reads: the root and its `""` request read the bars it
  // runs on. The chart's first bar spans 1 Jan 2024; the rows start at 20:00
  // UTC on 2 Mar, which is 3 Mar in the chart's Tokyo time.
  const execution = (run: Resolution, start = Date.UTC(2024, 2, 2, 20)) => ({
    status: "ready",
    compiled: {
      declaration: { title: "Profile" },
      definition: { requests: {}, parameters: [], outputs: new Schema([]) },
    },
    config: {
      ...bars(run),
      requests: { period: bars("1M"), same: bars(run) },
    },
    data: fromPoints({}, [{ time: start, value: 1 }]),
  });
  mocks.tea.mockReturnValue(execution("1h"));
  mocks.snapshot.mockResolvedValue({
    entry: "profile.tea",
    sources: { "profile.tea": "v1" },
  });
  const store = createChartStore(v2.createState({ id: "auto" }));
  const chart: ChartRuntime = {
    id: "auto",
    store,
    renderer: { canvas: document.createElement("canvas") } as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  chart.mutate((state) => {
    v2.ChartStateUtils.addSeries(state, {
      id: "price",
      type: "Line",
      fieldMap: { x: "time", value: "close" },
      data: [1, 2].map((day) => ({
        time: Date.UTC(2024, 0, day) / 1000,
        close: 10,
      })),
    });
    v2.ChartStateModel.getSeriesObject(state, "price")!.role = "main";
    state.display = "Asia/Tokyo";
  });
  const main = document.createElement("div");
  document.body.append(main);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const preferences = createChartPreferences("auto");
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChartContext.Provider value={chart}>
          <IndicatorSource
            indicator={indicator}
            cell={cell}
            targets={new Map([[cell.panes[0]!.id, main]])}
            localStore={preferences}
            disabled={false}
            readOnly
            alertable={new Map()}
          />
        </ChartContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  try {
    const legend = await screen.findByRole("group", {
      name: "Profile legend",
    });
    expect(
      within(legend).getByLabelText("Also reads 1h, 1M data"),
    ).toHaveTextContent("1h · 1M");
    expect(
      within(legend).getByText(/^from (3 Mar|Mar 3,) 2024$/),
    ).toBeVisible();
    // Finer bars that only start inside the chart's first bar, where the
    // market's data begins, cut nothing.
    mocks.tea.mockReturnValue(execution("1h", Date.UTC(2024, 0, 1, 4)));
    view.rerender(tree());
    expect(
      within(legend).getByLabelText("Also reads 1h, 1M data"),
    ).toBeVisible();
    expect(within(legend).queryByText(/^from /)).not.toBeInTheDocument();
    // Run again on the chart's bars, as when Feed can't serve finer ones: no
    // finer bars to name, and no start to explain.
    mocks.tea.mockReturnValue(execution("1d"));
    view.rerender(tree());
    expect(within(legend).getByLabelText("Also reads 1M data")).toBeVisible();
    expect(within(legend).queryByText(/^from /)).not.toBeInTheDocument();
  } finally {
    view.unmount();
    main.remove();
    queryClient.clear();
  }
});
