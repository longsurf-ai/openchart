// Purpose: Verifies atomic Chart creation and Dashboard placement through the public RPC.

import { router } from "@openchart/server";
import { Events } from "@openchart/server/events";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { ConfigProvider } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;
const layout = { x: 0, y: 0, w: 12, h: 16 };

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

test("creates both Resources with one owning revision and leaves Chart intact when removing its placement", async () => {
  const before = await caller.resources.dashboard.create({ name: "Research" });
  const result = await caller.resources.macro.createChartWidget({
    dashboardId: before.id,
    expectedRevision: 1,
    chart: {},
    widgets: before.widgets,
    layout,
  });
  expect(result.chart).toMatchObject({
    dashboardId: before.id,
    revision: 1,
    preset: "1",
    cells: [],
    links: [],
  });
  expect(result.dashboard).toMatchObject({
    id: before.id,
    revision: 2,
    widgets: [
      {
        id: expect.stringMatching(/^wdg_/),
        kind: "chart",
        resourceId: result.chart.id,
        layout,
      },
    ],
  });
  await expect(
    caller.resources.dashboard.get({ id: before.id }),
  ).resolves.toEqual(result.dashboard);
  await expect(
    caller.resources.chart.get({ id: result.chart.id }),
  ).resolves.toEqual(result.chart);
  await caller.resources.dashboard.patch({
    id: before.id,
    expectedRevision: 2,
    operations: [{ op: "remove", path: "/widgets/0" }],
  });
  await expect(
    caller.resources.chart.get({ id: result.chart.id }),
  ).resolves.toEqual(result.chart);
});

test("stale revisions and overlapping placements roll back new Charts and publish no changes", async () => {
  const before = await caller.resources.dashboard.create({ name: "Research" });
  const first = await caller.resources.macro.createChartWidget({
    dashboardId: before.id,
    expectedRevision: 1,
    chart: {},
    widgets: before.widgets,
    layout,
  });
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  for (const [expectedRevision, code] of [
    [1, "CONFLICT"],
    [2, "BAD_REQUEST"],
  ] as const) {
    await expect(
      caller.resources.macro.createChartWidget({
        dashboardId: before.id,
        expectedRevision,
        chart: {},
        widgets: first.dashboard.widgets,
        layout,
      }),
    ).rejects.toMatchObject({ code });
    await expect(caller.resources.chart.list()).resolves.toEqual({
      items: [first.chart],
      nextCursor: null,
    });
    await expect(
      caller.resources.dashboard.get({ id: before.id }),
    ).resolves.toEqual(first.dashboard);
    expect(publish).not.toHaveBeenCalled();
  }
});

test("rejects an invalid Chart at the boundary, preserving its existing relational invariants", async () => {
  const before = await caller.resources.dashboard.create({ name: "Research" });
  await expect(
    caller.resources.macro.createChartWidget({
      dashboardId: before.id,
      expectedRevision: 1,
      chart: { cells: [{ id: "ccl_invalid", marketSources: [], panes: [] }] },
      widgets: before.widgets,
      layout,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(caller.resources.chart.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
  await expect(
    caller.resources.dashboard.get({ id: before.id }),
  ).resolves.toEqual(before);
  await expect(
    caller.resources.macro.createChartWidget({
      dashboardId: "dsh_missing",
      expectedRevision: 1,
      chart: {},
      widgets: [],
      layout,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("adds the default BTC chart and splits the first placement atomically, preserving it on conflict", async () => {
  const before = await caller.resources.macro.createDashboardWithChart();
  const widgets = before.dashboard.widgets.map((widget) => ({
    ...widget,
    layout: { x: 0, y: 0, w: 6, h: 24 },
  }));
  const input = {
    dashboardId: before.dashboard.id,
    expectedRevision: before.dashboard.revision,
    widgets,
    layout: { x: 6, y: 0, w: 6, h: 24 },
  };
  await expect(
    caller.resources.macro.createChartWidget({
      ...input,
      layout: widgets[0]!.layout,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await caller.resources.dashboard.get({ id: before.dashboard.id }),
  ).toEqual(before.dashboard);
  expect((await caller.resources.chart.list()).items).toEqual([before.chart]);

  const added = await caller.resources.macro.createChartWidget(input);
  expect(added.dashboard.widgets).toEqual([
    widgets[0],
    expect.objectContaining({
      resourceId: added.chart.id,
      layout: input.layout,
    }),
  ]);
  expect(added.chart.cells[0]).toMatchObject({
    resolution: "1d",
    marketSources: [
      expect.objectContaining({
        provider: "binance",
        listing: expect.objectContaining({ symbol: "BTCUSDT" }),
      }),
    ],
  });
  expect(added.chart.id).not.toBe(before.chart.id);
  await expect(
    caller.resources.macro.createChartWidget(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await caller.resources.dashboard.get({ id: before.dashboard.id }),
  ).toEqual(added.dashboard);
  expect((await caller.resources.chart.list()).items).toHaveLength(2);
});
