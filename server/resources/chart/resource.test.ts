// Purpose: Verifies dashboard-filtered chart queries and complete grid persistence through tRPC.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { router } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import type { inferRouterInputs } from "@trpc/server";
import { eq } from "drizzle-orm";
import { ConfigProvider, Effect } from "effect";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";

import { indicatorTable } from "@openchart/server/resources/indicator/schema";

import { chartResource } from "./resource";
import {
  chartTable,
  chartCellTable,
  chartPaneTable,
  chartMarketSourceTable,
  chartSeriesTable,
  chartLinkTable,
} from "./schema";

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;

beforeEach(() => {
  runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  caller = router.createCaller({ runtime });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

function cell(suffix: string) {
  return {
    id: `ccl_${suffix}`,
    marketSources: [
      {
        id: `cms_${suffix}`,
        provider: "yfinance",
        listing: { symbol: "AAPL", currency: "USD" },
      },
    ],
    panes: [
      {
        id: `cpn_${suffix}_volume`,
        series: [
          {
            id: `csr_${suffix}_volume`,
            source: {
              kind: "market",
              marketSourceId: `cms_${suffix}`,
              output: "volume",
            },
          },
        ],
      },
      {
        id: `cpn_${suffix}_price`,
        series: [
          {
            id: `csr_${suffix}_main`,
            role: "main" as const,
            source: {
              kind: "market" as const,
              marketSourceId: `cms_${suffix}`,
              output: "price" as const,
            },
          },
          {
            // Names an Indicator Resource by value; none needs to exist.
            id: `csr_${suffix}_study`,
            source: {
              kind: "indicator" as const,
              indicatorId: `ind_${suffix}`,
              output: "value",
            },
          },
        ],
      },
    ],
  } satisfies NonNullable<
    inferRouterInputs<typeof router>["resources"]["chart"]["create"]["cells"]
  >[number];
}

test("lists complete grids by dashboard, including multiple grids and empty results", async () => {
  const first = await caller.resources.dashboard.create({ name: "First" });
  const second = await caller.resources.dashboard.create({ name: "Second" });
  const empty = await caller.resources.dashboard.create({ name: "Empty" });
  const a = await caller.resources.chart.create({
    dashboardId: first.id,
    cells: [cell("a")],
  });
  const b = await caller.resources.chart.create({
    dashboardId: second.id,
    cells: [cell("b")],
  });
  const c = await caller.resources.chart.create({ dashboardId: first.id });
  expect(chartResource.listKeys).toEqual(["dashboardId"]);
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: first.id } }),
  ).resolves.toEqual({ items: [a, c], nextCursor: null });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: second.id } }),
  ).resolves.toEqual({ items: [b], nextCursor: null });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: empty.id } }),
  ).resolves.toEqual({ items: [], nextCursor: null });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: "dsh_missing" } }),
  ).resolves.toEqual({ items: [], nextCursor: null });
  await expect(caller.resources.chart.list()).resolves.toEqual({
    items: [a, b, c],
    nextCursor: null,
  });
  await expect(caller.resources.chart.list({})).resolves.toEqual({
    items: [a, b, c],
    nextCursor: null,
  });
  await expect(caller.resources.chart.get({ id: a.id })).resolves.toEqual(a);
  expect(a.cells[0]?.panes[0]?.series).toHaveLength(1);
  expect(a.cells[0]?.panes[1]?.series[1]?.source).toEqual({
    kind: "indicator",
    indicatorId: "ind_a",
    output: "value",
  });
  expect(c.cells).toEqual([]);
  type Inputs = inferRouterInputs<typeof router>;
  expectTypeOf<
    Exclude<Inputs["resources"]["chart"]["list"], void>
  >().toEqualTypeOf<{
    readonly filter?: { readonly dashboardId?: string };
    readonly limit?: number;
    readonly cursor?: string;
    readonly order?: "asc" | "desc";
    readonly orderBy?: "createdAt" | "updatedAt";
  }>();
});

test("rejects undeclared filters and invalid filter values at the wire boundary", async () => {
  await expect(
    // @ts-expect-error Only dashboardId is a chart list key.
    caller.resources.chart.list({ filter: { preset: "1" } }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    // @ts-expect-error dashboardId retains its entity field type.
    caller.resources.chart.list({ filter: { dashboardId: 1 } }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.dashboard.list({ filter: { name: "x" } } as never),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(caller.resources.chart.list([] as never)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

test("rejects empty panes and requires moving the last binding and removing its pane atomically", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "Panes" });
  const empty = cell("empty");
  await expect(
    caller.resources.chart.create({
      dashboardId: dashboard.id,
      cells: [
        { ...empty, panes: [{ id: "cpn_empty", series: [] }, empty.panes[1]] },
      ],
    } as never),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  const chart = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("move")],
  });
  const publish = vi.spyOn(await runtime.runPromise(Events.Service), "publish");
  await expect(
    caller.resources.chart.patch({
      id: chart.id,
      expectedRevision: chart.revision,
      operations: [{ op: "remove", path: "/cells/0/panes/0/series/0" }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.resources.chart.get({ id: chart.id })).toEqual(chart);
  expect(publish).not.toHaveBeenCalled();

  const moved = await caller.resources.chart.patch({
    id: chart.id,
    expectedRevision: chart.revision,
    operations: [
      {
        op: "move",
        from: "/cells/0/panes/0/series/0",
        path: "/cells/0/panes/1/series/-",
      },
      { op: "remove", path: "/cells/0/panes/0" },
    ],
  });
  expect(moved.cells[0]!.panes).toHaveLength(1);
  expect(moved.cells[0]!.panes[0]!.series.map((series) => series.id)).toEqual([
    "csr_move_main",
    "csr_move_study",
    "csr_move_volume",
  ]);
  expect(moved.revision).toBe(chart.revision + 1);
  expect(publish).toHaveBeenCalledExactlyOnceWith(ResourceChanged, {
    resource: "chart",
    id: chart.id,
    revision: moved.revision,
  });
});

test("persists complete provider listings and cell adjustment through create and patch", async () => {
  const dashboard = await caller.resources.dashboard.create({
    name: "Markets",
  });
  const listing = {
    id: 101,
    symbol: "AAPL",
    currency: "USD",
    name: "Apple",
    class: "stock" as const,
    mic: "XNAS",
    instrument: { id: "apple", figi: "BBG000B9XRY4" },
  };
  const created = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [
      {
        ...cell("market"),
        marketSources: [
          {
            id: "cms_market",
            provider: "yfinance",
            listing,
          },
        ],
      },
    ],
  });
  expect(created.cells[0]?.adjustment).toBe("raw");
  expect(created.cells[0]?.marketSources[0]).toEqual({
    id: "cms_market",
    provider: "yfinance",
    listing,
  });
  const next = await caller.resources.chart.patch({
    id: created.id,
    expectedRevision: created.revision,
    operations: [
      { op: "replace", path: "/cells/0/adjustment", value: "split_dividend" },
      {
        op: "replace",
        path: "/cells/0/marketSources/0/provider",
        value: "binance",
      },
      {
        op: "replace",
        path: "/cells/0/marketSources/0/listing",
        value: {
          symbol: "BTCUSDT",
          currency: "USDT",
          class: "crypto",
        },
      },
    ],
  });
  expect(next.cells[0]?.adjustment).toBe("split_dividend");
  expect(next.cells[0]?.marketSources[0]?.provider).toBe("binance");
  expect(next.cells[0]?.marketSources[0]?.listing).toEqual({
    symbol: "BTCUSDT",
    currency: "USDT",
    class: "crypto",
  });
  await expect(caller.resources.chart.get({ id: next.id })).resolves.toEqual(
    next,
  );
});

test("saves volume profile settings on their binding and reads absent ones as absent", async () => {
  const dashboard = await caller.resources.dashboard.create({
    name: "Markets",
  });
  const base = cell("profile");
  const profile = (id: string, settings: object) => ({
    id,
    source: {
      kind: "market" as const,
      marketSourceId: "cms_profile",
      output: "volumeProfile" as const,
    },
    ...settings,
  });
  const created = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [
      {
        ...base,
        panes: [
          base.panes[0]!,
          {
            ...base.panes[1]!,
            series: [
              ...base.panes[1]!.series,
              profile("csr_chosen", { resolution: "15m", rows: 50 }),
              profile("csr_default", {}),
            ],
          },
        ],
      },
    ],
  });
  const series = () => created.cells[0]!.panes[1]!.series;
  expect(series().slice(-2)).toEqual([
    {
      ...profile("csr_chosen", { resolution: "15m", rows: 50 }),
      role: "normal",
    },
    { ...profile("csr_default", {}), role: "normal" },
  ]);
  const next = await caller.resources.chart.patch({
    id: created.id,
    expectedRevision: created.revision,
    operations: [
      {
        op: "replace",
        path: "/cells/0/panes/1/series/2",
        value: profile("csr_chosen", { rows: 12 }),
      },
    ],
  });
  expect(next.cells[0]!.panes[1]!.series[2]).toEqual({
    ...profile("csr_chosen", { rows: 12 }),
    role: "normal",
  });
  await expect(caller.resources.chart.get({ id: next.id })).resolves.toEqual(
    next,
  );
});

test("filters roots before assembling unrelated grids", async () => {
  const a = await caller.resources.dashboard.create({ name: "A" });
  const b = await caller.resources.dashboard.create({ name: "B" });
  const wanted = await caller.resources.chart.create({ dashboardId: a.id });
  const unrelated = await caller.resources.chart.create({
    dashboardId: b.id,
    cells: [cell("corrupt")],
  });
  // SQLite enforces at most one main series; the entity enforces its existence.
  // An unrelated invalid grid must not be assembled by A's filtered query.
  await runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      yield* db.transaction((tx) =>
        tx
          .delete(chartSeriesTable)
          .where(eq(chartSeriesTable.id, "csr_corrupt_main")),
      );
    }),
  );
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: a.id } }),
  ).resolves.toEqual({ items: [wanted], nextCursor: null });
  await expect(
    caller.resources.chart.get({ id: unrelated.id }),
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
});

test("moves grids between dashboards and preserves child ids, order, and links on save", async () => {
  const a = await caller.resources.dashboard.create({ name: "A" });
  const b = await caller.resources.dashboard.create({ name: "B" });
  const created = await caller.resources.chart.create({
    dashboardId: a.id,
    preset: "1x2",
    cells: [cell("left"), cell("right")],
    links: [
      {
        id: "clk_z",
        fromCellId: "ccl_left",
        toCellId: "ccl_right",
        syncListing: true,
      },
      {
        id: "clk_a",
        fromCellId: "ccl_right",
        toCellId: "ccl_left",
        syncCrosshair: true,
      },
    ],
  });
  expect(created.links.map((link) => link.id)).toEqual(["clk_a", "clk_z"]);
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const patched = await caller.resources.chart.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [
      { op: "replace", path: "/dashboardId", value: b.id },
      { op: "replace", path: "/preset", value: "1" },
      { op: "move", from: "/cells/0", path: "/cells/1" },
      { op: "move", from: "/cells/0/panes/0", path: "/cells/0/panes/1" },
      {
        op: "move",
        from: "/cells/0/panes/0/series/0",
        path: "/cells/0/panes/0/series/1",
      },
    ],
  });
  expect(patched.revision).toBe(2);
  expect(patched.createdAt).toBe(created.createdAt);
  expect(patched.cells.map((item) => item.id)).toEqual([
    "ccl_right",
    "ccl_left",
  ]);
  expect(patched.cells[0]?.panes[0]?.series.map((item) => item.id)).toEqual([
    "csr_right_study",
    "csr_right_main",
  ]);
  expect(patched.links).toEqual(created.links);
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: a.id } }),
  ).resolves.toEqual({ items: [], nextCursor: null });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: b.id } }),
  ).resolves.toEqual({ items: [patched], nextCursor: null });
  expect(publish).toHaveBeenCalledExactlyOnceWith(ResourceChanged, {
    resource: "chart",
    id: created.id,
    revision: 2,
  });
  await expect(
    caller.resources.chart.patch({
      id: created.id,
      expectedRevision: 1,
      operations: [{ op: "replace", path: "/preset", value: "1" }],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await caller.resources.chart.delete({ id: created.id });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: b.id } }),
  ).resolves.toEqual({ items: [], nextCursor: null });
  await expect(
    caller.resources.chart.get({ id: created.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("rolls back replacement, revision, and events when a child write fails", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "A" });
  const original = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("original")],
  });
  const other = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("other")],
  });
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  await expect(
    caller.resources.chart.patch({
      id: original.id,
      expectedRevision: 1,
      operations: [{ op: "replace", path: "/cells/0/id", value: "ccl_other" }],
    }),
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: dashboard.id } }),
  ).resolves.toEqual({ items: [original, other], nextCursor: null });
  expect(publish).not.toHaveBeenCalled();
});

test("dashboard cascade removes every chart table and Indicator and publishes their invalidations", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "A" });
  const chart = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("a"), cell("b")],
    links: [{ id: "clk_ab", fromCellId: "ccl_a", toCellId: "ccl_b" }],
  });
  const indicator = await caller.resources.indicator.create({
    chartId: chart.id,
    cellId: "ccl_a",
    source: { workspaceId: "wsp_test", path: "main.tea" },
    snapshot: { "main.tea": 'emit "v" close' },
    parameterOverrides: {},
  });
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  await caller.resources.dashboard.delete({ id: dashboard.id });
  await expect(
    caller.resources.chart.list({ filter: { dashboardId: dashboard.id } }),
  ).resolves.toEqual({ items: [], nextCursor: null });
  expect(publish).toHaveBeenCalledWith(ResourceChanged, {
    resource: "chart",
    id: chart.id,
    revision: 1,
  });
  expect(publish).toHaveBeenCalledWith(ResourceChanged, {
    resource: "indicator",
    id: indicator.id,
    revision: 1,
  });
  await expect(
    caller.resources.indicator.get({ id: indicator.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      for (const table of [
        chartTable,
        chartCellTable,
        chartPaneTable,
        chartMarketSourceTable,
        chartSeriesTable,
        chartLinkTable,
        indicatorTable,
      ]) {
        expect(yield* db.select().from(table)).toEqual([]);
      }
    }),
  );
});
