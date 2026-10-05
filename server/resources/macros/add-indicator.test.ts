// Purpose: Verify addIndicator creates an Indicator and binds its outputs in one chart revision through the public RPC.
import { router } from "@openchart/server";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea";
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

async function createChart() {
  const dashboard = await caller.resources.dashboard.create({
    name: "Research",
  });
  return caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [
      {
        id: "ccl_a",
        marketSources: [
          {
            id: "cms_a",
            provider: "yfinance",
            listing: { symbol: "AAPL", currency: "USD" },
          },
        ],
        panes: [
          {
            id: "cpn_a",
            series: [
              {
                id: "csr_main",
                role: "main",
                source: {
                  kind: "market",
                  marketSourceId: "cms_a",
                  output: "price",
                },
              },
            ],
          },
        ],
      },
    ],
  });
}

const binding = (indicatorId: string, output: string) => ({
  id: expect.stringMatching(/^csr_/),
  role: "normal",
  source: { kind: "indicator", indicatorId, output },
});

test("an overlay extends the main pane; any other script gets one new pane holding every output", async () => {
  const chart = await createChart();
  const bands = await caller.indicators.install({ id: "bollinger-bands" });
  const overlay = await caller.resources.macro.addIndicator({
    chartId: chart.id,
    expectedRevision: chart.revision,
    cellId: "ccl_a",
    source: bands,
    parameterOverrides: { length: 10 },
  });
  const file = await caller.workspace.read(bands);
  expect(overlay.indicator).toMatchObject({
    id: expect.stringMatching(/^ind_/),
    revision: 1,
    chartId: chart.id,
    cellId: "ccl_a",
    source: bands,
    parameterOverrides: { length: 10 },
  });
  expect(overlay.indicator.snapshot).toEqual({
    [bands.path]: Buffer.from(file.base64, "base64").toString("utf8"),
  });
  const [main] = chart.cells[0]!.panes;
  expect(overlay.chart.revision).toBe(chart.revision + 1);
  expect(overlay.chart.cells[0]!.panes).toEqual([
    {
      ...main,
      series: [
        ...main!.series,
        ...["basis", "upper", "lower"].map((output) =>
          binding(overlay.indicator.id, output),
        ),
      ],
    },
  ]);

  const macd = await caller.indicators.install({ id: "macd" });
  const separate = await caller.resources.macro.addIndicator({
    chartId: chart.id,
    expectedRevision: overlay.chart.revision,
    cellId: "ccl_a",
    source: macd,
    parameterOverrides: {},
  });
  expect(separate.chart.cells[0]!.panes).toEqual([
    overlay.chart.cells[0]!.panes[0],
    {
      id: expect.stringMatching(/^cpn_/),
      series: ["macd", "signal", "histogram"].map((output) =>
        binding(separate.indicator.id, output),
      ),
    },
  ]);
  await expect(caller.resources.chart.get({ id: chart.id })).resolves.toEqual(
    separate.chart,
  );
  await expect(
    caller.resources.indicator.list({ filter: { chartId: chart.id } }),
  ).resolves.toEqual({
    items: [overlay.indicator, separate.indicator],
    nextCursor: null,
  });
});

test("stale revisions, missing cells, unknown overrides and header-less scripts write nothing", async () => {
  const chart = await createChart();
  const sma = await caller.indicators.install({ id: "sma" });
  const plain = await caller.workspace.write({
    workspaceId: sma.workspaceId,
    path: "plain.tea",
    text: 'plot("value", close, "Value")\n',
    expected: null,
  });
  const tea = await runtime.runPromise(Tea.Service);
  const compile = vi.spyOn(tea, "compile");
  const dispose = vi.spyOn(tea, "dispose");
  const publish = vi.spyOn(await runtime.runPromise(Events.Service), "publish");
  const input = {
    chartId: chart.id,
    expectedRevision: chart.revision,
    cellId: "ccl_a",
    source: sma,
    parameterOverrides: {},
  };
  const rejections = [
    [{ expectedRevision: chart.revision + 1 }, "CONFLICT", "chart"],
    [{ cellId: "ccl_missing" }, "NOT_FOUND", "chart_cell ccl_missing"],
    [{ parameterOverrides: { missing: 1 } }, "BAD_REQUEST", "“missing”"],
    [
      { source: { workspaceId: sma.workspaceId, path: plain.path } },
      "BAD_REQUEST",
      "indicator() declaration",
    ],
  ] as const;
  for (const [change, code, message] of rejections)
    await expect(
      caller.resources.macro.addIndicator({ ...input, ...change }),
    ).rejects.toMatchObject({
      code,
      message: expect.stringContaining(message),
    });
  expect(compile).toHaveBeenCalledTimes(rejections.length);
  expect(dispose).toHaveBeenCalledTimes(rejections.length);
  await expect(caller.resources.chart.get({ id: chart.id })).resolves.toEqual(
    chart,
  );
  await expect(caller.resources.indicator.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
  expect(publish).not.toHaveBeenCalled();
});
