// Purpose: Verify removeIndicator drops an Indicator with its bindings atomically through the public RPC.
import { router } from "@openchart/server";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { indicatorResource } from "@openchart/server/resources/indicator";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider, Effect } from "effect";
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

/** A chart whose one cell has a main pane and an independent volume pane. */
async function createChart(suffix: string) {
  const dashboard = await caller.resources.dashboard.create({ name: suffix });
  return caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [
      {
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
            id: `cpn_${suffix}_main`,
            series: [
              {
                id: `csr_${suffix}_main`,
                role: "main",
                source: {
                  kind: "market",
                  marketSourceId: `cms_${suffix}`,
                  output: "price",
                },
              },
            ],
          },
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
        ],
      },
    ],
  });
}

async function addIndicator(
  chart: { id: string; revision: number },
  suffix: string,
  id: string,
) {
  return caller.resources.macro.addIndicator({
    chartId: chart.id,
    expectedRevision: chart.revision,
    cellId: `ccl_${suffix}`,
    source: await caller.indicators.install({ id }),
    parameterOverrides: {},
  });
}

test("drops the Indicator, its bindings and only the pane it emptied in one chart revision", async () => {
  const chart = await createChart("a");
  const bands = await addIndicator(chart, "a", "bollinger-bands");
  const macd = await addIndicator(bands.chart, "a", "macd");
  expect(macd.chart.cells[0]!.panes).toHaveLength(3);

  const withoutMacd = await caller.resources.macro.removeIndicator({
    chartId: chart.id,
    expectedRevision: macd.chart.revision,
    indicatorId: macd.indicator.id,
  });
  expect(withoutMacd.chart).toEqual({
    ...bands.chart,
    revision: macd.chart.revision + 1,
    updatedAt: expect.any(Number),
  });
  await expect(
    caller.resources.indicator.get({ id: macd.indicator.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });

  const withoutBands = await caller.resources.macro.removeIndicator({
    chartId: chart.id,
    expectedRevision: withoutMacd.chart.revision,
    indicatorId: bands.indicator.id,
  });
  expect(withoutBands.chart.cells).toEqual(chart.cells);
  await expect(caller.resources.chart.get({ id: chart.id })).resolves.toEqual(
    withoutBands.chart,
  );
  await expect(caller.resources.indicator.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
});

test("stale revisions, another chart's Indicator and a failed delete change nothing", async () => {
  const a = await createChart("a");
  const b = await createChart("b");
  const own = await addIndicator(a, "a", "sma");
  const foreign = await addIndicator(b, "b", "sma");
  const publish = vi.spyOn(await runtime.runPromise(Events.Service), "publish");
  await expect(
    caller.resources.macro.removeIndicator({
      chartId: a.id,
      expectedRevision: a.revision,
      indicatorId: own.indicator.id,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller.resources.macro.removeIndicator({
      chartId: a.id,
      expectedRevision: own.chart.revision,
      indicatorId: foreign.indicator.id,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const remove = vi
    .spyOn(indicatorResource.store, "remove")
    .mockReturnValue(Effect.die("delete failed"));
  await expect(
    caller.resources.macro.removeIndicator({
      chartId: a.id,
      expectedRevision: own.chart.revision,
      indicatorId: own.indicator.id,
    }),
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  remove.mockRestore();

  await expect(caller.resources.chart.get({ id: a.id })).resolves.toEqual(
    own.chart,
  );
  await expect(caller.resources.chart.get({ id: b.id })).resolves.toEqual(
    foreign.chart,
  );
  await expect(caller.resources.indicator.list()).resolves.toEqual({
    items: [own.indicator, foreign.indicator],
    nextCursor: null,
  });
  expect(publish).not.toHaveBeenCalled();
});
