// Purpose: Keep independent Resource editors on current revisions and preserve chart binding semantics.
import { QueryClient } from "@tanstack/react-query";
import type { BarsCapabilities } from "@openchart/feed";
import { defineId } from "@openchart/identifier";
import { ProviderId, type ProviderListing } from "@openchart/market";
import { expect, it, vi } from "vitest";

import {
  chartCommand,
  chartDetail,
  chartIds,
  chartMutation,
  createCell,
  indicatorList,
  type CellDefinition,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import {
  addCell,
  addComparison,
  getMainPane,
  getMainSeries,
  getMainSource,
  linkCells,
  moveSeries,
  removeMarketSource,
  removeSeries,
  replaceListing,
  replaceMarketSource,
  setGridPreset,
  setProfileSettings,
} from "@openchart/app/features/chart/utils/resource";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const options = {
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
} as const;
const capabilities: BarsCapabilities = [
  { ...options, modes: ["history", "delayed"] },
];
const listing = (symbol: string): ProviderListing => ({
  provider: ProviderId.make("test"),
  listing: { symbol, currency: "USD" },
});
const resource = (): ChartResource => ({
  id: defineId("cht", "Chart.ID").create(),
  dashboardId: "dsh_test",
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  preset: "1",
  cells: [createCell(listing("AAPL"), options)],
  links: [],
});

it("compares distinct native listings sharing a ticker and only rejects the same identity", () => {
  const first: ProviderListing = {
    provider: ProviderId.make("openchart"),
    listing: { id: 10244, symbol: "SPCX", venue: "NASDAQ", currency: "USD" },
  };
  const second = { ...first, listing: { ...first.listing, id: 55090 } };
  const cell = addComparison(createCell(first, options), second, capabilities);
  expect(cell.marketSources.map((source) => source.listing.id)).toEqual([
    10244, 55090,
  ]);
  expect(() =>
    addComparison(
      cell,
      { ...second, listing: { ...second.listing, symbol: "RENAMED" } },
      capabilities,
    ),
  ).toThrow("already on");
  const chart = { ...resource(), cells: [cell] };
  const sourceId = cell.marketSources[1]!.id;
  expect(
    replaceMarketSource(chart, cell.id, sourceId, second, capabilities)
      .cells[0]!.marketSources[1]!.listing.id,
  ).toBe(55090);
  expect(() =>
    replaceMarketSource(chart, cell.id, sourceId, first, capabilities),
  ).toThrow("already on");
});

it("removes a comparison input only with its last display and permits adding it again", () => {
  const original = addComparison(
    createCell(listing("AAPL"), options),
    listing("MSFT"),
    capabilities,
  );
  const source = original.marketSources[1]!;
  // The main source's default volume shares the pane; pick the comparison's display.
  const display = original.panes[0]!.series.find(
    (series) =>
      series.source.kind === "market" &&
      series.source.marketSourceId === source.id,
  )!;
  const volume = { ...display, id: chartIds.series.create() };
  const withVolume: CellDefinition = {
    ...original,
    panes: [
      ...original.panes,
      { id: chartIds.pane.create(), series: [volume] },
    ],
  };
  const withoutPrice = removeSeries(withVolume, display.id);
  expect(withoutPrice.marketSources).toContain(source);
  const withoutVolume = removeSeries(withoutPrice, volume.id);
  expect(withoutVolume.panes).toHaveLength(1);
  expect(withoutVolume.marketSources).toHaveLength(1);
  expect(
    addComparison(withoutVolume, listing("MSFT"), capabilities).marketSources,
  ).toHaveLength(2);
  expect(removeMarketSource(withVolume, source.id).marketSources).toHaveLength(
    1,
  );
  expect(() => removeSeries(original, getMainSeries(original).id)).toThrow(
    "main series",
  );
  expect(() =>
    removeMarketSource(original, getMainSource(original).id),
  ).toThrow("main market source");
});

it("adds comparisons to the moved main pane and rejects a stale destination", () => {
  const original = addComparison(
    createCell(listing("AAPL"), options),
    listing("MSFT"),
    capabilities,
  );
  const moved = moveSeries(original, getMainSeries(original).id, "new");
  const next = addComparison(moved, listing("GOOG"), capabilities);
  expect(next.panes[0]!.series).toEqual(moved.panes[0]!.series);
  expect(getMainPane(next).series).toHaveLength(2);
  expect(getMainPane(next).id).toBe(getMainPane(moved).id);
  expect(() => moveSeries(next, getMainSeries(next).id, "missing")).toThrow(
    "destination pane",
  );
});

it("removes a pane when its last binding is moved or deleted", () => {
  const original = createCell(listing("AAPL"), options);
  const main = getMainPane(original);
  const volume = main.series.find(
    (series) => series.source.output === "volume",
  )!;
  const split = moveSeries(original, volume.id, "new");
  expect(split.panes).toHaveLength(2);
  expect(moveSeries(split, volume.id, main.id)).toEqual(original);
  const removed = removeSeries(split, volume.id);
  expect(removed.panes).toEqual([
    { ...main, series: [getMainSeries(original)] },
  ]);
  expect(removed.marketSources).toEqual(original.marketSources);
});

it("saves a volume profile's settings on its binding alone", () => {
  const original = createCell(listing("AAPL"), options);
  const main = getMainPane(original);
  const profile = {
    id: chartIds.series.create(),
    role: "normal",
    source: {
      kind: "market",
      marketSourceId: getMainSource(original).id,
      output: "volumeProfile",
    },
  } as const;
  const cell: CellDefinition = {
    ...original,
    panes: [{ ...main, series: [...main.series, profile] }],
  };
  const saved = setProfileSettings(cell, profile.id, {
    resolution: "15m",
    rows: 50,
  });
  expect(saved.panes[0]!.series).toEqual([
    ...main.series,
    { ...profile, resolution: "15m", rows: 50 },
  ]);
  // A setting left out returns to its default.
  expect(
    setProfileSettings(saved, profile.id, { rows: 50 }).panes[0]!.series.at(-1),
  ).toEqual({ ...profile, rows: 50 });
  // Only a volume profile binding has settings.
  expect(
    setProfileSettings(cell, getMainSeries(cell).id, { rows: 50 }),
  ).toEqual(cell);
});

it("moves every indicator output together and preserves other sources", () => {
  const base = createCell(listing("AAPL"), options);
  const outputs = ["basis", "upper", "lower"].map((output) => ({
    id: chartIds.series.create(),
    role: "normal" as const,
    source: { kind: "indicator" as const, indicatorId: "ind_bands", output },
  }));
  const cell: CellDefinition = {
    ...base,
    panes: [
      { ...base.panes[0]!, series: [...base.panes[0]!.series, ...outputs] },
    ],
  };
  const main = getMainPane(cell);
  const moved = moveSeries(cell, outputs[1]!.id, "new");
  // Price and its default volume stay; only the indicator's outputs move.
  expect(getMainPane(moved).series).toEqual(
    main.series.filter((series) => series.source.kind === "market"),
  );
  expect(moved.panes.at(-1)!.series).toEqual(outputs);
  expect(moved.marketSources).toBe(cell.marketSources);
  const restored = moveSeries(moved, outputs[2]!.id, main.id);
  expect(restored.panes).toEqual(cell.panes);
  expect(moveSeries(restored, outputs[0]!.id, main.id)).toBe(restored);
});

it("preserves link IDs and replaces only direct peers", () => {
  const first = resource();
  const second = addCell(first, createCell(listing("MSFT"), options));
  const linked = linkCells(second, { syncListing: true, syncCrosshair: false });
  const third = addCell(linked, createCell(listing("GOOG"), options));
  expect(third.links).toHaveLength(6);
  expect(third.links).toEqual(expect.arrayContaining([...linked.links]));
  const directOnly = { ...third, links: [third.links[0]!] };
  const next = replaceListing(
    directOnly,
    first.cells[0]!.id,
    listing("NVDA"),
    capabilities,
  );
  expect(next.cells.map((cell) => getMainSource(cell).listing.symbol)).toEqual([
    "NVDA",
    "NVDA",
    "GOOG",
  ]);
  expect(
    addCell({ ...first, preset: "2x2" }, createCell(listing("MSFT"), options))
      .preset,
  ).toBe("2x2");
});

it("keeps session and adjustment within one provider and starts another provider at its default", () => {
  const crypto = {
    resolution: "1d",
    session: "24h",
    adjustment: "raw",
  } as const;
  const offers: BarsCapabilities = [
    { ...options, adjustment: "split", modes: ["history"] },
    { ...crypto, modes: ["history"] },
  ];
  const chart = { ...resource(), cells: [createCell(listing("BTC"), crypto)] };
  const cellId = chart.cells[0]!.id;
  const same = replaceListing(chart, cellId, listing("ETH"), offers);
  expect(same.cells[0]).toMatchObject(crypto);
  const other = replaceListing(
    chart,
    cellId,
    {
      provider: ProviderId.make("other"),
      listing: { symbol: "TSLA", currency: "USD" },
    },
    offers,
  );
  expect(other.cells[0]).toMatchObject({
    resolution: "1d",
    session: "regular",
    adjustment: "split",
  });
});

it("fills missing preset cells from the focused market with fresh IDs and the existing link policy", () => {
  const first = resource();
  const second = createCell(listing("MSFT"), { ...options, resolution: "1h" });
  const linked = linkCells(addCell(first, second), {
    syncListing: false,
    syncCrosshair: true,
  });
  // A previously saved preset can already be larger than its cell count.
  const next = setGridPreset({ ...linked, preset: "2x2" }, "2x2", second.id);
  expect(next.cells.slice(0, 2)).toEqual(linked.cells);
  expect(next.cells.slice(2)).toEqual([
    expect.objectContaining({ resolution: "1h" }),
    expect.objectContaining({ resolution: "1h" }),
  ]);
  expect(
    next.cells.slice(2).map((cell) => getMainSource(cell).listing.symbol),
  ).toEqual(["MSFT", "MSFT"]);
  const ids = next.cells.flatMap((cell) => [
    cell.id,
    ...cell.marketSources.map((source) => source.id),
    ...cell.panes.flatMap((pane) => [
      pane.id,
      ...pane.series.map((series) => series.id),
    ]),
  ]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(next.links).toHaveLength(12);
  expect(next.links).toEqual(expect.arrayContaining([...linked.links]));
  expect(
    next.links.every((link) => link.syncCrosshair && !link.syncListing),
  ).toBe(true);
  expect(setGridPreset(next, "4x4", second.id).cells).toHaveLength(16);
  expect(linked.cells).toHaveLength(2);
  expect(() =>
    setGridPreset({ ...first, cells: [] }, "2x2", undefined),
  ).toThrow("Choose a symbol");
});

it("replaces the captured comparison input, preserves its displays and rejects invalid targets", () => {
  const base = resource();
  const cell = addComparison(base.cells[0]!, listing("MSFT"), capabilities);
  const source = cell.marketSources[1]!;
  const original = { ...base, cells: [cell] };
  const next = replaceMarketSource(
    original,
    cell.id,
    source.id,
    listing("GOOG"),
    capabilities,
  );
  expect(getMainSource(next.cells[0]!).listing.symbol).toBe("AAPL");
  expect(next.cells[0]!.panes).toBe(cell.panes);
  expect(next.cells[0]!.marketSources[1]).toEqual({
    ...source,
    ...listing("GOOG"),
  });
  expect(cell.marketSources[1]!.listing.symbol).toBe("MSFT");
  expect(() =>
    replaceMarketSource(
      original,
      cell.id,
      source.id,
      listing("AAPL"),
      capabilities,
    ),
  ).toThrow("already on this chart");
  expect(() =>
    replaceMarketSource(original, cell.id, source.id, listing("GOOG"), [
      { ...options, resolution: "1m", modes: ["history", "delayed"] },
    ]),
  ).toThrow("does not support");
  expect(() =>
    replaceMarketSource(
      original,
      cell.id,
      "missing",
      listing("GOOG"),
      capabilities,
    ),
  ).toThrow("no longer exists");
  const linked = linkCells(
    addCell(original, createCell(listing("AAPL"), options)),
    { syncListing: true, syncCrosshair: false },
  );
  const changed = replaceMarketSource(
    linked,
    cell.id,
    getMainSource(cell).id,
    listing("NVDA"),
    capabilities,
  );
  expect(
    changed.cells.map((value) => getMainSource(value).listing.symbol),
  ).toEqual(["NVDA", "NVDA"]);
  expect(changed.cells[0]!.marketSources[1]).toBe(source);
});

it("serializes edits and chart commands from separate consumers and reads the revision after the preceding save", async () => {
  const initial = resource();
  const firstSaved = { ...initial, preset: "1x2" as const, revision: 2 };
  const secondSaved = { ...firstSaved, preset: "2x2" as const, revision: 3 };
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const patch = vi
    .fn()
    .mockImplementationOnce(async () => {
      await pending;
      return firstSaved;
    })
    .mockResolvedValueOnce(secondSaved);
  const transport = {
    rpc: { resources: { chart: { patch: { mutate: patch } } } },
  } as unknown as AppTransport;
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chartDetail(transport, initial.id).queryKey,
    initial,
  );
  const indicators = indicatorList(transport, initial.id).queryKey;
  queryClient.setQueryData(indicators, []);
  const first = queryClient
    .getMutationCache()
    .build(queryClient, chartMutation(transport, queryClient, initial.id));
  const second = queryClient
    .getMutationCache()
    .build(queryClient, chartMutation(transport, queryClient, initial.id));
  const firstResult = first.execute((current) => ({
    ...current,
    preset: "1x2",
  }));
  const nextEdit = vi.fn((current: ChartResource): ChartResource => ({
    ...current,
    preset: "2x2",
  }));
  const secondResult = second.execute(nextEdit);
  // A macro such as addIndicator joins the same queue and returns the saved chart.
  const macro = vi.fn(async (current: ChartResource) => ({
    chart: { ...current, preset: "1" as const, revision: current.revision + 1 },
  }));
  const commandResult = queryClient
    .getMutationCache()
    .build(queryClient, chartCommand(transport, queryClient, initial.id))
    .execute(macro);
  await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(nextEdit).not.toHaveBeenCalled();
  expect(macro).not.toHaveBeenCalled();
  release();
  await Promise.all([firstResult, secondResult, commandResult]);
  expect(nextEdit).toHaveBeenCalledWith(firstSaved);
  expect(macro).toHaveBeenCalledWith(secondSaved);
  expect(patch.mock.calls.map(([input]) => input.expectedRevision)).toEqual([
    1, 2,
  ]);
  expect(patch.mock.calls[1]![0].operations).toEqual([
    { op: "replace", path: "/preset", value: "2x2" },
  ]);
  expect(
    queryClient.getQueryData(chartDetail(transport, initial.id).queryKey),
  ).toEqual({ ...secondSaved, preset: "1", revision: 4 });
  expect(queryClient.getQueryState(indicators)?.isInvalidated).toBe(true);
  const noop = queryClient
    .getMutationCache()
    .build(queryClient, chartMutation(transport, queryClient, initial.id));
  await noop.execute((current) => current);
  expect(patch).toHaveBeenCalledTimes(2);
  queryClient.clear();
});
