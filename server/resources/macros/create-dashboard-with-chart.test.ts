// Purpose: Verify the default Dashboard RPC persists a complete Chart or nothing.

import { router } from "@openchart/server";
import { Events } from "@openchart/server/events";
import { Feed } from "@openchart/server/feed/service";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transition } from "@openchart/server/lib/resource";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider, Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;

beforeEach(() => {
  runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({
      providers: { binance: { enabled: false }, yfinance: { enabled: false } },
    }),
    models: { fetchEnabled: false, userAgent: "dashboard-create-test" },
  });
  caller = router.createCaller({ runtime });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

test("creates and returns a persisted Binance BTCUSDT Chart and placement without Feed access", async () => {
  const feed = await runtime.runPromise(Feed.use((service) => service.get()));
  const search = vi.spyOn(feed.symbology, "search");
  const capabilities = vi.spyOn(feed.bars, "getCapabilities");
  const observe = vi.spyOn(feed.bars, "observe");
  const { dashboard, chart } =
    await caller.resources.macro.createDashboardWithChart();

  expect(dashboard).toMatchObject({
    name: "New dashboard",
    favorite: false,
    revision: 2,
    widgets: [
      {
        kind: "chart",
        resourceId: chart.id,
        layout: { x: 0, y: 0, w: 12, h: 24 },
      },
    ],
  });
  expect(chart).toMatchObject({
    dashboardId: dashboard.id,
    revision: 1,
    preset: "1",
    links: [],
    cells: [
      {
        resolution: "1d",
        session: "24h",
        adjustment: "raw",
        marketSources: [
          {
            provider: "binance",
            listing: {
              symbol: "BTCUSDT",
              class: "crypto",
              currency: "USDT",
            },
          },
        ],
        panes: [
          {
            series: [
              {
                role: "main",
                source: { kind: "market", output: "price" },
              },
              {
                role: "normal",
                source: { kind: "market", output: "volume" },
              },
            ],
          },
        ],
      },
    ],
  });
  const cell = chart.cells[0]!;
  expect(cell.panes[0]!.series.map((series) => series.source)).toEqual([
    {
      kind: "market",
      marketSourceId: cell.marketSources[0]!.id,
      output: "price",
    },
    {
      kind: "market",
      marketSourceId: cell.marketSources[0]!.id,
      output: "volume",
    },
  ]);
  await expect(
    caller.resources.dashboard.get({ id: dashboard.id }),
  ).resolves.toEqual(dashboard);
  await expect(caller.resources.chart.get({ id: chart.id })).resolves.toEqual(
    chart,
  );
  expect(search).not.toHaveBeenCalled();
  expect(capabilities).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
});

test("each call creates independent Resources and ordinary Dashboard create remains empty", async () => {
  const first = await caller.resources.macro.createDashboardWithChart();
  const second = await caller.resources.macro.createDashboardWithChart();
  expect(second.dashboard.id).not.toBe(first.dashboard.id);
  expect(second.chart.id).not.toBe(first.chart.id);
  expect(second.dashboard.widgets[0]!.resourceId).toBe(second.chart.id);
  expect(second.chart.dashboardId).toBe(second.dashboard.id);
  const empty = await caller.resources.dashboard.create({ name: "Empty" });
  expect(empty.widgets).toEqual([]);
  expect(
    await caller.resources.chart.list({ filter: { dashboardId: empty.id } }),
  ).toEqual({
    items: [],
    nextCursor: null,
  });
});

test("a failure after placement write rolls back all Resources and publishes no changes", async () => {
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const patch = dashboardResource.transitions.patch;
  vi.spyOn(dashboardResource.transitions, "patch").mockImplementationOnce(
    (input) =>
      Transition.from((tx) =>
        patch(input)
          .apply(tx, undefined)
          .pipe(
            Effect.andThen(Effect.die(new Error("Injected write failure"))),
          ),
      ),
  );

  await expect(
    caller.resources.macro.createDashboardWithChart(),
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  expect(await caller.resources.dashboard.list()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(await caller.resources.chart.list()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(publish).not.toHaveBeenCalled();
});
