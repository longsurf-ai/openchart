// Purpose: Exercise the editor's atomic save and side-effect-free inspection RPCs.
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea";
import { Feed } from "@openchart/server/feed/service";
import { Events } from "@openchart/server/events";
import { triggerResource } from "@openchart/server/resources/trigger";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import {
  buildConditions,
  type ConditionRule,
} from "@openchart/server/alert/conditions";
import { Effect } from "effect";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;
const market = {
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m" as const,
  session: "regular" as const,
  adjustment: "raw" as const,
};
const value = {
  name: "Price crossing",
  enabled: true,
  repeat: true,
  alertable: {
    kind: "tea" as const,
    source:
      'threshold = input.float(100)\nalertcondition("above", close > threshold, "Above", "Crossed")',
    config: barsRuleConfig(market, { threshold: 100 }),
  },
};
const action = {
  name: "Tell me",
  enabled: true,
  target: { kind: "notification" as const, message: "{symbol} {value}" },
};

beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
  caller = router.createCaller({ runtime });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

test("feed-only saves stay action-free and disabled notifications are not re-enabled", async () => {
  const created = await caller.resources.macro.saveAlertRule({
    value,
    actions: [],
  });
  expect(created.actions).toEqual([]);
  const saved = await caller.resources.macro.saveAlertRule({
    rule: { id: created.rule.id, expectedRevision: created.rule.revision },
    value,
    actions: [{ ...action, enabled: false }],
  });
  expect(saved.actions).toHaveLength(1);
  expect(saved.actions[0]).toMatchObject({
    enabled: false,
    target: action.target,
  });
});

test("removes only explicit captured actions and rolls back removals when a later write fails", async () => {
  const created = await caller.resources.macro.saveAlertRule({
    value,
    actions: [action, action],
  });
  const [removed, kept] = created.actions;
  const input = {
    rule: { id: created.rule.id, expectedRevision: created.rule.revision },
    value: { ...value, name: "Updated rule" },
    removedActions: [{ id: removed!.id, expectedRevision: removed!.revision }],
    actions: [
      {
        ...action,
        id: kept!.id,
        expectedRevision: kept!.revision,
        target: { kind: "notification" as const, message: "Updated" },
      },
      action,
    ],
  };
  const insert = triggerResource.store.insert;
  const failure = vi
    .spyOn(triggerResource.store, "insert")
    .mockImplementation((tx, input) =>
      insert(tx, input).pipe(Effect.map((row) => ({ ...row, revision: 0 }))),
    );
  await expect(
    caller.resources.macro.saveAlertRule(input),
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(
    await caller.resources.alert_rule.get({ id: created.rule.id }),
  ).toEqual(created.rule);
  expect(await caller.resources.trigger.get({ id: removed!.id })).toEqual(
    removed,
  );
  expect(await caller.resources.trigger.get({ id: kept!.id })).toEqual(kept);
  failure.mockRestore();
  const saved = await caller.resources.macro.saveAlertRule(input);
  expect(saved.actions).toHaveLength(2);
  expect(saved.actions[0]).toMatchObject({
    id: kept!.id,
    revision: kept!.revision + 1,
    target: { message: "Updated" },
  });
  await expect(
    caller.resources.trigger.get({ id: removed!.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const empty = await caller.resources.macro.saveAlertRule({
    rule: { id: saved.rule.id, expectedRevision: saved.rule.revision },
    value: input.value,
    actions: [],
    removedActions: saved.actions.map(({ id, revision }) => ({
      id,
      expectedRevision: revision,
    })),
  });
  expect(empty.actions).toEqual([]);
  expect((await caller.resources.trigger.list()).items).toEqual([]);
});

test("omitted, duplicated and stale removal identities cannot overwrite actions", async () => {
  const created = await caller.resources.macro.saveAlertRule({
    value,
    actions: [action],
  });
  const saved = created.actions[0]!;
  const removal = { id: saved.id, expectedRevision: saved.revision };
  const input = {
    rule: { id: created.rule.id, expectedRevision: created.rule.revision },
    value: { ...value, name: "Must not save" },
    actions: [],
  };
  await expect(
    caller.resources.macro.saveAlertRule(input),
  ).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    caller.resources.macro.saveAlertRule({
      ...input,
      removedActions: [removal, removal],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller.resources.macro.saveAlertRule({
      ...input,
      actions: [{ ...action, ...removal }],
      removedActions: [removal],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await caller.resources.trigger.patch({
    ...removal,
    operations: [{ op: "replace", path: "/name", value: "Edited elsewhere" }],
  });
  await expect(
    caller.resources.macro.saveAlertRule({
      ...input,
      removedActions: [removal],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await caller.resources.alert_rule.get({ id: created.rule.id }),
  ).toEqual(created.rule);
  expect(await caller.resources.trigger.get({ id: saved.id })).toMatchObject({
    name: "Edited elsewhere",
  });
});

test("inspection detaches metadata, rejects non-alerts, and always releases without Feed", async () => {
  const tea = await runtime.runPromise(Tea.Service);
  const feed = await runtime.runPromise(Feed);
  const get = vi.spyOn(feed, "get");
  const compile = vi.spyOn(tea, "compile");
  const dispose = vi.spyOn(tea, "dispose");
  const inspected = await caller.resources.alert_rule.inspect({
    source: value.alertable.source,
  });
  expect(inspected.alertOutputs).toEqual(["above"]);
  expect(inspected.node.parameters).toMatchObject([
    { name: "threshold", defaultValue: 100 },
  ]);
  // Schemas arrive as Arrow JSON.
  expect(inspected.node.outputs.fields.map((field) => field.name)).toContain(
    "above",
  );
  expect(inspected.node).not.toHaveProperty("id");
  await expect(
    caller.resources.alert_rule.inspect({ source: 'emit "value" close' }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.alert_rule.inspect({ source: "import ./secret" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(compile).toHaveBeenCalledTimes(3);
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(get).not.toHaveBeenCalled();
});

test("delivery-only saves keep Rule revision and preserve unchanged actions without any observation", async () => {
  const tea = await runtime.runPromise(Tea.Service);
  const observe = vi.spyOn(tea, "observe");
  const created = await caller.resources.macro.saveAlertRule({
    value,
    actions: [action, { ...action, enabled: false }],
  });
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const edited = await caller.resources.macro.saveAlertRule({
    rule: { id: created.rule.id, expectedRevision: created.rule.revision },
    value,
    actions: created.actions.map((saved, i) => ({
      id: saved.id,
      expectedRevision: saved.revision,
      name: saved.name,
      enabled: saved.enabled,
      target:
        i === 0
          ? { kind: "notification", message: "Edited {symbol}" }
          : saved.target,
    })),
  });
  expect(edited.rule).toEqual(created.rule);
  expect(edited.actions[0]!.revision).toBe(2);
  expect(edited.actions[1]).toEqual(created.actions[1]);
  expect(publish.mock.calls.map(([, event]) => event)).toEqual([
    { resource: "trigger", id: created.actions[0]!.id, revision: 2 },
  ]);
  expect(observe).not.toHaveBeenCalled();
});

test("a newly attached or concurrently changed action rejects the complete save", async () => {
  const created = await caller.resources.macro.saveAlertRule({
    value,
    actions: [action],
  });
  const save = () =>
    caller.resources.macro.saveAlertRule({
      rule: { id: created.rule.id, expectedRevision: created.rule.revision },
      value: { ...value, name: "Changed" },
      actions: created.actions.map((saved) => ({
        ...action,
        id: saved.id,
        expectedRevision: saved.revision,
      })),
    });
  const added = await caller.resources.trigger.create({
    ...action,
    event: { kind: "alert", ruleId: created.rule.id },
  });
  await expect(save()).rejects.toMatchObject({ code: "CONFLICT" });
  await caller.resources.trigger.delete({ id: added.id });
  await caller.resources.trigger.patch({
    id: created.actions[0]!.id,
    expectedRevision: 1,
    operations: [{ op: "replace", path: "/name", value: "Changed elsewhere" }],
  });
  await expect(save()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await caller.resources.alert_rule.get({ id: created.rule.id }),
  ).toEqual(created.rule);
});

test.each([true, false])(
  "invalid sources/configurations fail before writes when enabled=%s",
  async (enabled) => {
    for (const alertable of [
      { ...value.alertable, source: "plot(close)" },
      { ...value.alertable, source: "invalid draft" },
      {
        ...value.alertable,
        config: { ...value.alertable.config, parameters: {} },
      },
    ]) {
      await expect(
        caller.resources.macro.saveAlertRule({
          value: { ...value, enabled, alertable },
          actions: [action],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await caller.resources.alert_rule.list()).items).toEqual([]);
    expect((await caller.resources.trigger.list()).items).toEqual([]);
  },
);

test("a target write failure rolls back the rule and every preceding action", async () => {
  const insert = triggerResource.store.insert;
  vi.spyOn(triggerResource.store, "insert").mockImplementation((tx, input) =>
    insert(tx, input).pipe(Effect.map((row) => ({ ...row, revision: 0 }))),
  );
  await expect(
    caller.resources.macro.saveAlertRule({ value, actions: [action] }),
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  expect((await caller.resources.alert_rule.list()).items).toEqual([]);
  expect((await caller.resources.trigger.list()).items).toEqual([]);
});

test.each([
  ...(["extended_line", "fib_retracement", "fib_channel"] as const).map(
    (kind) => ({ kind, operator: "crossing_up" as const }),
  ),
  ...(
    ["freehand", "polyline", "rectangle", "triangle", "curved_line"] as const
  ).flatMap((kind) =>
    (["crossing", "touching"] as const).map((operator) => ({
      kind,
      operator,
    })),
  ),
])(
  "$kind $operator saves compile derived geometry without persisting it or opening Feed",
  async ({ kind, operator }) => {
    const dashboard = await caller.resources.dashboard.create({
      name: "Lines",
    });
    const inputs = market;
    const drawing = await caller.resources.drawing.create({
      dashboardId: dashboard.id,
      provider: inputs.provider,
      listing: inputs.listing,
      data: Drawing.create(
        kind,
        [
          { time: 60, price: 100 },
          { time: 120, price: 110 },
          ...(Drawing.requiredAnchors(kind) === 3
            ? [{ time: 60, price: 120 }]
            : []),
        ],
        { id: "line" },
      ),
    });
    const tea = await runtime.runPromise(Tea.Service);
    const feed = await runtime.runPromise(Feed);
    const observe = vi.spyOn(tea, "observe");
    const get = vi.spyOn(feed, "get");
    const alertable = {
      kind: "drawing" as const,
      drawingId: drawing.id,
      operator,
      inputs,
    };
    const saved = await caller.resources.macro.saveAlertRule({
      value: { ...value, alertable },
      actions: [action],
    });
    expect(saved.rule.alertable).toEqual(alertable);
    expect(
      await caller.resources.alert_rule.get({ id: saved.rule.id }),
    ).toEqual(saved.rule);
    expect(saved.actions).toHaveLength(1);
    expect(saved.actions[0]).toMatchObject({
      ...action,
      event: { kind: "alert", ruleId: saved.rule.id },
    });
    expect(
      await caller.resources.trigger.get({ id: saved.actions[0]!.id }),
    ).toEqual(saved.actions[0]);
    expect(observe).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    if (operator !== "crossing_up") {
      await expect(
        caller.resources.macro.saveAlertRule({
          value: {
            ...value,
            alertable: { ...alertable, operator: "crossing_up" },
          },
          actions: [action],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await caller.resources.alert_rule.list()).items).toEqual([
        saved.rule,
      ]);
      expect((await caller.resources.trigger.list()).items).toEqual(
        saved.actions,
      );
    }
    await expect(
      caller.resources.macro.saveAlertRule({
        value: {
          ...value,
          alertable: {
            ...alertable,
            inputs: { ...inputs, listing: { symbol: "MSFT", currency: "USD" } },
          },
        },
        actions: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.resources.drawing.delete({ id: drawing.id });
    await expect(
      caller.resources.macro.saveAlertRule({
        value: { ...value, alertable },
        actions: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  },
);

test("drawing changes during compile reject the save before rule/action writes", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "Lines" });
  const inputs = market;
  const drawing = await caller.resources.drawing.create({
    dashboardId: dashboard.id,
    provider: inputs.provider,
    listing: inputs.listing,
    data: Drawing.create("horizontal_line", [{ time: 60, price: 100 }], {
      id: "line",
    }),
  });
  const tea = await runtime.runPromise(Tea.Service);
  const compile = tea.compile;
  vi.spyOn(tea, "compile").mockImplementation((request) =>
    Effect.gen(function* () {
      const node = yield* compile(request);
      yield* Effect.promise(() =>
        caller.resources.drawing.patch({
          id: drawing.id,
          expectedRevision: drawing.revision,
          operations: [
            { op: "replace", path: "/data/anchors/0/price", value: 110 },
          ],
        }),
      );
      return node;
    }),
  );
  await expect(
    caller.resources.macro.saveAlertRule({
      value: {
        ...value,
        alertable: {
          kind: "drawing",
          drawingId: drawing.id,
          operator: "crossing_up",
          inputs,
        },
      },
      actions: [action],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller.resources.alert_rule.list()).items).toHaveLength(0);
  expect((await caller.resources.trigger.list()).items).toHaveLength(0);
});

const indicatorScript =
  'indicator("T", overlay = false)\nlength = input.int(2)\nplot("avg", ta.sma(close, length))\nemit "raw" close\nhline("level", 50.0)\n';

/** An Indicator with plot "avg", numeric "raw" and hline "level" on a new AAPL chart cell. */
async function addTestIndicator() {
  const workspaceId = await caller.resources.workspace.getDefault();
  await caller.workspace.write({
    workspaceId,
    path: "study.tea",
    text: indicatorScript,
    expected: null,
  });
  const dashboard = await caller.resources.dashboard.create({
    name: "Research",
  });
  const chart = await caller.resources.chart.create({
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
  const added = await caller.resources.macro.addIndicator({
    chartId: chart.id,
    expectedRevision: chart.revision,
    cellId: "ccl_a",
    source: { workspaceId, path: "study.tea" },
    parameterOverrides: {},
  });
  return added.indicator;
}

/** A rule that follows `indicatorId`, or reads `market`, whose generated condition reads every field. */
function conditionRule(
  source: { indicatorId: string } | typeof market,
  ...fields: ConditionRule["field"][]
) {
  const generated = buildConditions({
    combinator: "and",
    rules: fields.map((field) => ({
      field,
      operator: "greater_than",
      value: { threshold: 0, lower: 0, upper: 1, amount: 1, bars: 1 },
    })),
  });
  return {
    ...value,
    alertable: {
      kind: "tea" as const,
      source: generated.source,
      config:
        "indicatorId" in source
          ? { ...source, parameters: generated.parameters, requests: {} }
          : barsRuleConfig(source, generated.parameters),
    },
  };
}

test("a rule that follows an Indicator reads every plot and numeric output and is stored verbatim, without opening Feed", async () => {
  const indicator = await addTestIndicator();
  const tea = await runtime.runPromise(Tea.Service);
  const feed = await runtime.runPromise(Feed);
  const observe = vi.spyOn(tea, "observe");
  const get = vi.spyOn(feed, "get");
  const rule = conditionRule(
    { indicatorId: indicator.id },
    "indicator.avg",
    "indicator.raw",
  );
  const saved = await caller.resources.macro.saveAlertRule({
    value: rule,
    actions: [action],
  });
  expect(saved.rule.alertable).toEqual(rule.alertable);
  expect(await caller.resources.alert_rule.get({ id: saved.rule.id })).toEqual(
    saved.rule,
  );
  expect(observe).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

// The map names no column for a missing output, a horizontal line, or any
// Indicator output of a rule that reads only a market.
test("unreadable Indicator fields, Indicator fields on a market rule and a gone Indicator write nothing", async () => {
  const indicator = await addTestIndicator();
  const inputs = { indicatorId: indicator.id };
  const rejections = [
    [conditionRule(inputs, "indicator.missing"), "indicator.missing"],
    [conditionRule(inputs, "indicator.level"), "indicator.level"],
    [conditionRule(market, "indicator.avg"), "indicator.avg"],
  ] as const;
  for (const [rule, column] of rejections)
    await expect(
      caller.resources.macro.saveAlertRule({ value: rule, actions: [action] }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(column),
    });
  await caller.resources.indicator.delete({ id: indicator.id });
  await expect(
    caller.resources.macro.saveAlertRule({
      value: conditionRule(inputs, "indicator.avg"),
      actions: [action],
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await caller.resources.alert_rule.list()).items).toEqual([]);
  expect((await caller.resources.trigger.list()).items).toEqual([]);
});

test("an Indicator change during compile rejects the save before rule/action writes", async () => {
  const indicator = await addTestIndicator();
  const tea = await runtime.runPromise(Tea.Service);
  const compile = tea.compile;
  vi.spyOn(tea, "compile").mockImplementation((request) =>
    Effect.gen(function* () {
      const node = yield* compile(request);
      if ("entry" in request)
        yield* Effect.promise(() =>
          caller.resources.indicator.patch({
            id: indicator.id,
            expectedRevision: indicator.revision,
            operations: [
              {
                op: "replace",
                path: "/parameterOverrides",
                value: { length: 3 },
              },
            ],
          }),
        );
      return node;
    }),
  );
  await expect(
    caller.resources.macro.saveAlertRule({
      value: conditionRule({ indicatorId: indicator.id }, "indicator.avg"),
      actions: [action],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller.resources.alert_rule.list()).items).toEqual([]);
  expect((await caller.resources.trigger.list()).items).toEqual([]);
});
