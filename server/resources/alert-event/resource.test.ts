// Purpose: Verifies read-only Alert Event exposure, backend writes, validation, Rule filtering, and Rule cascades.

import { router } from "@openchart/server";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { AlertRuleId } from "@openchart/server/resources/alert-rule";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import type { inferRouterInputs } from "@trpc/server";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";

import { alertEventResource } from "./resource";
import { AlertEventDetail, alertEvents } from "./schema";

const inputs = {
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m" as const,
  session: "regular" as const,
  adjustment: "raw" as const,
};
const rule = {
  name: "AAPL above 200",
  enabled: false,
  repeat: true,
  alertable: {
    kind: "tea" as const,
    source:
      'threshold = input.float(200)\nalertcondition("above", close > threshold, "Above", "AAPL crossed 200")',
    config: barsRuleConfig(inputs, { threshold: 200 }),
  },
};
// Backend writers hold decoded values, including the branded provider.
const detail = Schema.decodeUnknownSync(AlertEventDetail)({
  title: "Above",
  message: "AAPL crossed 200",
  data: { inputs, parameters: { threshold: 200 }, values: { close: 201.5 } },
});
let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;
let ruleId: AlertRuleId;
beforeEach(async () => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
  caller = router.createCaller({ runtime });
  ruleId = (await caller.resources.alert_rule.save({ value: rule })).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

const create = (
  body: Parameters<typeof alertEventResource.transitions.create>[0],
) =>
  runtime.runPromise(
    Transactor.run(alertEventResource.transitions.create(body)),
  );

test("exposes read-only queries while internal operations stay complete", async () => {
  type Inputs = inferRouterInputs<typeof router>;
  expectTypeOf<keyof Inputs["resources"]["alert_event"]>().toEqualTypeOf<
    "get" | "list"
  >();
  expectTypeOf<keyof typeof alertEventResource.transitions>().toEqualTypeOf<
    "get" | "list" | "listAll" | "create" | "patch" | "remove"
  >();
  for (const name of ["create", "patch", "delete"] as const) {
    await expect(
      // @ts-expect-error Intrinsic mutations are intentionally absent from the API.
      caller.resources.alert_event[name]({}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
});

test("backend creation records identical fires as separate events and lists them by Rule", async () => {
  const other = await caller.resources.alert_rule.save({ value: rule });
  const body = { ruleId, condition: "above", time: 60_000, detail };
  const first = await create(body);
  const second = await create(body);
  const foreign = await create({ ...body, ruleId: other.id });
  expect(first).toMatchObject({ ...body, revision: 1 });
  expect(first.id).toMatch(/^ale_/);
  expect(second).toMatchObject(body);
  expect(second.id).not.toBe(first.id);
  expect(await caller.resources.alert_event.get({ id: first.id })).toEqual(
    first,
  );
  expect(
    await caller.resources.alert_event.list({ filter: { ruleId } }),
  ).toEqual({ items: [first, second], nextCursor: null });
  const page = await caller.resources.alert_event.list({
    filter: { ruleId: other.id },
    limit: 1,
  });
  expect(page).toEqual({ items: [foreign], nextCursor: null });
  await expect(
    caller.resources.alert_event.list({
      filter: { ruleId: "garbage" } as never,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.alert_event.list({ filter: { time: 60_000 } as never }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("invalid backend bodies roll back without events", async () => {
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const body = { ruleId, condition: "above", time: 60_000, detail };
  for (const invalid of [
    {},
    { ...body, ruleId: AlertRuleId.create() },
    { ...body, ruleId: "rule" },
    { ...body, condition: "" },
    { ...body, time: -1 },
    { ...body, time: 1.5 },
    { ...body, detail: { ...detail, title: 12 } },
    { ...body, detail: { ...detail, text: "rendered" } },
    { ...body, detail: { ...detail, data: [] } },
  ]) {
    await expect(create(invalid as never)).rejects.toBeDefined();
  }
  expect(await caller.resources.alert_event.list()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(publish).not.toHaveBeenCalled();
});

test("database CHECK and foreign-key constraints reject rows that bypass the entity schema", async () => {
  const { db } = await runtime.runPromise(Database.Service);
  const row = { id: "ale_check", ruleId, condition: "above", time: 0, detail };
  const insert = (change: Partial<typeof alertEvents.$inferInsert>) =>
    runtime.runPromise(
      db.transaction((tx) =>
        tx.insert(alertEvents).values({ ...row, ...change }),
      ),
    );
  for (const change of [
    { condition: "" },
    { time: -1 },
    { detail: [] as never },
    { ruleId: "alr_missing" },
  ]) {
    await expect(insert(change)).rejects.toBeDefined();
  }
  await insert({});
  expect((await caller.resources.alert_event.list()).items).toHaveLength(1);
});

test("deleting a Rule cascades only its events and publishes every removal", async () => {
  const other = await caller.resources.alert_rule.save({ value: rule });
  const body = { ruleId, condition: "above", time: 60_000, detail };
  const removed = [await create(body), await create(body)];
  const kept = await create({ ...body, ruleId: other.id });
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  await caller.resources.alert_rule.delete({ id: ruleId });
  expect(await caller.resources.alert_event.list()).toEqual({
    items: [kept],
    nextCursor: null,
  });
  expect(
    publish.mock.calls.map(([schema, value]) => ({ schema, value })),
  ).toEqual(
    expect.arrayContaining(
      [
        { resource: "alert_rule", id: ruleId },
        ...removed.map(({ id }) => ({ resource: "alert_event", id })),
      ].map((value) => ({
        schema: ResourceChanged,
        value: { ...value, revision: 1 },
      })),
    ),
  );
  expect(publish).toHaveBeenCalledTimes(3);
});
