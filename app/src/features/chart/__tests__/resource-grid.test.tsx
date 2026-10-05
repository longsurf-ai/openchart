// Purpose: Verify consumer-local Resource subscriptions preserve cell runtimes and binding identities.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
  type AssistantClient,
} from "@assistant-ui/react";
import { v2 } from "@openchart/chart-core";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, StrictMode, useState, type RefObject } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  chartDetail,
  createCell,
  indicatorList,
  type CellDefinition,
  type ChartResource,
  type IndicatorResource,
} from "@openchart/app/features/chart/api/queries";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { ChartGrid } from "@openchart/app/features/chart/components/grid";
import { ChartToolbar } from "@openchart/app/features/chart/components/toolbar";
import { updateCell } from "@openchart/app/features/chart/utils/resource";
import type { MarketSeriesInput } from "@openchart/app/hooks/use-market-series-source";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import {
  createChartPreferences,
  type ChartPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const mocks = vi.hoisted(() => ({
  inputs: new Map<string, MarketSeriesInput>(),
  preferences: new Map<string, ChartPreferencesStore>(),
  sourceViews: [] as Array<{
    kind: "market" | "indicator";
    resolution: CellDefinition["resolution"];
    viewport: ChartPreferences["viewport"];
  }>,
  renderers: [] as Array<{ id: string; dispose: ReturnType<typeof vi.fn> }>,
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
        const id = config.getState().id;
        mocks.renderers.push({ id, dispose });
        return {
          canvas,
          id,
          dispose,
          render: vi.fn(),
          scheduleResize: vi.fn(),
          setSuspended: vi.fn(),
        };
      },
    },
  };
});
vi.mock("@openchart/app/features/chart/components/sources/market", () => ({
  MarketSource: ({
    input,
    cell,
    localStore,
  }: {
    input: MarketSeriesInput;
    cell: CellDefinition;
    localStore: ChartPreferencesStore;
  }) => {
    mocks.inputs.set(input.id, input);
    mocks.preferences.set(cell.id, localStore);
    mocks.sourceViews.push({
      kind: "market",
      resolution: cell.resolution,
      viewport: localStore.getState().viewport,
    });
    return (
      <span>
        {input.series.listing.symbol} / {input.series.resolution}
      </span>
    );
  },
}));
vi.mock("@openchart/app/features/chart/components/menus", () => ({
  ChartMenus: () => null,
}));
vi.mock("@openchart/app/hooks/use-bars", () => ({
  useBarsCapabilities: () => ({
    data: [
      {
        resolution: "1d",
        session: "regular",
        adjustment: "raw",
        modes: ["history", "delayed"],
      },
    ],
  }),
}));
vi.mock("@openchart/app/features/chart/components/sources/drawings", () => ({
  DrawingSource: () => null,
}));
vi.mock("@openchart/app/features/chart/components/sources/indicator", () => ({
  IndicatorSource: ({
    indicator,
    cell,
    localStore,
  }: {
    indicator: IndicatorResource;
    cell: CellDefinition;
    localStore: ChartPreferencesStore;
  }) => {
    mocks.sourceViews.push({
      kind: "indicator",
      resolution: cell.resolution,
      viewport: localStore.getState().viewport,
    });
    return <span>{indicator.id}</span>;
  },
}));

beforeEach(() => {
  localStorage.clear();
  mocks.inputs.clear();
  mocks.preferences.clear();
  mocks.sourceViews.length = 0;
  mocks.renderers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 600, height: 400 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (key: string) =>
      key === "--background" ? "#ffffff" : "#168863",
  }));
});
afterEach(() => vi.unstubAllGlobals());

function TestGrid({
  resource,
  transport,
  auiRef,
}: {
  resource: ChartResource;
  transport: AppTransport;
  auiRef?: RefObject<AssistantClient>;
}) {
  const [focusedCells, setFocusedCells] = useState<Record<string, string>>({});
  const context = AuiConfig({ modelContext: ModelContextClient() });
  return (
    <AuiProvider config={context} ref={auiRef}>
      <ChartSelectionContext.Provider
        value={{
          activeChartId: resource.id,
          focusedCells,
          focus: (chartId, cellId) => setFocusedCells({ [chartId]: cellId }),
        }}
      >
        <ChartGridProvider chartId={resource.id} transport={transport}>
          <TooltipProvider delayDuration={0}>
            <ChartToolbar />
            <ChartGrid />
          </TooltipProvider>
        </ChartGridProvider>
      </ChartSelectionContext.Provider>
    </AuiProvider>
  );
}

it("clears historical viewport before either source sees a changed resolution, while preserving the renderer and preferences", async () => {
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const historical = { from: Date.UTC(2020, 3, 7), to: Date.UTC(2024, 10, 25) };
  createChartPreferences(cell.id).setState({
    viewport: historical,
    barSpacing: 9,
    rightOffset: 12,
    paneHeights: [300, 100],
  });
  const resource: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [cell],
    links: [],
  };
  const transport = {} as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = chartDetail(transport, resource.id).queryKey;
  client.setQueryData(key, resource);
  client.setQueryData(indicatorList(transport, resource.id).queryKey, [
    { id: "ind_rsi", cellId: cell.id },
  ] as IndicatorResource[]);
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <TestGrid resource={resource} transport={transport} />
      </QueryClientProvider>
    </StrictMode>,
  );
  await screen.findByText("AAPL / 1d");
  expect(
    mocks.sourceViews.every(
      ({ viewport }) => viewport?.from === historical.from,
    ),
  ).toBe(true);
  const preferences = mocks.preferences.get(cell.id)!;
  const renderCount = mocks.renderers.length;
  const changeResolution = async (resolution: CellDefinition["resolution"]) => {
    mocks.sourceViews.length = 0;
    await act(() =>
      client.setQueryData<ChartResource>(key, (current) =>
        updateCell(current!, cell.id, (cell) => ({ ...cell, resolution })),
      ),
    );
    await screen.findByText(`AAPL / ${resolution}`);
    expect(new Set(mocks.sourceViews.map(({ kind }) => kind))).toEqual(
      new Set(["market", "indicator"]),
    );
    expect(
      mocks.sourceViews.every(
        (source) =>
          source.resolution === resolution && source.viewport === null,
      ),
    ).toBe(true);
    expect(mocks.preferences.get(cell.id)).toBe(preferences);
    expect(preferences.getState()).toMatchObject({
      viewport: null,
      barSpacing: 9,
      rightOffset: 12,
      paneHeights: [300, 100],
    });
    expect(mocks.renderers).toHaveLength(renderCount);
  };
  await changeResolution("1m");
  // Panning within this interval remains historical; unrelated Resource edits do not reset it.
  act(() => preferences.setState({ viewport: historical }));
  await act(() =>
    client.setQueryData<ChartResource>(key, (current) => ({
      ...current!,
      revision: current!.revision + 1,
    })),
  );
  expect(preferences.getState().viewport).toEqual(historical);
  await changeResolution("1d");
  view.unmount();
  client.clear();
});

it("reads visible cells from one Query cache without rebuilding runtimes or unchanged bindings", async () => {
  const cells = ["AAPL", "MSFT", "GOOG"].map((symbol) =>
    createCell(
      {
        provider: ProviderId.make("test"),
        listing: { symbol, currency: "USD" },
      },
      { resolution: "1d", session: "regular", adjustment: "raw" },
    ),
  );
  const resource: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1x2",
    cells,
    links: [],
  };
  const get = vi.fn();
  const transport = {
    rpc: { resources: { chart: { get: { query: get } } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = chartDetail(transport, resource.id).queryKey;
  client.setQueryData(key, resource);
  // Each cell mounts only its own Indicators; one outside every cell never mounts.
  client.setQueryData(indicatorList(transport, resource.id).queryKey, [
    { id: "ind_aapl", cellId: cells[0]!.id },
    { id: "ind_stray", cellId: "ccl_gone" },
  ] as IndicatorResource[]);
  const aui = createRef<AssistantClient>();
  const readContext = () => aui.current!.modelContext.getModelContext().system;
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <TestGrid resource={resource} transport={transport} auiRef={aui} />
      </QueryClientProvider>
    </StrictMode>,
  );
  await screen.findByText("AAPL / 1d");
  expect(screen.getByText("MSFT / 1d")).toBeVisible();
  expect(screen.getAllByText("ind_aapl")).toHaveLength(1);
  expect(screen.queryByText("ind_stray")).not.toBeInTheDocument();
  expect(screen.queryByText("GOOG / 1d")).not.toBeInTheDocument();
  expect(readContext()).toContain(`"chartId":"${resource.id}"`);
  expect(readContext()).toContain('"symbol":"AAPL"');
  expect(readContext()).toContain('"symbol":"MSFT"');
  expect(readContext()).not.toContain('"symbol":"GOOG"');
  const mounted = mocks.renderers.filter(
    (renderer) => !renderer.dispose.mock.calls.length,
  );
  expect(mounted.map((renderer) => renderer.id)).toEqual(
    cells.slice(0, 2).map((cell) => cell.id),
  );
  const renderCount = mocks.renderers.length;
  const firstInput = mocks.inputs.get(cells[0]!.marketSources[0]!.id)!;
  const secondInput = mocks.inputs.get(cells[1]!.marketSources[0]!.id)!;

  const user = userEvent.setup();
  expect(
    screen.queryByRole("button", { name: "Chart view" }),
  ).not.toBeInTheDocument();
  const controls = within(
    screen.getByRole("toolbar", { name: "Chart controls" }),
  );
  expect(controls.getAllByRole("button")).toEqual([
    controls.getByRole("button", { name: "Compare symbol" }),
    controls.getByRole("button", { name: "Interval 1d" }),
    controls.getByRole("button", { name: "Chart type Candlestick" }),
  ]);
  expect(controls.queryByRole("separator")).not.toBeInTheDocument();
  for (const [name, label] of [
    ["Interval 1d", "Interval: 1d"],
    ["Chart type Candlestick", "Chart type: Candlestick"],
    ["Compare symbol", "Compare symbol"],
    ["Grid 1 × 2", "Chart grid"],
  ]) {
    const button = screen.getByRole("button", { name });
    expect(button).not.toHaveAttribute("title");
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label!);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  }
  const maximizeButtons = screen.getAllByRole("button", {
    name: "Maximize chart",
  });
  expect(maximizeButtons).toHaveLength(2);
  await user.click(maximizeButtons[1]!);
  expect(JSON.parse(readContext()!)).toMatchObject({
    view: "chart",
    chartId: resource.id,
    cellId: cells[1]!.id,
    focused: true,
    listing: { symbol: "MSFT", currency: "USD" },
    resolution: "1d",
    session: "regular",
    adjustment: "raw",
  });
  expect(screen.getByRole("button", { name: "Restore chart" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(client.getQueryData(key)).toEqual(resource);
  expect(mocks.inputs.get(firstInput.id)).toBe(firstInput);
  expect(mocks.inputs.get(secondInput.id)).toBe(secondInput);
  await user.keyboard("{Enter}");
  expect(readContext()).toContain('"symbol":"AAPL"');
  expect(
    screen.queryByRole("button", { name: "Restore chart" }),
  ).not.toBeInTheDocument();

  await act(() =>
    client.setQueryData(
      key,
      updateCell(resource, cells[1]!.id, (cell) => ({
        ...cell,
        resolution: "1m",
      })),
    ),
  );
  await screen.findByText("MSFT / 1m");
  expect(readContext()).toContain('"resolution":"1m"');
  expect(mocks.inputs.get(firstInput.id)).toBe(firstInput);
  expect(mocks.inputs.get(secondInput.id)).not.toBe(secondInput);
  expect(mocks.renderers).toHaveLength(renderCount);
  expect(mounted.every((renderer) => !renderer.dispose.mock.calls.length)).toBe(
    true,
  );

  await act(() =>
    client.setQueryData<ChartResource>(key, (current) => ({
      ...current!,
      preset: "1x3",
    })),
  );
  await screen.findByText("GOOG / 1d");
  expect(readContext()).toContain('"symbol":"GOOG"');
  expect(mocks.inputs.get(firstInput.id)).toBe(firstInput);
  expect(mounted.every((renderer) => !renderer.dispose.mock.calls.length)).toBe(
    true,
  );
  expect(get).not.toHaveBeenCalled();
  view.unmount();
  await waitFor(() =>
    expect(
      mocks.renderers.every(
        (renderer) => renderer.dispose.mock.calls.length === 1,
      ),
    ).toBe(true),
  );
  client.clear();
});

it("places volume from its own submenu in one save per choice and keeps its binding", async () => {
  const cell = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "MSFT", currency: "USD" },
    },
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  let resource: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [cell],
    links: [],
  };
  const patch = vi.fn<
    AppTransport["rpc"]["resources"]["chart"]["patch"]["mutate"]
  >(async (input) => {
    for (const operation of input.operations) {
      if (operation.op !== "replace") throw new Error("Expected replacement");
      resource = { ...resource, [operation.path.slice(1)]: operation.value };
    }
    resource = { ...resource, revision: resource.revision + 1 };
    return resource;
  });
  const transport = {
    rpc: { resources: { chart: { patch: { mutate: patch } } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(chartDetail(transport, resource.id).queryKey, resource);
  const view = render(
    <QueryClientProvider client={client}>
      <TestGrid resource={resource} transport={transport} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const openMenu = () =>
    user.click(screen.getByRole("button", { name: /^Chart type / }));
  // jsdom has no geometry for Radix's pointer path into a submenu; use the keyboard.
  const openVolume = async () => {
    act(() => screen.getByRole("menuitem", { name: "Volume" }).focus());
    await user.keyboard("{ArrowRight}");
    return within(await screen.findByRole("menu", { name: "Volume" }));
  };
  const choose = async (name: string, saves: number) => {
    await openMenu();
    const item = (await openVolume()).getByRole("menuitemradio", { name });
    act(() => item.focus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(patch).toHaveBeenCalledTimes(saves);
  };
  const volumes = () =>
    resource.cells[0]!.panes.map((pane) =>
      pane.series
        .filter(
          ({ source }) =>
            source.kind === "market" && source.output === "volume",
        )
        .map((series) => series.id),
    );
  const volumeId = volumes()[0]![0]!;
  await screen.findByText("MSFT / 1d");

  // A new chart overlays volume with the profile off, and placement stays out of the top menu.
  await openMenu();
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Volume Profile" }),
  ).not.toBeChecked();
  expect(
    screen.queryByRole("menuitemradio", { name: "Separate pane" }),
  ).not.toBeInTheDocument();
  expect(
    (await openVolume())
      .getAllByRole("menuitemradio")
      .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
  ).toEqual([
    ["Off", "false"],
    ["Separate pane", "false"],
    ["Overlay on price", "true"],
  ]);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );

  await choose("Separate pane", 1);
  expect(volumes()).toEqual([[], [volumeId]]);
  // Choosing the current placement again saves nothing and keeps its pane.
  await choose("Separate pane", 1);
  await choose("Off", 2);
  expect(volumes()).toEqual([[]]);
  // From off, a separate pane takes one save.
  await choose("Separate pane", 3);
  expect(volumes()).toEqual([[], [expect.any(String)]]);
  view.unmount();
  client.clear();
});

it("fills a selected preset in one save and preserves cells when shrinking and restoring", async () => {
  let resource: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [
      createCell(
        {
          provider: ProviderId.make("test"),
          listing: { symbol: "MSFT", currency: "USD" },
        },
        { resolution: "1h", session: "regular", adjustment: "raw" },
      ),
    ],
    links: [],
  };
  const patch = vi.fn<
    AppTransport["rpc"]["resources"]["chart"]["patch"]["mutate"]
  >(async (input) => {
    expect(input.expectedRevision).toBe(resource.revision);
    for (const operation of input.operations) {
      if (operation.op !== "replace") throw new Error("Expected replacement");
      resource = { ...resource, [operation.path.slice(1)]: operation.value };
    }
    resource = { ...resource, revision: resource.revision + 1 };
    return resource;
  });
  const transport = {
    rpc: { resources: { chart: { patch: { mutate: patch } } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(chartDetail(transport, resource.id).queryKey, resource);
  const view = render(
    <QueryClientProvider client={client}>
      <TestGrid resource={resource} transport={transport} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const choose = async (name: string) => {
    await user.click(screen.getByRole("button", { name: /^Grid / }));
    await user.click(screen.getByRole("menuitemradio", { name }));
  };
  await screen.findByText("MSFT / 1h");
  expect(
    screen.queryByRole("button", { name: "Maximize chart" }),
  ).not.toBeInTheDocument();
  const firstRenderer = mocks.renderers[0]!;
  await choose("2 × 2");
  await waitFor(() => expect(screen.getAllByText("MSFT / 1h")).toHaveLength(4));
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch.mock.calls[0]![0].operations.map((op) => op.path)).toEqual([
    "/cells",
    "/links",
    "/preset",
  ]);
  const ids = resource.cells.map((cell) => cell.id);
  expect(new Set(ids).size).toBe(4);
  expect(firstRenderer.dispose).not.toHaveBeenCalled();

  await user.click(
    screen.getAllByRole("button", { name: "Maximize chart" })[3]!,
  );
  expect(screen.getByRole("button", { name: "Restore chart" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await choose("Single chart");
  await waitFor(() => expect(screen.getAllByText("MSFT / 1h")).toHaveLength(1));
  expect(resource.cells.map((cell) => cell.id)).toEqual(ids);
  await choose("2 × 2");
  await waitFor(() => expect(screen.getAllByText("MSFT / 1h")).toHaveLength(4));
  expect(
    screen.queryByRole("button", { name: "Restore chart" }),
  ).not.toBeInTheDocument();
  expect(resource.cells.map((cell) => cell.id)).toEqual(ids);
  expect(firstRenderer.dispose).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});
