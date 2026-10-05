// Purpose: Verifies atomic Alert fire recording, legal duplicates, one-shot retirement, and skipped Rules.

import { router } from "@openchart/server";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import {
  AlertEventDetail,
  alertEventResource,
} from "@openchart/server/resources/alert-event";
import { AlertRuleId } from "@openchart/server/resources/alert-rule";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { BarsSeries } from "@openchart/feed/bars";
import { makeRuntime } from "@openchart/server/runtime";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { recordAlertFire } from "./record-alert-fire";

const inputs = {
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m" as const,
  session: "regular" as const,
  adjustment: "raw" as const,
};
const rule = {
  name: "AAPL above 200",
  alertable: {
    kind: "tea" as const,
    source:
      'threshold = input.float(200)\nalertcondition("above", close > threshold, "Above", "AAPL crossed 200")',
    config: barsRuleConfig(inputs, { threshold: 200 }),
  },
};
const fire = {
  condition: "above",
  time: 60_000,
  // The Alert service holds decoded values, including the branded provider.
  detail: Schema.decodeUnknownSync(AlertEventDetail)({
    title: "Above",
    message: "AAPL crossed 200",
    data: { inputs, parameters: { threshold: 200 }, values: { close: 201.5 } },
  }),
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

const record = (ruleId: AlertRuleId, expectedRevision = 1) =>
  runtime.runPromise(
    Transactor.run(recordAlertFire({ ruleId, expectedRevision, ...fire })),
  );

test("identical fires of a repeating Rule record two events and leave it enabled", async () => {
  const created = await caller.resources.alert_rule.save({
    value: {
      ...rule,
      repeat: true,
    },
  });
  const first = await record(created.id);
  const second = await record(created.id);
  expect(first).toMatchObject({ ruleId: created.id, ...fire, revision: 1 });
  expect(second).toMatchObject({ ruleId: created.id, ...fire });
  expect(second!.id).not.toBe(first!.id);
  expect(await caller.resources.alert_event.list()).toEqual({
    items: [first, second],
    nextCursor: null,
  });
  expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
    created,
  );
  const posts = await caller.resources.post.list();
  expect(posts.items).toHaveLength(2);
  expect(posts.items.map((post) => post.origin)).toEqual([
    {
      kind: "alert_event",
      eventId: first!.id,
      ruleId: created.id,
      occurredAt: fire.time,
    },
    {
      kind: "alert_event",
      eventId: second!.id,
      ruleId: created.id,
      occurredAt: fire.time,
    },
  ]);
});

test("a one-shot fire disables its Rule in the same transaction, so the next fire is skipped", async () => {
  const created = await caller.resources.alert_rule.save({ value: rule });
  const { db } = await runtime.runPromise(Database.Service);
  const transaction = vi.spyOn(db, "transaction");
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const event = await record(created.id);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(
    publish.mock.calls.map(([schema, value]) => ({ schema, value })),
  ).toEqual(
    expect.arrayContaining([
      {
        schema: ResourceChanged,
        value: { resource: "alert_event", id: event!.id, revision: 1 },
      },
      {
        schema: ResourceChanged,
        value: { resource: "alert_rule", id: created.id, revision: 2 },
      },
    ]),
  );
  expect(publish).toHaveBeenCalledTimes(3);
  expect(await record(created.id)).toBeNull();
  expect(await caller.resources.alert_event.list()).toEqual({
    items: [event],
    nextCursor: null,
  });
  expect(
    await caller.resources.alert_rule.get({ id: created.id }),
  ).toMatchObject({ enabled: false, repeat: false, revision: 2 });
  expect(publish).toHaveBeenCalledTimes(3);
});

test("long Alert text preserves the complete Event and retires Once while publishing a bounded Post", async () => {
  const created = await caller.resources.alert_rule.save({ value: rule });
  const detail = {
    title: "Volume",
    message: "😀".repeat(500),
    data: { symbol: "AAPL", value: 200 },
  };
  const event = await runtime.runPromise(
    Transactor.run(
      recordAlertFire({
        ...fire,
        ruleId: created.id,
        expectedRevision: created.revision,
        detail,
      }),
    ),
  );
  expect(event?.detail).toEqual(detail);
  expect(
    await caller.resources.alert_event.get({ id: event!.id }),
  ).toMatchObject({ detail });
  const post = await caller.resources.post.byAlertEvent({ eventId: event!.id });
  const prefix = "AAPL · Value: 200\n\nVolume\n\n";
  expect(post?.content).toEqual([
    { type: "text", text: `${prefix}${"😀".repeat(349 - prefix.length)}…` },
  ]);
  expect(
    await caller.resources.alert_rule.get({ id: created.id }),
  ).toMatchObject({ enabled: false, revision: 2 });
});

test("a disabled or missing Rule returns null and writes nothing", async () => {
  const disabled = await caller.resources.alert_rule.save({
    value: {
      ...rule,
      enabled: false,
    },
  });
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  expect(await record(disabled.id)).toBeNull();
  expect(await record(AlertRuleId.create())).toBeNull();
  expect(await caller.resources.alert_event.list()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(await caller.resources.alert_rule.get({ id: disabled.id })).toEqual(
    disabled,
  );
  expect(publish).not.toHaveBeenCalled();
});

test("a failed event write leaves a one-shot Rule enabled", async () => {
  const created = await caller.resources.alert_rule.save({ value: rule });
  const insert = alertEventResource.store.insert;
  vi.spyOn(alertEventResource.store, "insert").mockImplementation((tx, input) =>
    insert(tx, input).pipe(Effect.map((row) => ({ ...row, revision: 0 }))),
  );
  await expect(record(created.id)).rejects.toThrow("failed its entity schema");
  expect(await caller.resources.alert_event.list()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
    created,
  );
});

test("an old observer revision cannot record after the Rule was edited", async () => {
  const created = await caller.resources.alert_rule.save({
    value: {
      ...rule,
      repeat: true,
    },
  });
  const edited = await caller.resources.alert_rule.patch({
    id: created.id,
    expectedRevision: created.revision,
    operations: [{ op: "replace", path: "/name", value: "Edited" }],
  });
  expect(await record(created.id, created.revision)).toBeNull();
  expect((await caller.resources.alert_event.list()).items).toEqual([]);
  expect(await record(edited.id, edited.revision)).not.toBeNull();
});

test("drawing fires require the observed drawing revision even before its change is consumed", async () => {
  const dashboard = await caller.resources.dashboard.create({ name: "Lines" });
  const drawing = await caller.resources.drawing.create({
    dashboardId: dashboard.id,
    provider: inputs.provider,
    listing: inputs.listing,
    data: Drawing.create("horizontal_line", [{ time: 60, price: 200 }], {
      id: "line",
    }),
  });
  const linked = await caller.resources.alert_rule.save({
    value: {
      name: "Linked",
      repeat: true,
      alertable: {
        kind: "drawing",
        drawingId: drawing.id,
        operator: "crossing_up",
        inputs,
      },
    },
  });
  const fireFrom = (revision: number) =>
    runtime.runPromise(
      Transactor.run(
        recordAlertFire({
          ruleId: linked.id,
          expectedRevision: linked.revision,
          expectedDrawing: { id: drawing.id, revision },
          ...fire,
        }),
      ),
    );
  expect(await record(linked.id)).toBeNull();
  expect(await fireFrom(drawing.revision)).not.toBeNull();
  const moved = await caller.resources.drawing.patch({
    id: drawing.id,
    expectedRevision: drawing.revision,
    operations: [{ op: "replace", path: "/data/anchors/0/price", value: 220 }],
  });
  expect(await fireFrom(drawing.revision)).toBeNull();
  expect(await fireFrom(moved.revision)).not.toBeNull();
  await caller.resources.drawing.delete({ id: drawing.id });
  expect(await fireFrom(moved.revision)).toBeNull();
  expect((await caller.resources.alert_event.list()).items).toHaveLength(2);
});

test("Indicator fires require the observed Indicator revision and cell market", async () => {
  const dashboard = await caller.resources.dashboard.create({
    name: "Research",
  });
  const chart = await caller.resources.chart.create({
    dashboardId: dashboard.id,
    cells: [
      {
        id: "ccl_a",
        resolution: inputs.resolution,
        session: inputs.session,
        adjustment: inputs.adjustment,
        marketSources: [
          { id: "cms_a", provider: inputs.provider, listing: inputs.listing },
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
  const { indicator } = await caller.resources.macro.addIndicator({
    chartId: chart.id,
    expectedRevision: chart.revision,
    cellId: "ccl_a",
    source: await caller.indicators.install({ id: "sma" }),
    parameterOverrides: {},
  });
  // Save validates the rule, so it carries the source's complete parameters.
  const followed = await caller.resources.alert_rule.save({
    value: {
      name: "Above SMA",
      repeat: true,
      alertable: {
        kind: "tea",
        source: rule.alertable.source,
        config: {
          indicatorId: indicator.id,
          parameters: { threshold: 200 },
          requests: {},
        },
      },
    },
  });
  const fireFrom = (revision: number, market: typeof inputs) =>
    runtime.runPromise(
      Transactor.run(
        recordAlertFire({
          ruleId: followed.id,
          expectedRevision: followed.revision,
          expectedIndicator: {
            id: indicator.id,
            revision,
            // The Alert service holds the decoded, branded market.
            market: Schema.decodeUnknownSync(BarsSeries)(market),
          },
          ...fire,
        }),
      ),
    );
  expect(await record(followed.id)).toBeNull();
  expect(await fireFrom(indicator.revision, inputs)).not.toBeNull();
  const tuned = await caller.resources.indicator.patch({
    id: indicator.id,
    expectedRevision: indicator.revision,
    operations: [
      { op: "replace", path: "/parameterOverrides", value: { length: 5 } },
    ],
  });
  expect(await fireFrom(indicator.revision, inputs)).toBeNull();
  expect(await fireFrom(tuned.revision, inputs)).not.toBeNull();
  const current = await caller.resources.chart.get({ id: chart.id });
  const msft = { symbol: "MSFT", currency: "USD" };
  await caller.resources.chart.patch({
    id: chart.id,
    expectedRevision: current.revision,
    operations: [
      { op: "replace", path: "/cells/0/marketSources/0/listing", value: msft },
    ],
  });
  expect(await fireFrom(tuned.revision, inputs)).toBeNull();
  const moved = { ...inputs, listing: msft };
  expect(await fireFrom(tuned.revision, moved)).not.toBeNull();
  await caller.resources.indicator.delete({ id: indicator.id });
  expect(await fireFrom(tuned.revision, moved)).toBeNull();
  expect((await caller.resources.alert_event.list()).items).toHaveLength(3);
});

test("publishes the source Event's saved symbol and value without borrowing current Rule inputs", async () => {
  const created = await caller.resources.alert_rule.save({
    value: {
      ...rule,
      repeat: true,
    },
  });
  const event = await runtime.runPromise(
    Transactor.run(
      recordAlertFire({
        ruleId: created.id,
        expectedRevision: created.revision,
        ...fire,
        detail: {
          ...fire.detail,
          title: "Volume",
          message: "Threshold met",
          data: {
            symbol: "NVDA",
            value: 21.79,
            values: { value: 21.69 },
            inputs,
          },
        },
      }),
    ),
  );
  const original = await caller.resources.post.byAlertEvent({
    eventId: event!.id,
  });
  expect(original?.content).toEqual([
    {
      type: "text",
      text: "NVDA · Value: 21.79\n\nVolume\n\nThreshold met",
    },
  ]);
});
