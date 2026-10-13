/// <reference types="vitest/jsdom" />
// Purpose: Prove the Watchlist widget renders its tree, live metrics, collapse, sort, row removal through the Resource, and raises ViewChart for rows.
import { defineId } from "@openchart/identifier";
import { BarColumns, type ProviderListing } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BehaviorSubject, NEVER, Subject } from "rxjs";
import { defineDataFrame, fromRows } from "@openchart/timeseries";
import type { BarsView } from "@openchart/app/hooks/use-bars";
import type { TeaLatestState } from "@openchart/app/hooks/use-tea";
import { Schema, Field, Float64, TimestampMillisecond } from "apache-arrow";

import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { useIntentHandler } from "@openchart/app/hooks/use-intent";
import { viewChart } from "@openchart/app/lib/widget/intent/intents";
import { WidgetIntentProvider } from "@openchart/app/lib/widget/intent/provider";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";

import { watchlistDetail, type Watchlist } from "../api/queries";
import { watchlistWidget } from "../components/widget";

vi.mock("@openchart/app/hooks/use-tea", () => ({
  useTeaGroup: () => ({ states: formulaStates, retry: formulaRetry }),
  useTeaDefinition: () => ({
    pending: false,
    compiled: {
      definition: {
        parameters: [],
        outputs: new Schema([
          new Field(
            "value",
            new Float64(),
            true,
            new Map([["tea:write", "set"]]),
          ),
        ]),
      },
    },
  }),
  useTeaSource: () => ({
    pending: false,
    program: { entry: "rsi.tea", sources: { "rsi.tea": "code" } },
  }),
}));

const formulaStates = new BehaviorSubject<ReadonlyMap<string, TeaLatestState>>(
  new Map(),
);
const formulaRetry = vi.fn();
const outputs = new Schema([
  new Field("time", new TimestampMillisecond(), false),
  new Field("value", new Float64(), true, new Map([["tea:write", "set"]])),
]);
const readyFormula = (
  value: number,
  executionKey = "initial",
): TeaLatestState => ({
  status: "ready",
  executionKey,
  compiled: {
    declaration: null,
    definition: {
      parameters: [],
      inputs: new Schema([]),
      outputs,
      requests: {},
    },
  },
  data: fromRows(outputs, [{ time: 10, value }]),
});
const calendar = { isPending: false, data: { days: [] } };
vi.mock("@openchart/app/hooks/use-calendar", () => ({
  useCalendar: () => calendar,
}));

const closes: Record<string, [number, number]> = {
  AAPL: [0.83, 0.8127],
  MSFT: [400, 396],
  NVDA: [100, 110],
};

// Query results keep their identity across renders, as the real hooks do.
const daily = {
  error: null as Error | null,
  refetch: vi.fn(),
  data: [
    {
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
      modes: ["history", "live"],
    },
    {
      resolution: "5m",
      session: "regular",
      adjustment: "raw",
      modes: ["history", "live"],
    },
  ],
};
const capabilities = vi.fn<(listing: ProviderListing) => typeof daily>(
  () => daily,
);
const views = new Map<string, unknown>();

vi.mock("@openchart/app/hooks/use-bars", () => ({
  useBarsCapabilitiesMany: (listings: ProviderListing[]) =>
    listings.map((listing) => capabilities(listing)),
  useBarsCapabilities: (listing: ProviderListing) => capabilities(listing),
  // Two daily closes per symbol; quotes derive price, change, and change %.
  useBars: (request: { listing: { symbol: string } }) => {
    const symbol = request.listing.symbol;
    if (!views.has(symbol)) {
      const [previous, last] = closes[symbol]!;
      const rows = [
        { time: 1, close: previous, volume: 10 },
        { time: 2, close: last, volume: 20 },
      ];
      views.set(symbol, {
        status: "ready",
        current: {
          data: {
            numRows: 2,
            get: (i: number) => rows[i],
            column: (key: keyof (typeof rows)[number]) =>
              rows.map((row) => row[key]),
          },
          updates: NEVER,
        },
      });
    }
    return views.get(symbol);
  },
}));

const listing = (symbol: string) => ({
  provider: "yfinance",
  listing: { symbol, currency: "USD" },
});

const viewed = vi.fn();
// Stands in for the chart placement that answers ViewChart on a Dashboard.
function ChartPlacement() {
  useIntentHandler(viewChart, viewed);
  return null;
}

function setup(
  options: {
    empty?: boolean;
    selectedId?: string;
    paged?: boolean;
    formula?: boolean;
    history?: boolean;
  } = {},
) {
  const watchlist = {
    id: "wtl_test",
    revision: 3,
    createdAt: 0,
    updatedAt: 0,
    name: "Markets",
    columns: [
      { id: "wcl_price", metric: { kind: "price" } },
      { id: "wcl_change", metric: { kind: "change" } },
      { id: "wcl_percent", metric: { kind: "changePercent" } },
      ...(options.history
        ? [
            {
              id: "wcl_history",
              visible: true,
              metric: { kind: "priceHistory" },
            },
          ]
        : []),
      ...(options.formula
        ? [
            {
              id: "wcl_formula",
              visible: true,
              title: "RSI",
              metric: {
                kind: "formula",
                source: { workspaceId: "wsp_test", path: "rsi.tea" },
                snapshot: { "rsi.tea": "code" },
                parameterOverrides: {},
                output: "value",
                bars: { resolution: "1d" },
              },
            },
          ]
        : []),
    ],
    sections: [
      {
        id: "wsc_plain",
        items: [{ id: "wit_aapl", ...listing("AAPL") }],
        sections: [],
      },
      {
        id: "wsc_tech",
        name: "Tech",
        items: [
          { id: "wit_msft", ...listing("MSFT") },
          { id: "wit_nvda", ...listing("NVDA") },
        ],
        sections: [],
      },
    ],
  } as unknown as Watchlist;
  const placementId = defineId("wdg", "WidgetPlacement.ID").create();
  const patch = vi.fn().mockResolvedValue({ ...watchlist, revision: 4 });
  const other = { ...watchlist, id: "wtl_other", name: "Crypto" };
  const items = options.empty ? [] : [watchlist, other];
  const created = { ...watchlist, id: "wtl_new", name: "Energy", sections: [] };
  const create = vi.fn().mockImplementation(() => {
    items.push(created);
    return Promise.resolve(created);
  });
  const remove = vi.fn().mockImplementation(({ id }: { id: string }) => {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items.splice(index, 1);
    return Promise.resolve();
  });
  const list = vi.fn().mockImplementation((input: { cursor?: string }) =>
    Promise.resolve(
      options.paged
        ? {
            items: input.cursor ? [other] : [watchlist],
            nextCursor: input.cursor ? null : "next",
          }
        : { items, nextCursor: null },
    ),
  );
  const get = vi
    .fn()
    .mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(items[items.findIndex((item) => item.id === id)] ?? null),
    );
  const dashboardGet = vi.fn();
  const dashboardPatch = vi.fn();
  const transport = {
    url: "test",
    rpc: {
      resources: {
        dashboard: {
          get: { query: dashboardGet },
          patch: { mutate: dashboardPatch },
        },
        watchlist: {
          get: { query: get },
          list: { query: list },
          create: { mutate: create },
          delete: { mutate: remove },
          patch: { mutate: patch },
        },
      },
    },
  } as unknown as AppTransport;
  const storageKey = `local:watchlist-widget:${placementId}`;
  if (options.selectedId)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: { selectedWatchlistId: options.selectedId },
        version: 1,
      }),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const Placement = watchlistWidget.Provider!;
  const Content = watchlistWidget.Content;
  const placement = (id: string) => ({
    placementId: id,
    dashboardId: "dsh_test",
    transport,
    holdControls: () => () => {},
    placeBeside: vi.fn(),
  });
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <WidgetIntentProvider>
          <WidgetContext.Provider value={placement("wdg_chart")}>
            <ChartPlacement />
          </WidgetContext.Provider>
          <WidgetContext.Provider value={placement(placementId)}>
            <TooltipProvider delayDuration={0}>
              <Placement>
                <Content />
              </Placement>
            </TooltipProvider>
          </WidgetContext.Provider>
        </WidgetIntentProvider>
      </QueryClientProvider>,
    );
  const view = mount();
  return {
    patch,
    remove,
    create,
    list,
    get,
    client,
    transport,
    dashboardGet,
    dashboardPatch,
    storageKey,
    mount,
    view,
    user: userEvent.setup(),
  };
}

// Only the context-menu event needs jsdom's signal, as in the Workspace view tests.
function openContextMenu(element: HTMLElement) {
  const nativeAbortController = globalThis.AbortController;
  vi.stubGlobal("AbortController", jsdom.window.AbortController);
  try {
    fireEvent.contextMenu(element);
  } finally {
    vi.stubGlobal("AbortController", nativeAbortController);
  }
}

const rows = () =>
  screen.getAllByRole("treeitem").map((row) => row.getAttribute("aria-label"));

beforeEach(() => {
  views.clear();
  viewed.mockReset();
  formulaStates.next(new Map());
  formulaRetry.mockReset();
  capabilities.mockReset().mockReturnValue(daily);
  daily.refetch.mockClear();
  localStorage.clear();
});

test("failed quote capabilities show an explicit retry instead of silent missing values", async () => {
  capabilities.mockImplementation((request) =>
    request.listing.symbol === "AAPL"
      ? { ...daily, error: new Error("offline"), data: [] }
      : daily,
  );
  const { user } = setup();
  await user.click(
    await screen.findByRole("button", { name: "Retry quote for AAPL" }),
  );
  expect(daily.refetch).toHaveBeenCalledTimes(1);
  expect(viewed).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(daily.refetch).toHaveBeenCalledTimes(2);
  expect(viewed).not.toHaveBeenCalled();
});

test("shows named sections as headings and rows with live, sign-coloured metrics", async () => {
  setup();
  await waitFor(() => expect(rows()).toEqual(["AAPL", "Tech", "MSFT", "NVDA"]));
  const msft = screen.getByRole("treeitem", { name: "MSFT" });
  expect(msft).toHaveTextContent("396.00");
  expect(screen.getAllByText("-4.00")[0]).toHaveClass("text-down");
  expect(screen.getByText("+10.00%")).toHaveClass("text-up");
  // Sub-dollar prices keep their precision; changes always round to cents.
  const aapl = screen.getByRole("treeitem", { name: "AAPL" });
  expect(aapl).toHaveTextContent("0.8127");
  expect(aapl).toHaveTextContent("-0.02");
  expect(aapl).not.toHaveTextContent("-0.0173");
});

test("asks Feed for each listing's identity only, never the row id", async () => {
  setup();
  await waitFor(() => expect(capabilities).toHaveBeenCalled());
  for (const [request] of capabilities.mock.calls)
    expect(Object.keys(request).sort()).toEqual(["listing", "provider"]);
});

test("clicking a row, or Enter on it, raises ViewChart with the row's listing only", async () => {
  const { user } = setup();
  await user.click(await screen.findByRole("treeitem", { name: "MSFT" }));
  expect(viewed).toHaveBeenCalledExactlyOnceWith(
    { listing: listing("MSFT") },
    { placementId: expect.stringMatching(/^wdg_/) },
  );
  await user.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(viewed).toHaveBeenCalledTimes(2));
  expect(viewed).toHaveBeenLastCalledWith(
    { listing: listing("NVDA") },
    expect.anything(),
  );
  // Section headings only collapse.
  await user.click(screen.getByRole("treeitem", { name: "Tech" }));
  expect(viewed).toHaveBeenCalledTimes(2);
});

test("collapses a named section and sorts rows within it", async () => {
  const { user } = setup();
  await waitFor(() => expect(rows()).toContain("NVDA"));
  await user.click(screen.getByRole("columnheader", { name: /Chg%/ }));
  expect(screen.getByRole("columnheader", { name: /Chg%/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  // MSFT fell 1%, NVDA rose 10%: ascending keeps MSFT first within Tech.
  await user.click(screen.getByRole("columnheader", { name: /Chg%/ }));
  await waitFor(() => expect(rows()).toEqual(["AAPL", "Tech", "NVDA", "MSFT"]));
  await user.click(screen.getByRole("treeitem", { name: "Tech" }));
  await waitFor(() => expect(rows()).toEqual(["AAPL", "Tech"]));
});

test("removes a row from its context menu with one JSON Patch remove", async () => {
  const { patch, user } = setup();
  const msft = await screen.findByRole("treeitem", { name: "MSFT" });
  openContextMenu(msft);
  await user.click(
    await screen.findByRole("menuitem", { name: "Remove MSFT" }),
  );
  await waitFor(() =>
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      id: "wtl_test",
      expectedRevision: 3,
      operations: [{ op: "remove", path: "/sections/1/items/0" }],
    }),
  );
});

test("deleting a section requires confirmation and Cancel preserves its rows", async () => {
  const { patch, user } = setup();
  const section = await screen.findByRole("treeitem", { name: "Tech" });
  openContextMenu(section);
  await user.click(
    await screen.findByRole("menuitem", {
      name: "Delete section and its symbols",
    }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Delete section" });
  expect(dialog).toHaveTextContent("Tech");
  expect(patch).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("treeitem", { name: "MSFT" })).toBeInTheDocument();
  openContextMenu(section);
  await user.click(
    await screen.findByRole("menuitem", {
      name: "Delete section and its symbols",
    }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Delete section" }),
  );
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith({
      id: "wtl_test",
      expectedRevision: 3,
      operations: [{ op: "remove", path: "/sections/1" }],
    }),
  );
});

test("empty unnamed sections still offer the empty-list action", async () => {
  const { client, transport } = setup();
  await screen.findByRole("treeitem", { name: "AAPL" });
  const key = watchlistDetail(transport, "wtl_test").queryKey;
  await act(() =>
    client.setQueryData(key, (current) =>
      current
        ? {
            ...current,
            sections: [{ ...current.sections[0]!, items: [], sections: [] }],
          }
        : current,
    ),
  );
  expect(await screen.findByText("No symbols yet.")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Add symbol" })).toHaveLength(2);
});

test("switching persists locally across remounts without reading or writing Dashboard", async () => {
  const { user, storageKey, view, mount, dashboardGet, dashboardPatch } =
    setup();
  await user.click(await screen.findByRole("button", { name: /Markets/ }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "Crypto" }),
  );
  await screen.findByRole("button", { name: /Crypto/ });
  expect(
    JSON.parse(localStorage.getItem(storageKey)!).state.selectedWatchlistId,
  ).toBe("wtl_other");
  view.unmount();
  const { unmount } = mount();
  await screen.findByRole("button", { name: /Crypto/ });
  unmount();
  localStorage.removeItem(storageKey);
  mount();
  await screen.findByRole("button", { name: /Markets/ });
  expect(dashboardGet).not.toHaveBeenCalled();
  expect(dashboardPatch).not.toHaveBeenCalled();
});

test("a saved selection outside the loaded page stays selected", async () => {
  setup({ selectedId: "wtl_other", paged: true });
  await screen.findByRole("button", { name: /Crypto/ });
  expect(
    screen.queryByRole("button", { name: /Markets/ }),
  ).not.toBeInTheDocument();
});

test("a deleted saved selection falls back to an available list", async () => {
  setup({ selectedId: "wtl_deleted" });
  expect(
    await screen.findByRole("button", { name: /Markets/ }),
  ).toBeInTheDocument();
});

test("successful deletion selects another list, and deleting the last leaves creation available", async () => {
  const { remove, user } = setup();
  await user.click(await screen.findByRole("button", { name: /Markets/ }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete watchlist" }),
  );
  expect(remove).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "Delete watchlist" }),
  );
  await user.click(await screen.findByRole("button", { name: /Crypto/ }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete watchlist" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Delete watchlist" }),
  );
  await screen.findByText("Choose a watchlist or create a new one.");
  expect(remove).toHaveBeenNthCalledWith(1, { id: "wtl_test" });
  expect(remove).toHaveBeenNthCalledWith(2, { id: "wtl_other" });
});

test("failed deletion keeps the selected list", async () => {
  const { remove, user } = setup();
  remove.mockRejectedValueOnce(new Error("offline"));
  await user.click(await screen.findByRole("button", { name: /Markets/ }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete watchlist" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Delete watchlist" }),
  );
  await waitFor(() => expect(remove).toHaveBeenCalled());
  const dialog = await screen.findByRole("dialog", {
    name: "Delete watchlist",
  });
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await screen.findByRole("button", { name: /Markets/ });
});

test("an empty widget creates and selects its first Watchlist with starter columns", async () => {
  const { create, user } = setup({ empty: true });
  await user.click(await screen.findByRole("button", { name: "Watchlists" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "New watchlist" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "New watchlist" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Name" }),
    "Energy",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Create watchlist" }),
  );
  await screen.findByRole("button", { name: /Energy/ });
  expect(create).toHaveBeenCalledWith({
    name: "Energy",
    columns: ["price", "change", "changePercent"].map((kind) => ({
      id: expect.stringMatching(/^wcl_/),
      visible: true,
      metric: { kind },
    })),
  });
});

test("a failed rename retains its draft and allows retry", async () => {
  const { patch, user } = setup();
  patch.mockRejectedValueOnce(new Error("offline"));
  await user.click(await screen.findByRole("button", { name: /Markets/ }));
  await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Rename watchlist",
  });
  const input = within(dialog).getByRole("textbox", { name: "Name" });
  await user.clear(input);
  await user.type(input, "My markets");
  const submit = within(dialog).getByRole("button", { name: "Rename" });
  await user.click(submit);
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(submit).toBeEnabled());
  expect(input).toHaveValue("My markets");
  await user.click(submit);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(patch).toHaveBeenCalledTimes(2);
});

test("dropping unrelated data on a column does not reorder columns", async () => {
  const { patch } = setup();
  const column = await screen.findByRole("columnheader", { name: "Chg" });
  fireEvent.drop(column, { dataTransfer: { getData: () => "" } });
  expect(patch).not.toHaveBeenCalled();
});

test("scrolling the menu loads the next cursor page", async () => {
  let intersect: IntersectionObserverCallback | undefined;
  const original = globalThis.IntersectionObserver;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  try {
    const { list, user } = setup({ paged: true });
    await user.click(await screen.findByRole("button", { name: /Markets/ }));
    await screen.findByRole("menuitemradio", { name: "Markets" });
    await waitFor(() => expect(intersect).toBeDefined());
    act(() =>
      intersect!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    await screen.findByRole("menuitemradio", { name: "Crypto" });
    expect(list).toHaveBeenCalledWith(
      { limit: 20, cursor: "next" },
      expect.anything(),
    );
  } finally {
    vi.stubGlobal("IntersectionObserver", original);
  }
});

test("formula columns use ordinary visibility rows with a separate settings action", async () => {
  const { user, patch } = setup({ formula: true });
  await user.click(await screen.findByRole("button", { name: "Columns" }));
  const checkbox = screen.getByRole("menuitemcheckbox", {
    name: "RSI Formula",
  });
  expect(checkbox).toBeChecked();
  await user.click(screen.getByRole("menuitem", { name: "Settings for RSI" }));
  expect(
    await screen.findByRole("dialog", { name: "Column settings" }),
  ).toBeInTheDocument();
  expect(patch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Open code" })).toHaveAttribute(
    "data-variant",
    "outline",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Columns" }));
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "RSI Formula" }),
  );
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith({
      id: "wtl_test",
      expectedRevision: 3,
      operations: [{ op: "add", path: "/columns/3/visible", value: false }],
    }),
  );
});

test("Price History hover and sorting coexist with Formula cells and row intents", async () => {
  formulaStates.next(
    new Map([
      ["wit_aapl:wcl_formula", readyFormula(1000)],
      ["wit_msft:wcl_formula", readyFormula(2000)],
      ["wit_nvda:wcl_formula", readyFormula(3000)],
    ]),
  );
  const { user } = setup({ history: true, formula: true });
  const msft = await screen.findByRole("treeitem", { name: "MSFT" });
  await waitFor(() => expect(msft).toHaveTextContent("2,000.00"));
  const sparkline = within(msft).getByRole("img", {
    name: "Price history for MSFT",
  });
  // jsdom lacks PointerEvent's coordinate fields; dispatch the native shape React reads.
  fireEvent(
    sparkline,
    new MouseEvent("pointermove", { bubbles: true, clientX: 0 }),
  );
  // Whole text matches prove hover and return-to-live values have no coloured digits.
  expect(await within(msft).findByText("400.00")).toBeInTheDocument();
  expect(msft).toHaveTextContent("2,000.00");
  expect(viewed).not.toHaveBeenCalled();
  fireEvent.pointerLeave(sparkline);
  expect(await within(msft).findByText("396.00")).toBeInTheDocument();
  await user.click(screen.getByRole("columnheader", { name: "Price History" }));
  await user.click(screen.getByRole("columnheader", { name: "Price History" }));
  await waitFor(() => expect(rows()).toEqual(["AAPL", "Tech", "NVDA", "MSFT"]));
  await user.click(msft);
  expect(viewed).toHaveBeenCalledExactlyOnceWith(
    { listing: listing("MSFT") },
    expect.anything(),
  );
  await user.keyboard("{Enter}");
  expect(viewed).toHaveBeenCalledTimes(2);
});

test("live bars and Tea results highlight only the latest changed digits", async () => {
  const Bars = defineDataFrame(BarColumns);
  const frame = (time: number, close: number) =>
    Bars.create({
      labels: {},
      rows: [{ time, open: close, high: close, low: close, close, volume: 10 }],
    });
  const updates = new Subject<BarsView["data"]>();
  views.set("MSFT", {
    status: "ready",
    current: { data: frame(2, 396), updates },
  });
  formulaStates.next(new Map([["wit_msft:wcl_formula", readyFormula(2000)]]));
  setup({ formula: true });
  const msft = await screen.findByRole("treeitem", { name: "MSFT" });
  const price = await within(msft).findByText("396.00");
  const formula = await within(msft).findByText("2,000.00");

  act(() => {
    updates.next(frame(2, 396.01));
    formulaStates.next(
      new Map([["wit_msft:wcl_formula", readyFormula(2000.25)]]),
    );
  });
  await waitFor(() => expect(price).toHaveTextContent("396.01"));
  await waitFor(() => expect(formula).toHaveTextContent("2,000.25"));
  expect(
    within(price)
      .queryAllByText(/./u, { selector: ".text-up" })
      .map((digit) => digit.textContent),
  ).toEqual(["1"]);
  expect(
    within(formula)
      .queryAllByText(/./u, { selector: ".text-up" })
      .map((digit) => digit.textContent),
  ).toEqual(["2", "5"]);
  // A cached execution can replace the value without first publishing loading.
  act(() =>
    formulaStates.next(
      new Map([["wit_msft:wcl_formula", readyFormula(3000, "other-run")]]),
    ),
  );
  expect(await within(msft).findByText("3,000.00")).toBeInTheDocument();
});

test("Formula retry works by click and Enter without opening the row in Chart", async () => {
  formulaStates.next(
    new Map([
      [
        "wit_aapl:wcl_formula",
        { status: "error", error: new Error("offline") },
      ],
    ]),
  );
  const { user } = setup({ formula: true });
  await user.click(
    await screen.findByRole("button", { name: "Retry formula" }),
  );
  expect(formulaRetry).toHaveBeenCalledExactlyOnceWith("wit_aapl:wcl_formula");
  expect(viewed).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(formulaRetry).toHaveBeenCalledTimes(2);
  expect(viewed).not.toHaveBeenCalled();
});
