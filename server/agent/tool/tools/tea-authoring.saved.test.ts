// Purpose: Independently verify the first source and saved Alerts from Computer Use authoring sessions.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { barsSeries } from "@openchart/feed";
import { ChartEntity } from "@openchart/server/resources/chart";
import { IndicatorEntity } from "@openchart/server/resources/indicator";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { AlertableDefinition } from "@openchart/server/resources/alert-rule/schema";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea/tea";
import { assertExists } from "@openchart/utils/assert";
import {
  authoringCases,
  indicatorExpected,
  indicatorSamples,
  type Dataset,
} from "./tea-authoring.cases";
import { Parameters as TeaRunParameters } from "./tea-run";

const reports = process.env.OPENCHART_TEA_UI_REPORTS;
const filter = process.env.OPENCHART_TEA_UI_CASE;
const Report = Schema.Struct({
  sessionID: Schema.String,
  charts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        cells: ChartEntity.fields.cells,
      }),
    ),
  ),
  // Indicators are their own Resources, placed on a chart cell.
  indicators: Schema.optionalKey(Schema.Array(IndicatorEntity)),
  files: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  rules: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      enabled: Schema.Boolean,
      repeat: Schema.Boolean,
      alertable: AlertableDefinition,
    }),
  ),
  transcript: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      parts: Schema.Array(Schema.JsonObject),
    }),
  ),
});
const Call = Schema.Struct({
  tool: Schema.String,
  state: Schema.Struct({
    status: Schema.String,
    input: Schema.JsonObject,
    output: Schema.optionalKey(
      Schema.Struct({ type: Schema.String, value: Schema.Json }),
    ),
  }),
});
const TeaResult = Schema.Struct({
  status: Schema.Literal("ok"),
  alertOutputs: Schema.Array(Schema.String),
  rows: Schema.optionalKey(Schema.Array(Schema.JsonObject)),
});
const encodeConfig = Schema.encodeSync(Tea.NodeConfig);

// The config a tea_run call sent.
const runConfig = (call: typeof Call.Type) =>
  Schema.decodeUnknownSync(TeaRunParameters)(call.state.input).config;

const hasSamples = (config: Tea.NodeConfig) =>
  Object.values(config.inputs).some((input) => input._tag === "Samples");

// Authoring cases read one market per node.
function marketOf(config: Tea.NodeConfig): Tea.Bars {
  const inputs = Object.values(config.inputs);
  expect(inputs).toHaveLength(1);
  if (inputs[0]?._tag !== "Bars") throw new Error("Expected one Bars input");
  return inputs[0];
}

// Replays a dataset: every Bars input becomes Samples with the dataset's rows,
// the node's own at the root and each request child's by name.
function withSamples(config: Tea.NodeConfig, data: Dataset): Tea.NodeConfig {
  return {
    ...config,
    inputs: Object.fromEntries(
      Object.entries(config.inputs).map(
        ([name, input]): [string, Tea.NodeInput] => [
          name,
          input._tag === "Bars"
            ? { ...input, _tag: "Samples", rows: data.rows }
            : input,
        ],
      ),
    ),
    requests: Object.fromEntries(
      Object.entries(config.requests).map(([name, child]) => [
        name,
        withSamples(child, data.requests[name]!),
      ]),
    ),
  };
}

// The config a sample run tested, with each Samples input turned back into
// the Bars input it stood in for. A saved rule reads Bars only.
function asSaved(config: Tea.NodeConfig): Tea.NodeConfig {
  return {
    ...config,
    inputs: Object.fromEntries(
      Object.entries(config.inputs).map(
        ([name, input]): [string, Tea.NodeInput] => [
          name,
          input._tag === "Samples"
            ? {
                _tag: "Bars",
                ...barsSeries(input, input),
                schema: input.schema,
              }
            : input,
        ],
      ),
    ),
    requests: Object.fromEntries(
      Object.entries(config.requests).map(([name, child]) => [
        name,
        asSaved(child),
      ]),
    ),
  };
}

test
  .runIf(Boolean(reports))
  .each(
    authoringCases.filter(
      (item) =>
        !filter || filter.split(",").some((id) => item.id.startsWith(id)),
    ),
  )(
  "UI-authored Tea first attempt and independent behavior: $id",
  async (item) => {
    assertExists(reports, "Computer Use transcript export required");
    const report = Schema.decodeUnknownSync(Report)(
      JSON.parse(readFileSync(path.join(reports, `${item.id}.json`), "utf8")),
    );
    expect(report.rules).toHaveLength(1);
    const rule = report.rules[0]!;
    expect(rule.enabled).toBe(false);
    if (
      [
        "01-cross-up",
        "05-streak",
        "06-cooldown",
        "20-claude-sma-cross",
      ].includes(item.id)
    )
      expect(rule.repeat).toBe(true);
    if (rule.alertable.kind !== "tea")
      throw new Error("Expected saved Tea Alert");
    const { source, config: saved } = rule.alertable;
    // Authoring sessions save market rules; following an Indicator is another form.
    if ("indicatorId" in saved)
      throw new Error("Expected a market-input Alert");
    const config = Schema.decodeUnknownSync(Tea.NodeConfig)(saved);
    const market = marketOf(config);
    if (item.id === "20-claude-sma-cross") {
      expect(config.parameters).toEqual({ length: 20 });
      expect(market.resolution).toBe("1d");
    }
    expect(market).toMatchObject({
      listing: item.listing ?? { symbol: "AAPL", currency: "USD" },
    });
    const parts = report.transcript.flatMap((message) => message.parts);
    const calls = parts
      .filter(
        (part) =>
          part.type === "tool" &&
          [
            "tea_check",
            "tea_run",
            "resource_mutate",
            "resource_read",
            "save_alert_rule",
          ].includes(String(part.tool)),
      )
      .map((part) => Schema.decodeUnknownSync(Call)(part));
    const teaCalls = calls.filter(
      (call) => call.tool === "tea_check" || call.tool === "tea_run",
    );
    // The first submitted program must be the saved program. Later diagnostic
    // programs may expose intermediate values without changing the Alert.
    expect(teaCalls[0]?.state.input.source).toBe(source);
    expect(
      teaCalls.some(
        (call) =>
          call.tool === "tea_run" &&
          call.state.input.source === source &&
          hasSamples(runConfig(call)),
      ),
    ).toBe(true);
    for (const call of teaCalls) {
      expect(call.state.status).toBe("completed");
      expect(call.state.output?.type).toBe("json");
      const result = Schema.decodeUnknownSync(TeaResult)(
        call.state.output?.value,
      );
      if (call.tool === "tea_run") {
        // Every run tested the saved bindings, Samples standing in for Bars.
        expect(encodeConfig(asSaved(runConfig(call)))).toEqual(
          encodeConfig(config),
        );
        expect(result.rows?.length).toBeGreaterThan(0);
      }
    }
    expect(
      calls.filter(
        (call) =>
          call.tool === "save_alert_rule" ||
          (call.tool === "resource_mutate" &&
            call.state.input.resource === "alert_rule"),
      ),
    ).toHaveLength(1);
    expect(
      calls.some(
        (call) =>
          call.tool === "resource_read" &&
          call.state.status === "completed" &&
          call.state.input.id === rule.id,
      ),
    ).toBe(true);
    expect(
      JSON.stringify(parts.filter((part) => part.type === "tool")),
    ).toMatch(/Contents\/Resources\/docs.*tea\/introduction\.md/s);

    const runtime = makeRuntime({
      home: temporaryHome(),
      databasePath: ":memory:",
      models: { fetchEnabled: false },
    });
    try {
      const observations = await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const tea = yield* Tea.Service;
            const node = yield* Effect.acquireRelease(
              tea.compile({
                entry: "<inline>",
                sources: { "<inline>": source },
              }),
              (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
            );
            const columns = Tea.teaAlertOutputs(node.definition.outputs);
            expect(columns).toHaveLength(1);
            const observations = [];
            for (const [data, expected] of [
              [item.samples, item.expected],
              [item.heldout, item.heldoutExpected],
            ] as const) {
              // Natural-language requests do not prescribe the child's local binding name.
              const requests = Object.keys(node.definition.requests);
              const samples = [
                "10-request",
                "13-crypto-mtf",
                "18-pair-zscore",
              ].includes(item.id)
                ? {
                    ...data,
                    requests: Object.fromEntries(
                      requests.map((name) => [name, data.requests.peer!]),
                    ),
                  }
                : data;
              if (item.id === "10-request" || item.id === "18-pair-zscore") {
                expect(requests).toHaveLength(1);
                expect(
                  marketOf(Object.values(config.requests)[0]!),
                ).toMatchObject({
                  listing: {
                    symbol: item.id === "10-request" ? "MSFT" : "SPY",
                  },
                });
              }
              if (item.id === "17-rsi-rearm")
                expect(market).toMatchObject({
                  provider: "binance",
                  resolution: "15m",
                });
              if (item.id === "13-crypto-mtf") {
                expect(market).toMatchObject({
                  provider: "binance",
                  resolution: "15m",
                });
                expect(requests.length).toBeGreaterThan(0);
                for (const child of Object.values(config.requests))
                  expect(marketOf(child)).toMatchObject({
                    provider: "binance",
                    resolution: "1h",
                    listing: { symbol: "BTCUSDT", currency: "USDT" },
                  });
              }
              const { snapshot } = yield* tea.observe({
                id: node.id,
                ...withSamples(config, samples),
                nodes: {},
                from: samples.rows[0]!.time,
                to: samples.rows.at(-1)!.time + 60_000,
                countBack: 1,
                warmupBars: Tea.standardWarmupBars,
              });
              const rows = [...snapshot.data];
              const fired = rows.filter((row) => {
                const events = row[columns[0]!];
                return Array.isArray(events) && events.length > 0;
              });
              expect(fired.map((row) => row.time)).toEqual(
                expected.map((index) => samples.rows[index - 1]!.time),
              );
              for (const row of fired) {
                expect(row[columns[0]!]).toHaveLength(1);
                if (item.id === "18-pair-zscore") {
                  for (const symbol of ["QQQ", "SPY"])
                    expect(row[columns[0]!]).toMatchObject([
                      { message: expect.stringContaining(symbol) },
                    ]);
                  const index = samples.rows.findIndex(
                    (bar) => bar.time === row.time,
                  );
                  const ratios = data.rows
                    .slice(index - 19, index + 1)
                    .map(
                      (bar, offset) =>
                        bar.close! /
                        data.requests.peer!.rows[index - 19 + offset]!.close!,
                    );
                  const mean =
                    ratios.reduce((sum, value) => sum + value, 0) / 20;
                  const deviation = Math.sqrt(
                    ratios.reduce(
                      (sum, value) => sum + (value - mean) ** 2,
                      0,
                    ) / 20,
                  );
                  const events = Schema.decodeUnknownSync(
                    Schema.Array(
                      Schema.Struct({
                        message: Schema.String,
                        data: Schema.Struct({
                          ratio: Schema.Number,
                          zscore: Schema.Number,
                        }),
                      }),
                    ),
                  )(row[columns[0]!]);
                  expect(events[0]!.data.ratio).toBeCloseTo(ratios.at(-1)!, 8);
                  expect(events[0]!.data.zscore).toBeCloseTo(
                    (ratios.at(-1)! - mean) / deviation,
                    8,
                  );
                  for (const value of Object.values(events[0]!.data))
                    expect(events[0]!.message).toContain(String(value));
                }
                if (item.id === "09-payload") {
                  const close = samples.rows.find(
                    (bar) => bar.time === row.time,
                  )!.close;
                  expect(row[columns[0]!]).toMatchObject([
                    { data: { price: close, symbol: "AAPL" } },
                  ]);
                  expect(row[columns[0]!]).toMatchObject([
                    { message: expect.stringContaining(String(close)) },
                  ]);
                  expect(row[columns[0]!]).toMatchObject([
                    { message: expect.stringContaining("AAPL") },
                  ]);
                }
              }
              observations.push(rows);
            }
            return observations;
          }),
        ),
      );
      writeFileSync(
        path.join(reports, `${item.id}.verification.json`),
        JSON.stringify(
          {
            sessionID: report.sessionID,
            alertID: rule.id,
            firstAttemptPassed: true,
            observations,
          },
          null,
          2,
        ),
      );
    } finally {
      await runtime.dispose();
    }
  },
  30_000,
);

const indicators: readonly {
  id: string;
  symbol: string;
  overlay: boolean;
  columns: Readonly<Record<string, keyof ReturnType<typeof indicatorExpected>>>;
}[] = [
  {
    id: "14-stock-bands",
    symbol: "TSLA",
    overlay: true,
    columns: { ema: "ema", basis: "basis", upper: "bbUpper", lower: "bbLower" },
  },
  { id: "15-etf-rsi", symbol: "SPY", overlay: false, columns: { rsi: "rsi" } },
  {
    id: "16-fx-channel",
    symbol: "EURUSD=X",
    overlay: true,
    columns: { basis: "basis", upper: "atrUpper", lower: "atrLower" },
  },
];

test
  .runIf(Boolean(reports))
  .each(
    indicators.filter(
      (item) =>
        !filter || filter.split(",").some((id) => item.id.startsWith(id)),
    ),
  )(
  "UI-authored indicator, saved chart and independent values: $id",
  async (item) => {
    assertExists(reports, "Computer Use transcript export required");
    const report = Schema.decodeUnknownSync(Report)(
      JSON.parse(readFileSync(path.join(reports, `${item.id}.json`), "utf8")),
    );
    expect(report.charts).toHaveLength(1);
    const chart = report.charts![0]!;
    expect(chart.cells).toHaveLength(1);
    const cell = chart.cells[0]!;
    const placed = (report.indicators ?? []).filter(
      (indicator) => indicator.cellId === cell.id,
    );
    expect(placed).toHaveLength(1);
    const indicator = placed[0]!;
    expect(indicator.source.path.startsWith("indicators/builtin/")).toBe(false);
    const source = report.files?.[indicator.source.path];
    assertExists(source, "Exported saved indicator source required");
    const market = cell.marketSources[0]!;
    expect(market.listing.symbol).toBe(item.symbol);
    expect(cell.resolution).toBe("1d");
    const parts = report.transcript.flatMap((message) => message.parts);
    const calls = parts
      .filter(
        (part) =>
          part.type === "tool" &&
          ["tea_check", "tea_run", "resource_read"].includes(String(part.tool)),
      )
      .map((part) => Schema.decodeUnknownSync(Call)(part));
    const teaCalls = calls.filter((call) => call.tool.startsWith("tea_"));
    expect(
      teaCalls.some(
        (call) => call.tool === "tea_run" && hasSamples(runConfig(call)),
      ),
    ).toBe(true);
    for (const call of teaCalls) {
      expect(call.state.status).toBe("completed");
      if (call.state.input.source !== undefined)
        expect(call.state.input.source).toBe(source);
      else
        expect(
          String(call.state.input.path).endsWith(indicator.source.path),
        ).toBe(true);
      expect(call.state.output?.type).toBe("json");
      expect(
        Schema.decodeUnknownSync(TeaResult)(call.state.output?.value).status,
      ).toBe("ok");
    }
    expect(
      calls.some(
        (call) =>
          call.tool === "resource_read" &&
          call.state.status === "completed" &&
          call.state.input.id === chart.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(parts)).toContain(
      "Contents/Resources/docs/tea/introduction.md",
    );
    const runtime = makeRuntime({
      home: temporaryHome(),
      databasePath: ":memory:",
      models: { fetchEnabled: false },
    });
    try {
      const observations = await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const tea = yield* Tea.Service;
            const node = yield* Effect.acquireRelease(
              tea.compile({
                entry: "<inline>",
                sources: { "<inline>": source },
              }),
              (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
            );
            const { definition } = node;
            expect(node.declaration?.overlay).toBe(item.overlay);
            expect(Object.keys(definition.requests)).toHaveLength(0);
            if (item.id === "14-stock-bands") {
              expect(
                definition.parameters.filter(
                  (parameter) =>
                    parameter.type === "int" && parameter.defaultValue === 20,
                ),
              ).toHaveLength(2);
              expect(
                definition.parameters.some(
                  (parameter) =>
                    parameter.type === "float" && parameter.defaultValue === 2,
                ),
              ).toBe(true);
            }
            // The chart's own binding: the cell's market and the overrides.
            const config: Tea.NodeConfig = {
              ...Tea.barsInputs(barsSeries(market, cell)),
              parameters: Tea.teaParameters(
                definition,
                indicator.parameterOverrides,
              ),
              requests: {},
            };
            const mainPane = cell.panes.find((pane) =>
              pane.series.some((series) => series.role === "main"),
            )!;
            const bound = cell.panes.flatMap((pane) =>
              pane.series.flatMap((series) =>
                series.source.kind === "indicator"
                  ? [{ paneId: pane.id, output: series.source.output }]
                  : [],
              ),
            );
            for (const output of definition.outputs.fields.filter(
              (field) => Tea.describeTeaVisual(field) !== null,
            )) {
              expect(
                bound.some((binding) => binding.output === output.name),
              ).toBe(true);
            }
            for (const binding of bound) {
              expect(
                definition.outputs.fields.some(
                  (field) => field.name === binding.output,
                ),
              ).toBe(true);
              expect(binding.paneId === mainPane.id).toBe(item.overlay);
            }
            const observations = [];
            for (const samples of indicatorSamples) {
              const expected = indicatorExpected(samples);
              const { snapshot } = yield* tea.observe({
                id: node.id,
                ...withSamples(config, samples),
                nodes: {},
                from: samples.rows[0]!.time,
                to: samples.rows.at(-1)!.time + 1,
                countBack: 1,
                warmupBars: Tea.standardWarmupBars,
              });
              const rows = [...snapshot.data];
              expect(rows).toHaveLength(samples.rows.length);
              if (item.id === "15-etf-rsi") {
                const levels = definition.outputs.fields
                  .filter(
                    (field) =>
                      Tea.describeTeaVisual(field)?.kind === "horizontal-line",
                  )
                  .map(
                    (field) =>
                      Schema.decodeUnknownSync(
                        Schema.Record(Schema.String, Schema.Unknown),
                      )(rows.at(-1)![field.name]).price,
                  );
                expect(levels).toEqual(expect.arrayContaining([30, 70]));
              }
              for (const [output, reference] of Object.entries(item.columns)) {
                for (const [i, row] of rows.entries()) {
                  const value = Schema.decodeUnknownSync(
                    Schema.Record(Schema.String, Schema.Unknown),
                  )(row[output]).series;
                  const wanted = expected[reference][i]!;
                  if (Number.isNaN(wanted)) expect(value).toBeNaN();
                  else expect(value).toBeCloseTo(wanted, 8);
                }
              }
              observations.push(rows);
            }
            return observations;
          }),
        ),
      );
      writeFileSync(
        path.join(reports, `${item.id}.verification.json`),
        JSON.stringify(
          {
            sessionID: report.sessionID,
            chartID: chart.id,
            sourcePath: indicator.source.path,
            firstAttemptPassed: true,
            observations,
          },
          null,
          2,
        ),
      );
    } finally {
      await runtime.dispose();
    }
  },
  30_000,
);
