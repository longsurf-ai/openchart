// Purpose: Verifies Alert Rule CRUD, defaults, schema rejections including Bars-only inputs, and database CHECK constraints.

import { Drawing } from "@openchart/chart-core/drawing/types";
import { router } from "@openchart/server";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { makeRuntime } from "@openchart/server/runtime";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { barsRuleConfig } from "./alert-rule.test-utils";
import { alertRuleResource } from "./resource";
import { AlertableDefinition, alertRules } from "./schema";

const inputs = {
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m" as const,
  session: "regular" as const,
  adjustment: "raw" as const,
};
const config = barsRuleConfig(inputs, { threshold: 200 });
const bars = config.inputs.bars!;
const nodeRef = { _tag: "NodeRef", node: "rsi", schema: bars.schema };
const input = {
  name: "AAPL above 200",
  alertable: {
    kind: "tea" as const,
    source:
      'threshold = input.float(200)\nalertcondition("above", close > threshold, "Above", "AAPL crossed 200")',
    config,
  },
};
const drawingDefinition = {
  kind: "drawing" as const,
  drawingId: "drw_saved",
  operator: "crossing_up" as const,
  inputs,
};
let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;
beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
  caller = router.createCaller({ runtime });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

test("creates with defaults, reads, pages, patches, and deletes through the shared Resource API", async () => {
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const created = await caller.resources.alert_rule.save({ value: input });
  expect(created).toMatchObject({
    ...input,
    revision: 1,
    enabled: true,
    repeat: false,
  });
  expect(created.id).toMatch(/^alr_/);
  expect(publish).toHaveBeenCalledExactlyOnceWith(ResourceChanged, {
    resource: "alert_rule",
    id: created.id,
    revision: 1,
  });
  expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
    created,
  );
  expect(await caller.resources.alert_rule.list()).toEqual({
    items: [created],
    nextCursor: null,
  });
  const patched = await caller.resources.alert_rule.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [
      { op: "replace", path: "/repeat", value: true },
      { op: "replace", path: "/enabled", value: false },
    ],
  });
  expect(patched).toMatchObject({
    repeat: true,
    enabled: false,
    alertable: input.alertable,
    revision: 2,
    createdAt: created.createdAt,
  });
  await expect(
    caller.resources.alert_rule.patch({
      id: created.id,
      expectedRevision: 1,
      operations: [{ op: "replace", path: "/name", value: "Stale" }],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await caller.resources.alert_rule.delete({ id: created.id });
  await expect(
    caller.resources.alert_rule.get({ id: created.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test.each([
  ["a blank name", { name: "   " }],
  ["a name over 160 characters", { name: "n".repeat(161) }],
  ["an empty source", { source: "" }],
  ["a source over 65536 characters", { source: "x".repeat(65537) }],
  ["a non-boolean repeat", { repeat: "once" }],
  [
    "an unknown Alertable kind",
    { alertable: { ...input.alertable, kind: "file" } },
  ],
  [
    "an unknown Alertable field",
    { alertable: { ...input.alertable, extra: true } },
  ],
  [
    "a config without a map",
    {
      config: {
        inputs: config.inputs,
        parameters: config.parameters,
        requests: {},
      },
    },
  ],
  [
    "an unsupported resolution",
    { config: { ...config, inputs: { bars: { ...bars, resolution: "2m" } } } },
  ],
  [
    "a Bars schema without open, high, low, close and volume",
    {
      config: {
        ...config,
        inputs: {
          bars: { ...bars, schema: { fields: bars.schema.fields.slice(1) } },
        },
      },
    },
  ],
  [
    "a Samples input",
    {
      config: {
        ...config,
        inputs: { bars: { ...bars, _tag: "Samples", rows: [] } },
      },
    },
  ],
  [
    "a NodeRef input",
    { config: { ...config, inputs: { ...config.inputs, rsi: nodeRef } } },
  ],
  [
    "a non-scalar parameter",
    { config: { ...config, parameters: { threshold: [200] } } },
  ],
  ["an unknown config field", { config: { ...config, extra: true } }],
  [
    "an incomplete child request",
    { config: { ...config, requests: { daily: { parameters: {} } } } },
  ],
  [
    "an unknown child request field",
    { config: { ...config, requests: { daily: { ...config, extra: true } } } },
  ],
  [
    "a NodeRef input inside a child request",
    {
      config: {
        ...config,
        requests: {
          daily: { ...config, inputs: { ...config.inputs, rsi: nodeRef } },
        },
      },
    },
  ],
  [
    "a child request that follows an Indicator",
    {
      config: {
        ...config,
        requests: {
          daily: { indicatorId: "ind_a", parameters: {}, requests: {} },
        },
      },
    },
  ],
  [
    "an extra field next to indicatorId",
    {
      config: {
        indicatorId: "ind_a",
        parameters: {},
        requests: {},
        symbol: "AAPL",
      },
    },
  ],
  [
    "a NodeConfig carrying an indicatorId",
    { config: { ...config, indicatorId: "ind_a" } },
  ],
  [
    "a non-Indicator id",
    { config: { indicatorId: "drw_saved", parameters: {}, requests: {} } },
  ],
  ["an unknown field", { userId: "usr_1" }],
  ["a server-managed field", { revision: 7 }],
])("rejects %s on create and patch without persisting", async (_, invalid) => {
  const change =
    "source" in invalid || "config" in invalid
      ? { alertable: { ...input.alertable, ...invalid } }
      : invalid;
  await expect(
    caller.resources.alert_rule.save({
      value: { ...input, ...change } as never,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const created = await caller.resources.alert_rule.save({ value: input });
  const [key, value] = Object.entries(change)[0]!;
  await expect(
    caller.resources.alert_rule.patch({
      id: created.id,
      expectedRevision: 1,
      operations: [{ op: "add", path: `/${key}`, value }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.resources.alert_rule.list()).toEqual({
    items: [created],
    nextCursor: null,
  });
});

test("database CHECK constraints reject rows that bypass the entity schema", async () => {
  const { db } = await runtime.runPromise(Database.Service);
  // Stores hold decoded values, including the branded provider.
  const stored = Schema.decodeUnknownSync(AlertableDefinition)(input.alertable);
  const insert = (row: Partial<typeof alertRules.$inferInsert>) =>
    runtime.runPromise(
      db.transaction((tx) =>
        tx
          .insert(alertRules)
          .values({ id: "alr_check", ...input, alertable: stored, ...row }),
      ),
    );
  for (const row of [
    { name: "   " },
    { name: "n".repeat(161) },
    { alertable: { ...stored, source: "" } },
    { alertable: { ...stored, source: "x".repeat(65537) } },
    { alertable: { ...stored, config: [] } as never },
    { alertable: {} as never },
    { alertable: { ...stored, kind: "file" } as never },
    { alertable: { ...stored, source: 12 } as never },
    { revision: 0 },
  ]) {
    await expect(insert(row)).rejects.toBeDefined();
  }
  expect(await caller.resources.alert_rule.list()).toEqual({
    items: [],
    nextCursor: null,
  });
  await expect(
    insert({}).then(() =>
      runtime.runPromise(
        Effect.map(db.select().from(alertRules), (rows) => rows.length),
      ),
    ),
  ).resolves.toBe(1);
});

// Saving validates the Indicator (save-alert-rule.test.ts); storage keeps it by value.
test("a tea rule may follow an Indicator by id, with no foreign key", async () => {
  const following = {
    indicatorId: "ind_followed",
    parameters: { threshold: 200 },
    requests: {},
  };
  const created = await runtime.runPromise(
    Transactor.run(
      alertRuleResource.transitions.create(
        Schema.decodeUnknownSync(alertRuleResource.body)({
          ...input,
          alertable: { ...input.alertable, config: following },
        }),
      ),
    ),
  );
  expect(created.alertable).toEqual({ ...input.alertable, config: following });
  expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
    created,
  );
});

test("persists only the validated drawing reference, condition, and market inputs", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "Lines" });
  const drawing = await caller.resources.drawing.create({
    dashboardId: dashboard.id,
    provider: inputs.provider,
    listing: inputs.listing,
    data: Drawing.create("horizontal_line", [{ time: 60, price: 200 }], {
      id: "line",
    }),
  });
  const value = {
    name: "Cross trend line",
    enabled: false,
    alertable: { ...drawingDefinition, drawingId: drawing.id },
  };
  const created = await caller.resources.alert_rule.save({ value });
  expect(created.alertable).toEqual(value.alertable);
  const updated = await caller.resources.alert_rule.save({
    rule: { id: created.id, expectedRevision: created.revision },
    value: {
      ...value,
      alertable: { ...value.alertable, operator: "crossing_down" },
    },
  });
  expect(updated.alertable).toEqual({
    ...value.alertable,
    operator: "crossing_down",
  });
  expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
    updated,
  );
});

test.each([
  ["missing drawing", { drawingId: undefined }],
  ["wrong drawing prefix", { drawingId: "chart_saved" }],
  ["unknown operator", { operator: "greater_than" }],
  ["missing market inputs", { inputs: undefined }],
  ["invalid market inputs", { inputs: { ...inputs, resolution: "2m" } }],
  ["copied geometry", { anchors: [] }],
  ["copied Tea source", { source: input.alertable.source }],
])("rejects drawing definitions with %s", async (_, invalid) => {
  await expect(
    caller.resources.alert_rule.save({
      value: {
        name: "Invalid drawing alert",
        alertable: { ...drawingDefinition, ...invalid },
      } as never,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
