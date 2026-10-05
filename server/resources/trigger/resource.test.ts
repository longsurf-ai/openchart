// Purpose: Verifies Trigger CRUD, strict event and target unions, the missing Rule foreign key, and CHECK constraints.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { router } from "@openchart/server";
import { Database } from "@openchart/server/db";
import {
  type Change,
  installEventDetector,
} from "@openchart/server/db/event-detector";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { makeRuntime } from "@openchart/server/runtime";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { triggers } from "./schema";

const agentPrompt = {
  kind: "agent_prompt" as const,
  prompt: {
    agent: "analyst",
    model: { providerID: "codex" as const, modelID: "tier1" as const },
    parts: [{ type: "text" as const, text: "Review this alert." }],
  },
};
// Triggers hold no foreign key, so the Rule does not need to exist.
const event = { kind: "alert" as const, ruleId: "alr_missing" };
const input = {
  name: "Desktop",
  event,
  target: {
    kind: "notification" as const,
    message: "{symbol} has exceeded {threshold}",
  },
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

test("creates both targets, reads, pages, patches, and deletes through the shared Resource API", async () => {
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");
  const created = await caller.resources.trigger.create(input);
  expect(created).toMatchObject({ ...input, revision: 1, enabled: true });
  expect(created.id).toMatch(/^trg_/);
  expect(publish).toHaveBeenCalledExactlyOnceWith(ResourceChanged, {
    resource: "trigger",
    id: created.id,
    revision: 1,
  });
  const agent = await caller.resources.trigger.create({
    ...input,
    name: "Agent",
    enabled: false,
    target: { ...agentPrompt, binding: { key: "alert:review" } },
  });
  expect(agent).toMatchObject({
    enabled: false,
    target: { ...agentPrompt, binding: { key: "alert:review" } },
  });
  expect(await caller.resources.trigger.get({ id: created.id })).toEqual(
    created,
  );
  expect(await caller.resources.trigger.list()).toEqual({
    items: [created, agent],
    nextCursor: null,
  });
  const patched = await caller.resources.trigger.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [
      { op: "replace", path: "/target", value: agentPrompt },
      { op: "replace", path: "/enabled", value: false },
    ],
  });
  expect(patched).toMatchObject({
    target: agentPrompt,
    enabled: false,
    revision: 2,
  });
  await caller.resources.trigger.delete({ id: created.id });
  await expect(
    caller.resources.trigger.get({ id: created.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("notification sound overrides persist and can return to the profile default", async () => {
  const created = await caller.resources.trigger.create({
    ...input,
    target: { ...input.target, sound: "glass" },
  });
  expect(
    (await caller.resources.trigger.get({ id: created.id })).target,
  ).toEqual({
    ...input.target,
    sound: "glass",
  });
  await caller.resources.trigger.patch({
    id: created.id,
    expectedRevision: created.revision,
    operations: [{ op: "remove", path: "/target/sound" }],
  });
  expect(
    (await caller.resources.trigger.get({ id: created.id })).target,
  ).toEqual(input.target);
});

test.each([
  ["a blank name", { name: "   " }],
  ["a name over 160 characters", { name: "n".repeat(161) }],
  [
    "an empty notification message",
    { target: { kind: "notification", message: "" } },
  ],
  ["a missing notification message", { target: { kind: "notification" } }],
  [
    "an unknown notification sound",
    { target: { ...input.target, sound: "unknown" } },
  ],
  [
    "a notification sound path",
    { target: { ...input.target, sound: "../custom.wav" } },
  ],
  ["a null notification sound", { target: { ...input.target, sound: null } }],
  ["the removed template", { template: "x" }],
  [
    "an unknown event kind",
    { event: { kind: "schedule", ruleId: event.ruleId } },
  ],
  ["an event without its rule", { event: { kind: "alert" } }],
  ["an empty rule id", { event: { kind: "alert", ruleId: "" } }],
  ["an extra event property", { event: { ...event, condition: "above" } }],
  ["an unknown target kind", { target: { kind: "email" } }],
  [
    "an extra notification property",
    { target: { kind: "notification", title: "Hi" } },
  ],
  ["an agent target without a prompt", { target: { kind: "agent_prompt" } }],
  ["an extra agent target property", { target: { ...agentPrompt, extra: 1 } }],
  [
    "text alongside a workflow",
    {
      target: {
        ...agentPrompt,
        prompt: {
          ...agentPrompt.prompt,
          parts: [
            ...agentPrompt.prompt.parts,
            {
              type: "workflow",
              workflow: "default:workflows/multi-turn-debate.workflow.ts",
              args: { round: 3, topic: "Should I buy AAPL?" },
            },
          ],
        },
      },
    },
  ],
  [
    "an empty binding key",
    { target: { ...agentPrompt, binding: { key: "" } } },
  ],
  ["an unknown field", { ruleId: event.ruleId }],
])("rejects %s on create and patch without persisting", async (_, invalid) => {
  await expect(
    caller.resources.trigger.create({ ...input, ...invalid } as never),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const created = await caller.resources.trigger.create(input);
  const [key, value] = Object.entries(invalid)[0]!;
  await expect(
    caller.resources.trigger.patch({
      id: created.id,
      expectedRevision: 1,
      operations: [{ op: "add", path: `/${key}`, value }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.resources.trigger.list()).toEqual({
    items: [created],
    nextCursor: null,
  });
});

test("database CHECK constraints reject rows that bypass the entity schema", async () => {
  const { db } = await runtime.runPromise(Database.Service);
  const insert = (row: Partial<typeof triggers.$inferInsert>) =>
    runtime.runPromise(
      db.transaction((tx) =>
        tx.insert(triggers).values({ id: "trg_check", ...input, ...row }),
      ),
    );
  for (const row of [
    { name: "   " },
    { name: "n".repeat(161) },
    { event: [] as never },
    { target: "notification" as never },
  ]) {
    await expect(insert(row)).rejects.toBeDefined();
  }
  await insert({});
  expect((await caller.resources.trigger.list()).items).toHaveLength(1);
});

test("a migrated database accepts the keyword table name, change detection, and the Rule cascade", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_alert-trigger"),
      );
      expect(index).toBeGreaterThan(0);
      // Runtime tests load the fresh schema; this path applies the migration itself.
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* DatabaseMigration.apply(db);
      const changes: Change[] = [];
      yield* installEventDetector(db.$client, (batch) =>
        Effect.sync(() => void changes.push(...batch)),
      );
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.run(
            `INSERT INTO alert_rule (id,name,alertable_json) VALUES ('alr_a','Rule','{"kind":"tea","source":"x","config":{}}')`,
          );
          yield* tx.run(
            `INSERT INTO alert_event (id,rule_id,condition,time,detail_json) VALUES ('ale_a','alr_a','above',0,'{}')`,
          );
          yield* tx.run(
            `INSERT INTO trigger (id,name,event_json,target_json) VALUES ('trg_a','Desktop','{}','{}')`,
          );
        }),
      );
      yield* db.transaction((tx) =>
        tx.run("DELETE FROM alert_rule WHERE id = 'alr_a'"),
      );
      expect(changes.map(({ table, id }) => `${table}:${id}`)).toEqual([
        "alert_event:ale_a",
        "alert_rule:alr_a",
        "trigger:trg_a",
        "alert_event:ale_a",
        "alert_rule:alr_a",
      ]);
      expect(yield* db.all("SELECT id FROM alert_event")).toEqual([]);
      expect(yield* db.all("SELECT enabled FROM trigger")).toEqual([
        { enabled: 1 },
      ]);
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
