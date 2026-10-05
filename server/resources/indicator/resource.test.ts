// Purpose: Verify Indicator CRUD, snapshot limits and chart ownership through the actual Resource router.
import { router } from "@openchart/server";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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

function study(suffix: string, indicatorId: string) {
  return {
    id: `csr_${suffix}_study`,
    source: { kind: "indicator" as const, indicatorId, output: "value" },
  };
}

function cell(suffix: string, ...studies: ReturnType<typeof study>[]) {
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
        id: `cpn_${suffix}`,
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
          ...studies,
        ] as const,
      },
    ],
  };
}

function indicator(chartId: string, cellId: string) {
  return {
    chartId,
    cellId,
    source: { workspaceId: "wsp_test", path: "sma.tea" },
    snapshot: {
      "sma.tea": 'import "lib/avg.tea"\nplot(avg(close))',
      "lib/avg.tea": "export avg(x) => x",
    },
    parameterOverrides: { length: 20, show: true, mode: "fast" },
  };
}

function files(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      index === 0 ? "sma.tea" : `lib/${index}.tea`,
      "plot(close)",
    ]),
  );
}

async function chartWithCell(suffix: string) {
  const dashboard = await caller.resources.dashboard.create({ name: suffix });
  const chart = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell(suffix)],
  });
  return { dashboard, chart };
}

async function spyOnPublish() {
  return vi.spyOn(await runtime.runPromise(Events.Service), "publish");
}

test("indicators are independent Resources listed by their chart", async () => {
  const { dashboard, chart } = await chartWithCell("a");
  const other = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("b")],
  });
  const first = await caller.resources.indicator.create(
    indicator(chart.id, "ccl_a"),
  );
  const second = await caller.resources.indicator.create(
    indicator(chart.id, "ccl_a"),
  );
  const elsewhere = await caller.resources.indicator.create(
    indicator(other.id, "ccl_b"),
  );
  expect(first.id).toMatch(/^ind_/);
  expect(first).toMatchObject({ ...indicator(chart.id, "ccl_a"), revision: 1 });
  await expect(
    caller.resources.indicator.get({ id: first.id }),
  ).resolves.toEqual(first);
  await expect(
    caller.resources.indicator.list({ filter: { chartId: chart.id } }),
  ).resolves.toEqual({ items: [first, second], nextCursor: null });
  await expect(
    caller.resources.indicator.list({ filter: { chartId: other.id } }),
  ).resolves.toEqual({ items: [elsewhere], nextCursor: null });

  const patched = await caller.resources.indicator.patch({
    id: first.id,
    expectedRevision: first.revision,
    operations: [
      { op: "replace", path: "/parameterOverrides/length", value: 50 },
    ],
  });
  expect(patched.revision).toBe(2);
  expect(patched.parameterOverrides).toEqual({
    length: 50,
    show: true,
    mode: "fast",
  });
  await expect(
    caller.resources.indicator.patch({
      id: first.id,
      expectedRevision: first.revision,
      operations: [{ op: "replace", path: "/parameterOverrides", value: {} }],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  await caller.resources.indicator.delete({ id: first.id });
  await expect(
    caller.resources.indicator.get({ id: first.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller.resources.indicator.list({ filter: { chartId: chart.id } }),
  ).resolves.toEqual({ items: [second], nextCursor: null });
});

test("rejects a snapshot without its script or beyond the snapshot limits", async () => {
  const { chart } = await chartWithCell("a");
  const body = indicator(chart.id, "ccl_a");
  const missingScript = {
    code: "BAD_REQUEST",
    cause: expect.objectContaining({
      issues: [
        expect.objectContaining({
          code: "indicator.snapshot_entry",
          path: "/snapshot",
        }),
      ],
    }),
  };
  await expect(
    caller.resources.indicator.create({
      ...body,
      snapshot: { "lib/avg.tea": "export avg(x) => x" },
    }),
  ).rejects.toMatchObject(missingScript);
  for (const snapshot of [
    files(33),
    { ...files(1), "lib/big.tea": "x".repeat(65537) },
  ]) {
    await expect(
      caller.resources.indicator.create({ ...body, snapshot }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  await expect(caller.resources.indicator.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });

  const largest = await caller.resources.indicator.create({
    ...body,
    snapshot: { ...files(32), "sma.tea": "x".repeat(65536) },
  });
  expect(Object.keys(largest.snapshot)).toHaveLength(32);
  await expect(
    caller.resources.indicator.patch({
      id: largest.id,
      expectedRevision: largest.revision,
      operations: [{ op: "remove", path: "/snapshot/sma.tea" }],
    }),
  ).rejects.toMatchObject(missingScript);
  await expect(
    caller.resources.indicator.get({ id: largest.id }),
  ).resolves.toEqual(largest);
});

test("chart saves that reinsert every cell leave the Indicator untouched", async () => {
  const { chart } = await chartWithCell("a");
  const created = await caller.resources.indicator.create(
    indicator(chart.id, "ccl_a"),
  );
  const publish = await spyOnPublish();
  const saved = await caller.resources.chart.patch({
    id: chart.id,
    expectedRevision: chart.revision,
    operations: [{ op: "replace", path: "/cells", value: chart.cells }],
  });
  expect(saved.revision).toBe(chart.revision + 1);
  await expect(
    caller.resources.indicator.get({ id: created.id }),
  ).resolves.toEqual(created);
  expect(publish).not.toHaveBeenCalledWith(
    ResourceChanged,
    expect.objectContaining({ resource: "indicator" }),
  );
});

test("deleting a chart or its dashboard deletes its Indicators and publishes their invalidations", async () => {
  const { dashboard, chart } = await chartWithCell("a");
  const sibling = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("b")],
  });
  const owned = await caller.resources.indicator.create(
    indicator(chart.id, "ccl_a"),
  );
  const survivor = await caller.resources.indicator.create(
    indicator(sibling.id, "ccl_b"),
  );
  const publish = await spyOnPublish();

  await caller.resources.chart.delete({ id: chart.id });
  await expect(
    caller.resources.indicator.get({ id: owned.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller.resources.indicator.get({ id: survivor.id }),
  ).resolves.toEqual(survivor);
  expect(publish).toHaveBeenCalledWith(ResourceChanged, {
    resource: "indicator",
    id: owned.id,
    revision: owned.revision,
  });

  await caller.resources.dashboard.delete({ id: dashboard.id });
  await expect(caller.resources.indicator.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
  expect(publish).toHaveBeenCalledWith(ResourceChanged, {
    resource: "indicator",
    id: survivor.id,
    revision: survivor.revision,
  });
});

test("series bindings name an Indicator by value, without requiring it to exist", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "A" });
  const dangling = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("a", study("a", "ind_missing"))],
  });
  expect(dangling.cells[0]?.panes[0]?.series[1]?.source).toEqual({
    kind: "indicator",
    indicatorId: "ind_missing",
    output: "value",
  });

  const bound = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [cell("b")],
  });
  const created = await caller.resources.indicator.create(
    indicator(bound.id, "ccl_b"),
  );
  const paired = await caller.resources.chart.patch({
    id: bound.id,
    expectedRevision: bound.revision,
    operations: [
      {
        op: "add",
        path: "/cells/0/panes/0/series/1",
        value: study("b", created.id),
      },
    ],
  });
  await caller.resources.indicator.delete({ id: created.id });
  await expect(caller.resources.chart.get({ id: bound.id })).resolves.toEqual(
    paired,
  );
});
