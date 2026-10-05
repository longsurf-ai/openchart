// Purpose: Keep the shipped historical snapshot usable through ordinary migrations and services.

import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { starterWorkflow } from "@openchart/app/app/trellis/workflows/starter/workflow";
import { router } from "@openchart/server";
import { Session } from "@openchart/server/agent/session";
import { drawingTeaDefinition } from "@openchart/server/alert/drawing-alerts";
import { migrations } from "@openchart/server/db/migration.gen";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea/tea";
import { ConfigProvider, Effect, Schema } from "effect";
import { expect, test, vi } from "vitest";

import { prepareOnboardingContent } from "./content";

test.each(["", "existing database bytes"])(
  "never opens or replaces an existing database (%j)",
  async (bytes) => {
    const home = temporaryHome();
    const filename = join(home, "openchart.sqlite3");
    await writeFile(filename, bytes);
    expect(await prepareOnboardingContent(home)).toBeUndefined();
    expect(await readFile(filename, "utf8")).toBe(bytes);
    expect(await readdir(home)).toEqual(["openchart.sqlite3"]);
  },
);

test("concurrent first launches publish exactly one complete snapshot", async () => {
  const home = temporaryHome();
  const results = await Promise.all([
    prepareOnboardingContent(home),
    prepareOnboardingContent(home),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await readdir(home)).sort()).toEqual([
    "openchart.sqlite3",
    "workspaces",
  ]);
  const database = new DatabaseSync(join(home, "openchart.sqlite3"));
  try {
    expect(database.prepare("PRAGMA integrity_check").all()).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.exec("DELETE FROM dashboard_widget; DELETE FROM dashboard;");
  } finally {
    database.close();
  }
  const bytes = await readFile(join(home, "openchart.sqlite3"));
  expect(await prepareOnboardingContent(home)).toBeUndefined();
  expect(await readFile(join(home, "openchart.sqlite3"))).toEqual(bytes);
});

test("a new profile owns editable starter studies that compile without market data", async () => {
  const home = temporaryHome();
  const studies = join(home, "workspaces", "default", "studies");
  await mkdir(studies, { recursive: true });
  await writeFile(join(studies, "sector-rotation.tea"), "// edited");
  await prepareOnboardingContent(home);
  expect((await readdir(studies)).sort()).toEqual([
    "sector-rotation.tea",
    "semiconductor-leaders.tea",
  ]);
  // A file the user already has is never replaced.
  expect(await readFile(join(studies, "sector-rotation.tea"), "utf8")).toBe(
    "// edited",
  );
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
    models: { fetchEnabled: false },
  });
  try {
    const targets = await runtime.runPromise(
      Effect.forEach(
        ["semiconductor-leaders.tea", "sector-rotation.tea"],
        (name) =>
          Effect.gen(function* () {
            const tea = yield* Tea.Service;
            const source = yield* Effect.promise(() =>
              readFile(join(import.meta.dirname, "studies", name), "utf8"),
            );
            const node = yield* tea.compile({
              entry: name,
              sources: { [name]: source },
            });
            yield* tea.dispose({ id: node.id });
            return Object.values(node.definition.requests).map(
              ({ target }) => target?.symbol,
            );
          }),
      ),
    );
    expect(targets[0]).toHaveLength(22);
    expect(targets[0]).toEqual(
      expect.arrayContaining(["yfinance:SMH", "yfinance:NVDA", "yfinance:TER"]),
    );
    expect(targets[1]).toEqual([
      "yfinance:SPY",
      ...["XLI", "XLK", "XLF", "XLP", "XLV", "XLE", "SMH", "QQQ", "IGV"].map(
        (symbol) => `yfinance:${symbol}`,
      ),
    ]);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

test("an interrupted import leaves no database and can retry", async () => {
  const home = temporaryHome();
  const exec = vi
    .spyOn(DatabaseSync.prototype, "exec")
    .mockImplementationOnce(() => {
      throw new Error("interrupted import");
    });
  try {
    await expect(prepareOnboardingContent(home)).rejects.toThrow(
      "interrupted import",
    );
    expect(await readdir(home)).toEqual([]);
  } finally {
    exec.mockRestore();
  }
  expect(await prepareOnboardingContent(home)).toBeDefined();
});

test("the template contains only reviewed English content and a historical ledger", async () => {
  const home = temporaryHome();
  await prepareOnboardingContent(home);
  const database = new DatabaseSync(join(home, "openchart.sqlite3"), {
    readOnly: true,
  });
  try {
    const populated = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .filter(({ name }) => {
        return (
          database.prepare(`SELECT 1 FROM "${String(name)}" LIMIT 1`).get() !==
          undefined
        );
      })
      .map(({ name }) => name);
    expect(populated.sort()).toEqual(
      [
        "agent_messages",
        "agent_parts",
        "agent_session_bindings",
        "agent_sessions",
        "alert_rule",
        "app_schema_migrations",
        "chart",
        "chart_cell",
        "chart_market_source",
        "chart_pane",
        "chart_series",
        "dashboard",
        "dashboard_widget",
        "drawing",
        "indicator",
        "trigger",
        "workspace",
      ].sort(),
    );
    expect(
      database
        .prepare(
          "SELECT id FROM app_schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ id: "20260927213244_indicator-resource" });
    const content = await readFile(
      new URL("./onboarding-content.sql", import.meta.url),
      "utf8",
    );
    expect(content).not.toMatch(/[\p{Script=Han}]/u);
    expect(content).not.toMatch(
      /\/Users\/|\/home\/|Bearer |\bsk-[A-Za-z0-9]{20}|api_key/i,
    );
    expect(
      database
        .prepare(
          "SELECT DISTINCT json_extract(data, '$.type') AS type FROM agent_parts",
        )
        .all(),
    ).toEqual([{ type: "plugin_input" }, { type: "text" }]);
  } finally {
    database.close();
  }
});

test("normal startup migrates the template and reads the chart, actions, and linked transcript", async () => {
  const home = join(temporaryHome(), "a user's profile");
  const view = await prepareOnboardingContent(home);
  const runtime = makeRuntime({
    home,
    config: ConfigProvider.fromUnknown({}),
    models: { fetchEnabled: false },
  });
  const caller = router.createCaller({ runtime });
  try {
    const dashboards = await caller.resources.dashboard.list();
    expect(dashboards.items).toHaveLength(1);
    const dashboard = dashboards.items[0]!;
    expect(dashboard.name).toBe("Bitcoin");
    expect(view?.path).toBe(`/app/dashboards/${dashboard.id}`);
    expect(dashboard.widgets).toHaveLength(1);
    const chart = await caller.resources.chart.get({
      id: dashboard.widgets[0]!.resourceId!,
    });
    expect(chart.cells).toHaveLength(1);
    const cell = chart.cells[0]!;
    expect(cell).toMatchObject({
      resolution: "1d",
      session: "24h",
      adjustment: "raw",
      marketSources: [
        {
          provider: "binance",
          listing: { symbol: "BTCUSDT", currency: "USDT" },
        },
      ],
    });
    expect(cell.panes).toHaveLength(2);
    const indicators = await caller.resources.indicator.list();
    expect(indicators.items).toHaveLength(1);
    const indicator = indicators.items[0]!;
    expect(indicator.source.path).toBe("indicators/builtin/rsi.tea");
    expect(cell.panes[1]?.series[0]?.source).toEqual({
      kind: "indicator",
      indicatorId: indicator.id,
      output: "value",
    });
    expect(
      JSON.parse(view!.localStorage[`local:chart:${cell.id}`]!),
    ).toMatchObject({
      state: {
        paneHeights: [3, 1],
        viewport: { from: expect.any(Number), to: expect.any(Number) },
      },
      version: 1,
    });
    const workspace = await caller.resources.workspace.get({
      id: indicator.source.workspaceId,
    });
    expect(workspace.root).toBe(
      join(await realpath(home), "workspaces", "default"),
    );
    expect(
      await readFile(join(workspace.root, indicator.source.path), "utf8"),
    ).toContain("ta.rsi(source, length)");

    const drawings = await caller.resources.drawing.list({
      filter: { dashboardId: dashboard.id },
    });
    expect(drawings.items).toHaveLength(11);
    const ray = drawings.items.find(({ data }) => data.type === "ray")!;
    expect(ray).toMatchObject({
      id: "drw_88PJ1VybVTwnxW",
      provider: "binance",
      listing: { symbol: "BTCUSDT" },
      data: {
        id: "95ced1c4-b640-4f52-9efc-4d3c9bf75f1c",
        type: "ray",
        anchors: [
          { time: 1761264000, price: 110034.31519421862, axisId: "right" },
          { time: 1776124800, price: 86400.36234869016, axisId: "right" },
        ],
        style: { lineColor: "#ffffff", lineWidth: 1, lineStyle: "solid" },
        locked: false,
        hidden: false,
      },
    });
    const annotations = drawings.items.filter(
      ({ data }) => data.type === "annotation",
    );
    expect(annotations).toHaveLength(9);
    for (const { data } of annotations) {
      expect(data.type).toBe("annotation");
      if (data.type === "annotation")
        expect(data.sources.length).toBeGreaterThan(0);
    }
    const selection = drawings.items.find(
      ({ data }) => data.type === "agent_session",
    )!;
    const sessions = await runtime.runPromise(Session.Service);
    const session = await runtime.runPromise(
      sessions.getSessionByBinding({ key: `drawing:${selection.id}` }),
    );
    expect(session).toMatchObject({
      kind: "chart_explain",
      lastReadRunId: null,
    });
    const transcript = await runtime.runPromise(
      sessions.readTranscriptPage({ sessionID: session!.id }),
    );
    expect(transcript.history).toHaveLength(4);
    expect(transcript.history[0]?.parts).toContainEqual(
      expect.objectContaining({
        type: "plugin_input",
        input: expect.objectContaining({ drawingId: selection.id }),
      }),
    );
    expect(transcript.history[3]?.parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("BTC crosses $90,000"),
      }),
    );

    const rules = await caller.resources.alert_rule.list();
    expect(rules.items).toHaveLength(2);
    const rule = rules.items.find(({ alertable }) => alertable.kind === "tea")!;
    expect(rule).toMatchObject({
      enabled: true,
      repeat: false,
      alertable: {
        kind: "tea",
        config: {
          parameters: { op: "crossing", threshold: 90000 },
          inputs: {
            bars: {
              _tag: "Bars",
              listing: { symbol: "BTCUSDT" },
              resolution: "1d",
            },
          },
        },
      },
    });
    // The starter onboarding walks through exactly this content.
    expect(JSON.parse(view!.localStorage["local:onboarding"]!)).toEqual({
      state: { workflow: "starter" },
      version: 1,
    });
    expect(
      starterWorkflow.steps.flatMap(({ action }) => action?.path ?? []),
    ).toEqual([
      view!.path,
      `/app/sessions/${session!.id}`,
      `/app/alerts/rules/${rule.id}`,
      view!.path,
    ]);

    const triggers = await caller.resources.trigger.list();
    expect(triggers.items).toHaveLength(4);
    const priceActions = triggers.items.filter(
      ({ event }) => event.kind === "alert" && event.ruleId === rule.id,
    );
    expect(priceActions).toHaveLength(2);
    for (const trigger of priceActions)
      expect(trigger).toMatchObject({
        enabled: true,
        event: { kind: "alert", ruleId: rule.id },
      });
    expect(priceActions.map(({ target }) => target.kind).sort()).toEqual([
      "agent_prompt",
      "notification",
    ]);
    const agent = priceActions.find(
      ({ target }) => target.kind === "agent_prompt",
    )!;
    expect(agent.target).toMatchObject({
      prompt: {
        workspaceId: workspace.id,
        agent: "analyst",
        parts: [{ type: "text", text: expect.stringContaining(session!.id) }],
      },
    });

    const rayRule = rules.items.find(
      ({ alertable }) => alertable.kind === "drawing",
    )!;
    expect(rayRule).toMatchObject({
      id: "alr_88PJ36VVUmJn4G",
      enabled: true,
      repeat: false,
      alertable: {
        kind: "drawing",
        drawingId: ray.id,
        operator: "crossing",
        inputs: {
          provider: ray.provider,
          listing: ray.listing,
          resolution: cell.resolution,
          session: cell.session,
          adjustment: cell.adjustment,
        },
      },
    });
    if (rayRule.alertable.kind !== "drawing")
      throw new Error("Expected a drawing alert");
    expect(
      drawingTeaDefinition(ray, rayRule.alertable).config.parameters,
    ).toMatchObject({
      kind: "ray",
      op: "crossing",
      t1: 1761264000000,
      p1: 110034.31519421862,
      t2: 1776124800000,
      p2: 86400.36234869016,
    });
    const rayActions = triggers.items.filter(
      ({ event }) => event.kind === "alert" && event.ruleId === rayRule.id,
    );
    expect(rayActions).toHaveLength(2);
    expect(rayActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "trg_88PJ36VWSVX1cR",
          enabled: true,
          target: {
            kind: "notification",
            message: "{symbol} {title}: {value}",
          },
        }),
        expect.objectContaining({
          id: "trg_88PJ36VXyWjsaK",
          enabled: true,
          target: {
            kind: "agent_prompt",
            prompt: {
              agent: "analyst",
              workspaceId: workspace.id,
              model: { providerID: "codex", modelID: "tier4" },
              parts: [
                {
                  type: "workflow",
                  workflow:
                    "default:workflows/multi-angle-research.workflow.ts",
                  args: { question: "should I buy bitcoin right now" },
                },
              ],
            },
          },
        }),
      ]),
    );
    expect(
      await readFile(
        join(workspace.root, "workflows/multi-angle-research.workflow.ts"),
        "utf8",
      ),
    ).toContain("export default defineWorkflow(");

    // Execute the stored Tea definitions using historical samples, without network data.
    expect(rule.alertable.kind).toBe("tea");
    if (rule.alertable.kind !== "tea") throw new Error("Expected a Tea alert");
    const definition = rule.alertable;
    if ("indicatorId" in definition.config)
      throw new Error("Expected market inputs");
    const config = Schema.decodeUnknownSync(Tea.NodeConfig)(definition.config);
    const bars = config.inputs.bars;
    if (bars?._tag !== "Bars") throw new Error("Expected the Bars input");
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const tea = yield* Tea.Service;
        const alertNode = yield* Effect.acquireRelease(
          tea.compile({
            entry: "<inline>",
            sources: { "<inline>": definition.source },
          }),
          (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
        );
        const rsiNode = yield* Effect.acquireRelease(
          tea.compile({
            entry: indicator.source.path,
            sources: indicator.snapshot,
          }),
          (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
        );
        // The rule's market, with historical samples in place of Feed.
        const observe = (
          id: string,
          prices: number[],
          parameters: Tea.NodeConfig["parameters"],
        ) =>
          tea.observe({
            id,
            ...config,
            inputs: {
              bars: {
                ...bars,
                _tag: "Samples",
                rows: prices.map((close, index) => ({
                  time: 1_700_000_000_000 + index * 86_400_000,
                  open: close,
                  high: close,
                  low: close,
                  close,
                  volume: 1,
                })),
              },
            },
            parameters,
            nodes: {},
            from: 1_700_000_000_000,
            to: 1_700_000_000_000 + prices.length * 86_400_000,
            countBack: prices.length,
            warmupBars: Tea.standardWarmupBars,
          });
        const alert = yield* observe(
          alertNode.id,
          [89000, 90000, 91000, 89000],
          definition.config.parameters,
        );
        const rsi = yield* observe(
          rsiNode.id,
          Array.from({ length: 20 }, (_, index) => 80000 + index * 100),
          { source: "close", length: 14 },
        );
        const outputs = {
          alerts: Array.from(
            { length: 4 },
            (_, index) => alert.snapshot.data.get(index)?.alert,
          ),
          rsi: rsi.snapshot.data.get(rsi.snapshot.data.numRows - 1)?.value,
        };
        return outputs;
      }).pipe(Effect.scoped),
    );
    expect(result.alerts).toEqual([
      [],
      [expect.any(Object)],
      [],
      [expect.any(Object)],
    ]);
    expect(result.rsi).toMatchObject({ series: 100 });
  } finally {
    await runtime.dispose();
  }
  const database = new DatabaseSync(join(home, "openchart.sqlite3"), {
    readOnly: true,
  });
  try {
    expect(
      database
        .prepare(
          "SELECT id, filename, checksum FROM app_schema_migrations ORDER BY version",
        )
        .all(),
    ).toEqual(
      migrations.map(({ id, filename, checksum }) => ({
        id,
        filename,
        checksum,
      })),
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM agent_run").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM alert_event").get(),
    ).toEqual({ count: 0 });
  } finally {
    database.close();
  }
  expect(await prepareOnboardingContent(home)).toBeUndefined();
}, 30_000);
