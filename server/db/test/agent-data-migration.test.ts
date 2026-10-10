// Purpose: Proves Agent schema upgrades preserve runs and enforce durable content invariants.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { MessageInfo } from "@openchart/server/agent/contracts/message";
import * as Part from "@openchart/server/agent/contracts/part";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema, Result } from "effect";
import { expect, test } from "vitest";

import { UserData } from "@openchart/server/agent/session/message/data";
import {
  agentMessages,
  agentParts,
  agentPermissions,
  agentRun,
  agentSessionBindings,
  agentTodos,
} from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { agentScheduleOccurrences } from "@openchart/server/resources/agent-schedule-occurrence/schema";
import {
  AgentScheduleRecurrence,
  AgentScheduleTarget,
  agentSchedules,
} from "@openchart/server/resources/agent-schedule/schema";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { Database } from "@openchart/server/db";

const input = {
  agent: "analyst",
  model: { providerID: "codex" as const, modelID: "tier1" as const },
  parts: [{ type: "text" as const, text: "Analyze this." }],
};

test("preserves populated V2 run rows when adding the complete Agent data tables", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_agent-data"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  const throughAgentData = migrations.slice(0, upgradeIndex + 1);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.insert(agentRun).values([
        {
          id: "agr_queued",
          sessionId: "existing-session",
          sessionIntentId: "intent-queued",
          input,
          status: "queued",
          queuePosition: 0,
          createdAt: 100,
        },
        {
          id: "agr_running",
          sessionId: "existing-session",
          sessionIntentId: "intent-running",
          input,
          status: "running",
          createdAt: 90,
          startedAt: 95,
        },
        {
          id: "agr_completed",
          sessionId: "existing-session",
          sessionIntentId: "intent-completed",
          input,
          status: "completed",
          createdAt: 80,
          startedAt: 85,
          finishedAt: 89,
        },
        {
          id: "agr_failed",
          sessionId: "existing-session",
          sessionIntentId: "intent-failed",
          input,
          status: "failed",
          createdAt: 60,
          startedAt: 65,
          finishedAt: 70,
        },
      ]);
      const before = yield* db.select().from(agentRun);
      yield* DatabaseMigration.applyOnly(db, throughAgentData);
      yield* DatabaseMigration.applyOnly(db, throughAgentData);
      expect(yield* db.select().from(agentRun)).toEqual(before);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(throughAgentData.map(({ id }) => ({ id })));
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.select().from(agentSessions)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("keeps binding history, todo identity, transcript content, and occurrence deduplication", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.apply(db);
      yield* db.insert(agentSessionBindings).values({
        id: "binding",
        key: "chart_explain:chart",
      });
      yield* db.insert(agentSessionBindings).values({
        id: "opaque-binding",
        key: "feature-owned-key",
      });
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_session_bindings)`,
        )).map((column) => column.name),
      ).toEqual(["id", "key", "created_at", "updated_at"]);
      yield* db.insert(agentSessions).values([
        {
          kind: "chat",
          id: "ses_old",
          title: "Old",
          bindingId: "binding",
          createdAt: 100,
          updatedAt: 1000,
        },
        {
          kind: "chat",
          id: "ses_current",
          title: "Current",
          bindingId: "binding",
          createdAt: 200,
        },
        {
          id: "ses_fork",
          title: "Fork",
          parentId: "ses_old",
          kind: "dig_in",
        },
      ]);
      yield* db.insert(agentSessions).values({
        kind: "chat",
        id: "ses_next",
        title: "Next",
        bindingId: "binding",
        createdAt: 200,
      });
      expect(
        yield* db.all(sql`
          SELECT id FROM agent_sessions WHERE binding_id = 'binding'
          ORDER BY created_at DESC, id DESC LIMIT 1
        `),
      ).toEqual([{ id: "ses_next" }]);
      const content = Schema.decodeUnknownSync(UserData)({
        time: { created: 50 },
        agent: "analyst",
        model: input.model,
      });
      yield* db.insert(agentMessages).values({
        id: "msg_fork",
        sessionId: "ses_fork",
        role: "user",
        data: content,
        createdAt: 200,
      });
      yield* db.insert(agentParts).values({
        id: "prt_fork",
        messageId: "msg_fork",
        data: { type: "text", text: "Original", time: { start: 50 } },
        createdAt: 200,
      });
      const row = (yield* db.select().from(agentMessages).get())!;
      expect(row.createdAt).toBe(200);
      expect(
        Schema.decodeUnknownSync(MessageInfo)({
          ...row.data,
          id: row.id,
          sessionID: row.sessionId,
          role: row.role,
        }).time.created,
      ).toBe(50);
      const part = (yield* db.select().from(agentParts).get())!;
      expect(
        Schema.decodeUnknownSync(Part.Part)({
          ...part.data,
          id: part.id,
          messageID: part.messageId,
        }),
      ).toEqual({
        id: "prt_fork",
        messageID: "msg_fork",
        type: "text",
        text: "Original",
        time: { start: 50 },
      });
      yield* db.insert(agentTodos).values([
        {
          sessionId: "ses_fork",
          id: "todo_stable",
          content: "First",
          status: "pending",
          priority: "high",
          position: 0,
        },
        {
          sessionId: "ses_fork",
          id: "todo_second",
          content: "Second",
          status: "completed",
          priority: "low",
          position: 1,
        },
      ]);
      yield* db.run(sql`UPDATE agent_todos SET position = position + 10`);
      yield* db.run(sql`UPDATE agent_todos SET position = 11 - position`);
      expect(
        yield* db.all(
          sql`SELECT id, position FROM agent_todos ORDER BY position`,
        ),
      ).toEqual([
        { id: "todo_second", position: 0 },
        { id: "todo_stable", position: 1 },
      ]);
      yield* db
        .insert(agentPermissions)
        .values({ userId: "user", data: { yolo: false, rules: [] } });
      yield* db.insert(agentRun).values([
        {
          id: "agr_scheduled",
          sessionId: "ses_current",
          sessionIntentId: "scheduled",
          input,
          status: "queued",
          queuePosition: 0,
          createdAt: 100,
        },
        {
          id: "agr_other",
          sessionId: "ses_current",
          sessionIntentId: "other",
          input,
          status: "queued",
          queuePosition: 1,
          createdAt: 100,
        },
      ]);
      yield* db.insert(agentSchedules).values({
        id: "schedule",
        name: "Daily analysis",
        target: Schema.decodeUnknownSync(AgentScheduleTarget)({
          kind: "agent_prompt",
          prompt: input,
          binding: { key: "chart_explain:chart" },
        }),
        recurrence: Schema.decodeUnknownSync(AgentScheduleRecurrence)({
          kind: "cron",
          expression: "0 9 * * 1-5",
          timeZone: "America/New_York",
        }),
        nextFireAt: 100,
      });
      yield* db.insert(agentScheduleOccurrences).values({
        id: "occurrence",
        scheduleId: "schedule",
        agentRunId: "agr_scheduled",
        fireAt: 100,
      });

      const invalidWrites = [
        sql`INSERT INTO agent_session_bindings (id, key) VALUES ('blank', ' ')`,
        sql`INSERT INTO agent_session_bindings (id, key) VALUES ('duplicate', 'chart_explain:chart')`,
        sql`INSERT INTO agent_sessions (id, title, binding_id) VALUES ('missing-binding', 'Bad', 'missing')`,
        sql`UPDATE agent_messages SET data = json_set(data, '$.id', 'duplicate')`,
        sql`UPDATE agent_messages SET data = json_set(data, '$.role', 'user')`,
        sql`UPDATE agent_parts SET data = json_set(data, '$.messageID', 'duplicate')`,
        sql`INSERT INTO agent_todos (session_id, id, content, status, priority, position) VALUES ('ses_fork', 'new', 'Duplicate position', 'pending', 'low', 0)`,
        sql`INSERT INTO agent_todos (session_id, id, content, status, priority, position) VALUES ('ses_fork', 'todo_stable', 'Duplicate identity', 'pending', 'low', 5)`,
        sql`INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at) VALUES ('duplicate-slot', 'schedule', 'agr_other', 100)`,
        sql`INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at) VALUES ('duplicate-run', 'schedule', 'agr_scheduled', 200)`,
        sql`INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at) VALUES ('missing-schedule', 'missing', 'agr_other', 200)`,
        sql`INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at) VALUES ('missing-run', 'schedule', 'missing', 200)`,
        sql`UPDATE agent_schedule_occurrence SET revision = 0 WHERE id = 'occurrence'`,
        sql`DELETE FROM agent_run WHERE id = 'agr_scheduled'`,
        sql`DELETE FROM agent_session_bindings WHERE id = 'binding'`,
      ];
      for (const statement of invalidWrites) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      }
      yield* db.run(sql`DELETE FROM agent_sessions WHERE id = 'ses_fork'`);
      expect(yield* db.select().from(agentMessages)).toEqual([]);
      expect(yield* db.select().from(agentParts)).toEqual([]);
      expect(yield* db.select().from(agentTodos)).toEqual([]);
      const sessionColumns = yield* db.all<{ name: string; type: string }>(
        sql`PRAGMA table_info(agent_sessions)`,
      );
      expect(
        sessionColumns
          .filter((column) => column.name.endsWith("_at"))
          .every((column) => column.type === "INTEGER"),
      ).toBe(true);
      for (const removed of [
        "binding_generation",
        "version",
        "share_url",
        "trace_id",
        "span_id",
        "asset_type",
        "asset_id",
        "summary_additions",
        "summary_deletions",
        "summary_files",
        "summary_diffs",
      ]) {
        expect(sessionColumns.some((column) => column.name === removed)).toBe(
          false,
        );
      }
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("scheduled bindings accept only one nonempty opaque key", () => {
  const target = { kind: "agent_prompt", prompt: input };
  expect(Schema.decodeUnknownSync(AgentScheduleTarget)(target)).toEqual(target);
  expect(
    (
      Schema.decodeUnknownSync(AgentScheduleTarget)({
        ...target,
        binding: { key: "feature-owned-key" },
      }) as { binding?: unknown }
    ).binding,
  ).toEqual({ key: "feature-owned-key" });
  for (const binding of [
    {},
    { key: "" },
    { key: "chart", surface: "chart_explain" },
    { key: "chart", userId: "user" },
  ]) {
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(AgentScheduleTarget)({ ...target, binding }),
      ),
    ).toBe(false);
  }
});

test("Schedule and Occurrence have independent Resource change detection", async () => {
  const changes: unknown[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      const triggers = yield* db.all<{ name: string }>(sql`
        SELECT name FROM sqlite_temp_schema
        WHERE type = 'trigger' AND name LIKE 'resource_event_agent%'
        ORDER BY name
      `);
      expect(triggers.map((trigger) => trigger.name)).toEqual([
        "resource_event_agent_schedule_DELETE",
        "resource_event_agent_schedule_INSERT",
        "resource_event_agent_schedule_UPDATE",
        "resource_event_agent_schedule_occurrence_DELETE",
        "resource_event_agent_schedule_occurrence_INSERT",
        "resource_event_agent_schedule_occurrence_UPDATE",
      ]);
      yield* db.transaction((tx) =>
        tx.insert(agentSchedules).values({
          id: "schedule",
          name: "One-time analysis",
          target: { kind: "agent_prompt", prompt: input },
          recurrence: { kind: "once", fireAt: "2026-09-06T00:00:00.000Z" },
          nextFireAt: 100,
        }),
      );
      expect(changes).toEqual([
        { table: "agent_schedule", id: "schedule", revision: 1 },
      ]);
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "session", title: "Test" });
      yield* db.transaction((tx) =>
        tx.insert(agentRun).values({
          id: "agr_scheduled",
          sessionId: "session",
          sessionIntentId: "intent",
          input,
          status: "queued",
          queuePosition: 0,
          createdAt: 100,
        }),
      );
      yield* db.transaction((tx) =>
        tx.insert(agentScheduleOccurrences).values({
          id: "occurrence",
          scheduleId: "schedule",
          agentRunId: "agr_scheduled",
          fireAt: 100,
        }),
      );
      expect(changes).toEqual([
        { table: "agent_schedule", id: "schedule", revision: 1 },
        { table: "agent_schedule_occurrence", id: "occurrence", revision: 1 },
      ]);
      expect((yield* db.select().from(agentSchedules).get())?.revision).toBe(1);
    }).pipe(
      Effect.provide(
        Database.layer(":memory:", (batch) =>
          Effect.sync(() => {
            changes.push(...batch);
          }),
        ),
      ),
    ),
  );
});
