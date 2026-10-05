// Purpose: Discovery never attaches a study; explicit actions retain file identity, parameter choices and the captured chart target.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useEffect, useState } from "react";
import type * as Tea from "@openchart/tea";
import { Field, Float64, Schema } from "apache-arrow";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndicatorLibraryContent } from "@openchart/app/features/chart/components/indicator-picker";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const mocks = vi.hoisted(() => ({
  url: "test",
  compile: vi.fn(),
  snapshot: vi.fn(),
  dispose: vi.fn(),
  previewStart: vi.fn(),
  previewStop: vi.fn(),
  /** The values a detail preview's run reports it bound. */
  resolved: undefined as Tea.ParameterOverrides | undefined,
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => mocks,
}));
vi.mock("@openchart/app/features/chart/components/indicator-preview", () => ({
  IndicatorPreview: ({
    source,
    parameters,
    interactive,
    onResolved,
  }: {
    source: Tea.WorkspaceSources;
    parameters?: Tea.ParameterOverrides;
    interactive?: boolean;
    onResolved?: (parameters: Tea.ParameterOverrides | undefined) => void;
  }) => {
    useEffect(() => {
      mocks.previewStart(source.path);
      return () => mocks.previewStop(source.path);
    }, [source.workspaceId, source.path]);
    useEffect(() => onResolved?.(mocks.resolved), [onResolved]);
    return interactive ? (
      <output data-testid="study-preview">
        {JSON.stringify(parameters ?? {})}
      </output>
    ) : (
      <div data-testid="card-preview" data-source={source.path} />
    );
  },
}));

type CatalogEntry = Awaited<
  ReturnType<AppTransport["rpc"]["indicators"]["list"]["query"]>
>[number];
const catalog: CatalogEntry[] = [
  {
    id: "sma",
    path: "indicators/builtin/sma.tea",
    name: "SMA",
    category: "Trend",
    goals: ["follow-trends"],
    discovery: { rank: 30, headline: "Smooth recent price changes" },
    prompt:
      "Plot a 14-period simple moving average of close on the price chart.",
    description: "Follow an equally weighted average of recent prices.",
  },
  {
    id: "rsi",
    path: "indicators/builtin/rsi.tea",
    name: "RSI",
    category: "Momentum",
    goals: ["find-reversals"],
    discovery: { rank: 40, headline: "Compare recent gains and losses" },
    prompt: "Plot a 14-period relative strength oscillator in a separate pane.",
    description: "Compare the balance between recent gains and losses.",
  },
  {
    id: "atr",
    path: "indicators/builtin/atr.tea",
    name: "ATR",
    category: "Volatility",
    goals: ["understand-volatility"],
    discovery: { rank: 50, headline: "Understand the typical trading range" },
    prompt: "Plot a 14-period Average True Range in a separate pane.",
    description: "Understand changes in typical range size, including gaps.",
  },
  {
    id: "supertrend-regime",
    path: "indicators/builtin/supertrend-regime.tea",
    name: "Supertrend Regime",
    category: "Trend",
    goals: ["follow-trends"],
    discovery: { rank: 10, headline: "Follow a changing trend" },
    prompt: "Plot a Supertrend line and highlight its changes in direction.",
    description: "Follow an adaptive trailing line around price.",
  },
  {
    id: "double-ema",
    path: "indicators/builtin/double-ema.tea",
    name: "DEMA",
    category: "Trend",
    goals: ["follow-trends"],
    discovery: { rank: 20, headline: "Compare a faster moving average" },
    prompt: "Plot a double exponential moving average of closing prices.",
    description: "Use two exponential averages to reduce lag.",
  },
  {
    id: "ema",
    path: "indicators/builtin/ema.tea",
    name: "EMA",
    category: "Trend",
    goals: ["follow-trends"],
    prompt: "Plot an exponential moving average of closing prices.",
    description: "Smooth closing prices with greater weight on recent bars.",
  },
];
const lengthParameter: Tea.Parameter = {
  name: "length",
  title: "Length",
  type: "int",
  control: "input.int",
  defaultValue: 14,
  active: null,
  constraints: { kind: "range", minval: 1, maxval: 500, step: null },
  enumType: null,
  group: null,
  inline: null,
  tooltip: null,
  confirm: false,
  display: "all",
  seriesSid: null,
};
function compiled(title = "Saved average"): Tea.CompileResponse {
  return {
    id: "node",
    declaration: { kind: "indicator", title, overlay: true, timeframe: "" },
    definition: {
      parameters: [lengthParameter],
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
  };
}

const clients: QueryClient[] = [];
beforeEach(() => {
  mocks.compile.mockReset();
  mocks.snapshot.mockReset();
  mocks.dispose.mockReset();
  mocks.previewStart.mockClear();
  mocks.previewStop.mockClear();
  mocks.compile.mockImplementation(async (program: Tea.SnapshotSources) => {
    const entry = catalog.find(
      (item) => program.entry === `indicators/builtin/${item.id}.tea`,
    );
    return compiled(entry?.name);
  });
  mocks.snapshot.mockImplementation(async (source: Tea.WorkspaceSources) => ({
    entry: source.path,
    sources: { [source.path]: 'indicator("Saved average", overlay = true)' },
  }));
  mocks.dispose.mockResolvedValue(undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

function setupLibrary(
  paths = ["indicators/builtin/sma.tea"],
  otherPaths: string[] = [],
) {
  const cell = createCell(
    {
      provider: "test",
      listing: { symbol: "AAA", currency: "USD" },
    } as Parameters<typeof createCell>[0],
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
  const resource = {
    id: "cht_test",
    revision: 1,
    cells: [cell, { ...cell, id: "ccl_elsewhere" }],
    links: [],
    preset: "1",
  } as unknown as ChartResource;
  const rpc = {
    indicators: {
      list: { query: vi.fn().mockResolvedValue(catalog) },
      install: {
        mutate: vi.fn().mockImplementation(async ({ id }: { id: string }) => ({
          workspaceId: "wsp_test",
          path: `indicators/builtin/${id}.tea`,
        })),
      },
    },
    resources: {
      macro: {
        addIndicator: {
          mutate: vi
            .fn()
            .mockResolvedValue({ chart: { ...resource, revision: 2 } }),
        },
      },
      workspace: {
        getDefault: { query: vi.fn().mockResolvedValue("wsp_test") },
        list: {
          query: vi.fn().mockResolvedValue({
            items: [
              { id: "wsp_test", root: "/workspaces/default" },
              { id: "wsp_other", root: "/workspaces/research" },
            ],
            nextCursor: null,
          }),
        },
      },
    },
    workspace: {
      listTree: {
        query: vi
          .fn()
          .mockImplementation(
            async ({ workspaceId }: { workspaceId: string }) => ({
              status: "ready",
              entries: (workspaceId === "wsp_test" ? paths : otherPaths).map(
                (path) => ({ path }),
              ),
              directories: [],
            }),
          ),
      },
    },
  };
  const transport = { url: "test", rpc } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(chartDetail(transport, resource.id).queryKey, resource);
  const openFile = vi.fn();
  const close = vi.fn();
  const usePrompt = vi.fn();
  const modifyScript = vi.fn();
  function Fixture() {
    const [query, setQuery] = useState("");
    return (
      <IndicatorLibraryContent
        transport={transport}
        chartId={resource.id}
        cellId={cell.id}
        onClose={close}
        query={query}
        composer={
          <input
            aria-label="Search or describe a study"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
        onUsePrompt={usePrompt}
        onModifyScript={modifyScript}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceFileNavigation.Provider value={openFile}>
        <Fixture />
      </WorkspaceFileNavigation.Provider>
    </QueryClientProvider>,
  );
  return {
    rpc,
    resource,
    cell,
    openFile,
    close,
    usePrompt,
    view,
    client,
    transport,
  };
}

function navigate(name: string) {
  fireEvent.click(screen.getAllByRole("button", { name })[0]!);
}

it("loads every active-purpose preview once and keeps it mounted while scrolling out of view", async () => {
  const visibilityChanges: ((visible: boolean) => void)[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly notify: IntersectionObserverCallback) {}
      observe(target: Element) {
        visibilityChanges.push((isIntersecting) =>
          this.notify(
            [{ target, isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      disconnect() {}
    },
  );
  const { view } = setupLibrary();
  const expected = catalog
    .filter((entry) => entry.discovery && entry.goals.includes("follow-trends"))
    .map(({ path }) => path)
    .sort();
  // Nothing has intersected: previews for the full active purpose must already run.
  await waitFor(() =>
    expect(mocks.previewStart.mock.calls.map(([path]) => path).sort()).toEqual(
      expected,
    ),
  );
  const mounted = screen.getAllByTestId("card-preview");
  expect(mounted).toHaveLength(expected.length);
  fireEvent.scroll(screen.getByRole("tabpanel"), {
    target: { scrollTop: 800 },
  });
  act(() => visibilityChanges.forEach((notify) => notify(false)));
  fireEvent.scroll(screen.getByRole("tabpanel"), { target: { scrollTop: 0 } });
  act(() => visibilityChanges.forEach((notify) => notify(true)));
  expect(screen.getAllByTestId("card-preview")).toEqual(mounted);
  expect(mocks.previewStart.mock.calls.map(([path]) => path).sort()).toEqual(
    expected,
  );
  expect(mocks.previewStop).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.previewStop.mock.calls.map(([path]) => path).sort()).toEqual(
    expected,
  );
});

it("curates Discover by purpose and rank while preserving the full library and headline search", async () => {
  setupLibrary();
  expect(
    await screen.findByRole("heading", { name: "Follow a changing trend" }),
  ).toBeVisible();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Follow trends",
    "Find breakouts",
    "Find reversals",
    "Read volume",
    "Understand volatility",
    "Read structure",
  ]);
  expect(
    screen
      .getAllByRole("button", { name: /^(Supertrend Regime|DEMA|SMA)$/ })
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Supertrend Regime", "DEMA", "SMA"]);
  expect(screen.queryByRole("button", { name: "EMA" })).not.toBeInTheDocument();
  navigate("All indicators");
  expect(await screen.findByRole("button", { name: "EMA" })).toBeVisible();
  navigate("Discover");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search or describe a study" }),
    {
      target: { value: "changing trend" },
    },
  );
  expect(
    await screen.findByRole("button", { name: "Supertrend Regime" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "SMA" })).not.toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search or describe a study" }),
    {
      target: { value: "greater weight" },
    },
  );
  expect(await screen.findByRole("button", { name: "EMA" })).toBeVisible();
});

it("discovers by purpose and searches prompts and explanations without adding a study", async () => {
  const { rpc } = setupLibrary();
  await screen.findByRole("button", { name: "SMA" });
  await userEvent.click(
    screen.getByRole("tab", { name: "Understand volatility" }),
  );
  expect(await screen.findByRole("button", { name: "ATR" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "SMA" })).not.toBeInTheDocument();
  navigate("All indicators");
  const search = screen.getByRole("textbox", {
    name: "Search or describe a study",
  });
  fireEvent.change(search, {
    target: { value: "relative strength oscillator" },
  });
  expect(await screen.findByRole("button", { name: "RSI" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "ATR" })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "range size" } });
  fireEvent.click(await screen.findByRole("button", { name: "ATR" }));
  expect(
    await screen.findByRole("heading", { name: "ATR", level: 1 }),
  ).toBeVisible();
  expect(rpc.resources.macro.addIndicator.mutate).not.toHaveBeenCalled();
});

it("offers one prompt-copy action and opens its exact source beside Add without attaching it", async () => {
  const { rpc, usePrompt, openFile, close } = setupLibrary();
  fireEvent.click(await screen.findByRole("button", { name: "SMA" }));
  expect(
    await screen.findByRole("button", { name: "Copy prompt" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Use this prompt" }),
  ).not.toBeInTheDocument();
  expect(usePrompt).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  const open = screen.getByRole("button", { name: "Open source" });
  const actions = screen.getAllByRole("button");
  expect(actions.indexOf(open) + 1).toBe(
    actions.indexOf(screen.getByRole("button", { name: "Add to chart" })),
  );
  fireEvent.click(open);
  expect(openFile).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_test",
    path: "indicators/builtin/sma.tea",
  });
  expect(close).toHaveBeenCalledOnce();
  expect(rpc.resources.macro.addIndicator.mutate).not.toHaveBeenCalled();
});

it("hides an empty Inputs section and attaches a parameter-free study directly", async () => {
  const { rpc, close } = setupLibrary();
  const study = compiled("SMA");
  mocks.compile.mockResolvedValue({
    ...study,
    definition: { ...study.definition, parameters: [] },
  });
  fireEvent.click(await screen.findByRole("button", { name: "SMA" }));
  expect(await screen.findByTestId("study-preview")).toHaveTextContent("{}");
  expect(
    screen.queryByRole("heading", { name: "Inputs" }),
  ).not.toBeInTheDocument();
  const add = screen.getByRole("button", { name: "Add to chart" });
  expect(add).not.toHaveAttribute("form");
  fireEvent.click(add);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(rpc.resources.macro.addIndicator.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ parameterOverrides: {} }),
  );
});

it("uses one input draft for historical previews and attachment while blocking invalid values", async () => {
  const { rpc } = setupLibrary();
  fireEvent.click(await screen.findByRole("button", { name: "SMA" }));
  const length = await screen.findByRole("spinbutton", { name: "Length" });
  expect(await screen.findByTestId("study-preview")).toHaveTextContent("{}");
  fireEvent.change(length, { target: { value: "21" } });
  expect(screen.getByTestId("study-preview")).toHaveTextContent(
    '{"length":21}',
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset Length" }));
  expect(length).toHaveValue(14);
  expect(screen.getByTestId("study-preview")).toHaveTextContent("{}");
  fireEvent.change(length, { target: { value: "0" } });
  expect(screen.queryByTestId("study-preview")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("allowed range");
  expect(screen.getByRole("button", { name: "Add to chart" })).toBeDisabled();
  expect(rpc.resources.macro.addIndicator.mutate).not.toHaveBeenCalled();
  fireEvent.change(length, { target: { value: "18" } });
  expect(screen.getByTestId("study-preview")).toHaveTextContent(
    '{"length":18}',
  );
  fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
  await waitFor(() =>
    expect(rpc.resources.macro.addIndicator.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ parameterOverrides: { length: 18 } }),
    ),
  );
});

it("shows the values a preview ran with for defaults that follow the chart, and saves none of them", async () => {
  const { rpc } = setupLibrary();
  const chartDefault = (fields: Partial<Tea.Parameter>): Tea.Parameter => ({
    ...lengthParameter,
    type: "string",
    control: "auto",
    constraints: null,
    chartDefault: true,
    ...fields,
  });
  mocks.compile.mockImplementation(async () => ({
    ...compiled("SMA"),
    declaration: {
      kind: "indicator",
      title: "SMA",
      overlay: true,
      timeframe: "auto",
    },
    definition: {
      ...compiled("SMA").definition,
      parameters: [
        chartDefault({
          name: "timeframe",
          title: "Timeframe",
          control: "timeframe",
          defaultValue: "",
        }),
        chartDefault({
          name: "range",
          title: "Range",
          defaultValue: "Daily",
          constraints: { kind: "options", options: ["Daily", "Monthly"] },
        }),
        lengthParameter,
      ],
    },
  }));
  // On the example's daily bars, the range resolves to Monthly.
  mocks.resolved = { timeframe: "", range: "Monthly", length: 14 };
  try {
    fireEvent.click(await screen.findByRole("button", { name: "SMA" }));
    expect(
      await screen.findByRole("button", { name: "Range" }),
    ).toHaveTextContent("Monthly");
    // The preview reads only its example's bars, so the chart picks them.
    expect(screen.getByText("Default")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
    await waitFor(() =>
      expect(rpc.resources.macro.addIndicator.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ parameterOverrides: {} }),
      ),
    );
  } finally {
    mocks.resolved = undefined;
  }
});

it.each([
  {
    workspaceId: "wsp_test",
    path: "research/averages/saved.tea",
    name: /^saved\.tea · default/,
  },
  {
    workspaceId: "wsp_other",
    path: "indicators/builtin/sma.tea",
    name: /^sma\.tea · research/,
  },
])(
  "opens $workspaceId/$path from My scripts directly in Workspace",
  async ({ workspaceId, path, name }) => {
    const { rpc, openFile, close } = setupLibrary(
      ["indicators/builtin/sma.tea", "research/averages/saved.tea"],
      ["indicators/builtin/sma.tea"],
    );
    navigate("My scripts");
    await screen.findByRole("button", { name: /^sma\.tea/ });
    // Only the other Workspace's file remains; the default original is excluded.
    expect(screen.getAllByRole("button", { name: /^sma\.tea/ })).toHaveLength(
      1,
    );
    fireEvent.click(await screen.findByRole("button", { name }));
    expect(openFile).toHaveBeenCalledExactlyOnceWith({ workspaceId, path });
    expect(close).toHaveBeenCalledOnce();
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      openFile.mock.invocationCallOrder[0]!,
    );
    expect(screen.queryByTestId("study-preview")).not.toBeInTheDocument();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(rpc.indicators.install.mutate).not.toHaveBeenCalled();
    expect(rpc.resources.macro.addIndicator.mutate).not.toHaveBeenCalled();
  },
);

it("retains chosen inputs after a failed chart save and retries only on the next explicit click", async () => {
  const { rpc, close } = setupLibrary();
  rpc.resources.macro.addIndicator.mutate.mockRejectedValueOnce(
    new Error("Save unavailable"),
  );
  fireEvent.click(await screen.findByRole("button", { name: "SMA" }));
  const length = await screen.findByRole("spinbutton", { name: "Length" });
  fireEvent.change(length, { target: { value: "17" } });
  const add = screen.getByRole("button", { name: "Add to chart" });
  fireEvent.click(add);
  await waitFor(() =>
    expect(rpc.resources.macro.addIndicator.mutate).toHaveBeenCalledOnce(),
  );
  await waitFor(() => expect(add).toBeEnabled());
  expect(close).not.toHaveBeenCalled();
  expect(length).toHaveValue(17);
  fireEvent.click(add);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(
    rpc.resources.macro.addIndicator.mutate.mock.calls[1]![0],
  ).toMatchObject({ parameterOverrides: { length: 17 } });
});

it("opens personal files from library search without preparing a preview", async () => {
  const path = "research/helpers/helper.tea";
  const { rpc, openFile, close } = setupLibrary([], [path]);
  mocks.compile.mockRejectedValue(new Error("Unknown function"));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search or describe a study" }),
    { target: { value: "helper" } },
  );
  fireEvent.click(await screen.findByRole("button", { name: /^helper\.tea/ }));
  expect(openFile).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_other",
    path,
  });
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("study-preview")).not.toBeInTheDocument();
  expect(mocks.compile).not.toHaveBeenCalled();
  expect(rpc.resources.macro.addIndicator.mutate).not.toHaveBeenCalled();
});
