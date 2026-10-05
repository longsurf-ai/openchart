// Purpose: Proves binding migrations preserve session history, run intents, and scheduled targets.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import {
  agentMessages,
  agentParts,
  agentRun,
  agentSessionBindings,
  agentTodos,
} from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import {
  AgentScheduleTarget,
  agentSchedules,
} from "@openchart/server/resources/agent-schedule/schema";
import { getTableColumns, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

test("upgrades populated bindings and scheduled targets without changing session history", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_simplify-agent-binding"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.run(sql`
        INSERT INTO agent_session_bindings
          (id, user_id, surface, feature_key, created_at, updated_at)
        VALUES ('chart-binding', 'user', 'chart_explain', 'shared', 10, 20),
          ('watchlist-binding', 'user', 'watchlist_builder', 'shared', 30, 40)
      `);
      yield* db.run(sql`
        INSERT INTO agent_sessions
          (id, user_id, title, binding_id, binding_generation,
            binding_superseded_at, binding_rotation_intent_id, created_at, updated_at)
        VALUES ('history', 'user', 'Previous analysis', 'chart-binding', 1, 50, NULL, 10, 50),
          ('current', 'user', 'Current analysis', 'chart-binding', 2, NULL, 'rotate', 50, 60),
          ('watchlist', 'user', 'Watchlist builder', 'watchlist-binding', 1, NULL, NULL, 30, 40)
      `);
      const prompt = {
        agent: "analyst",
        model: { providerID: "codex" as const, modelID: "tier1" as const },
        parts: [{ type: "text", text: "Analyze this." }],
      };
      const target = { kind: "agent_prompt", prompt };
      const recurrence = {
        kind: "once",
        fireAt: "2026-09-08T00:00:00.000Z",
      };
      const scheduledTargets = [
        {
          ...target,
          binding: { surface: "chart_explain", key: "shared" },
        },
        {
          ...target,
          binding: { surface: "watchlist_builder", key: "shared" },
        },
        target,
      ];
      for (const [index, scheduledTarget] of scheduledTargets.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_schedule
            (id, user_id, name, target_json, recurrence, next_fire_at,
              revision, created_at, updated_at)
          VALUES (${`schedule-${index}`}, 'user', 'Analysis',
            ${JSON.stringify(scheduledTarget)}, ${JSON.stringify(recurrence)},
            100, 7, 10, 20)
        `);
      }
      const sessionsBefore = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(
        yield* db
          .select()
          .from(agentSessionBindings)
          .orderBy(agentSessionBindings.id),
      ).toEqual([
        {
          id: "chart-binding",
          key: "chart_explain:shared",
          createdAt: 10,
          updatedAt: 20,
        },
        {
          id: "watchlist-binding",
          key: "watchlist_builder:shared",
          createdAt: 30,
          updatedAt: 40,
        },
      ]);
      expect(yield* db.select().from(agentSessions)).toEqual(
        sessionsBefore.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      const schedules = yield* db
        .select()
        .from(agentSchedules)
        .orderBy(agentSchedules.id);
      expect(schedules.map((schedule) => schedule.target)).toEqual([
        { ...target, binding: { key: "chart_explain:shared" } },
        { ...target, binding: { key: "watchlist_builder:shared" } },
        target,
      ]);
      for (const schedule of schedules) {
        expect(
          Schema.decodeUnknownSync(AgentScheduleTarget)(schedule.target),
        ).toEqual(schedule.target);
        expect(schedule).toMatchObject({
          name: "Analysis",
          recurrence,
          nextFireAt: 100,
          revision: 7,
          createdAt: 10,
          updatedAt: 20,
        });
      }
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_session_bindings)`,
        )).map((column) => column.name),
      ).toEqual(["id", "key", "created_at", "updated_at"]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
      expect(yield* db.all(sql`PRAGMA defer_foreign_keys`)).toEqual([
        { defer_foreign_keys: 0 },
      ]);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            db.run(
              sql`DELETE FROM agent_session_bindings WHERE id = 'chart-binding'`,
            ),
          ),
        ),
      ).toBe(true);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("removes rotation intent identity while preserving binding history and run intent", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-binding-rotation-intent"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.insert(agentSessionBindings).values({
        id: "binding",
        key: "research",
      });
      yield* db.run(sql`
        INSERT INTO agent_sessions
          (id, title, binding_id, binding_generation, binding_superseded_at,
            binding_rotation_intent_id, created_at, updated_at)
        VALUES ('history', 'Previous analysis', 'binding', 1, 200, 'first', 100, 200),
          ('current', 'Current analysis', 'binding', 2, NULL, 'second', 200, 300)
      `);
      yield* db.insert(agentRun).values({
        id: "run",
        sessionId: "current",
        sessionIntentId: "prompt-intent",
        input: {
          agent: "analyst",
          model: { providerID: "codex" as const, modelID: "tier1" as const },
          parts: [{ type: "text", text: "Analyze this." }],
        },
        status: "queued",
        queuePosition: 0,
        createdAt: 200,
      });
      const sessions = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      const bindings = yield* db.select().from(agentSessionBindings);
      const runs = yield* db.select().from(agentRun);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(yield* db.select().from(agentSessions)).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      expect(yield* db.select().from(agentSessionBindings)).toEqual(bindings);
      expect(yield* db.select().from(agentRun)).toEqual(runs);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_sessions)`,
        )).map((column) => column.name),
      ).not.toContain("binding_rotation_intent_id");
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema
          WHERE name = 'uniq_agent_sessions_binding_rotation_intent'
        `),
      ).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("removes superseded timestamps while preserving history and current session", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-binding-superseded-at"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.insert(agentSessionBindings).values([
        { id: "binding", key: "research" },
        { id: "other-binding", key: "other-research" },
      ]);
      yield* db.run(sql`
        INSERT INTO agent_sessions
          (id, title, binding_id, binding_generation, binding_superseded_at,
            created_at, updated_at)
        VALUES ('history', 'Previous analysis', 'binding', 1, 200, 100, 200),
          ('current', 'Current analysis', 'binding', 2, NULL, 200, 300),
          ('other', 'Other analysis', 'other-binding', 9, NULL, 100, 400)
      `);
      const sessions = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      const bindings = yield* db.select().from(agentSessionBindings);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(yield* db.select().from(agentSessions)).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      expect(yield* db.select().from(agentSessionBindings)).toEqual(bindings);
      expect(
        yield* db.all(sql`
          SELECT id FROM agent_sessions WHERE binding_id = 'binding'
          ORDER BY created_at DESC, id DESC LIMIT 1
        `),
      ).toEqual([{ id: "current" }]);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_sessions)`,
        )).map((column) => column.name),
      ).not.toContain("binding_superseded_at");
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema
          WHERE name = 'uniq_agent_sessions_binding_current'
        `),
      ).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("removes generations while preserving session timestamps and dependent data", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-binding-generation"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.insert(agentSessionBindings).values([
        { id: "binding", key: "research" },
        { id: "other-binding", key: "other-research" },
      ]);
      yield* db.run(sql`
        INSERT INTO agent_sessions
          (id, parent_id, title, binding_id, binding_generation, created_at, updated_at)
        VALUES ('history', NULL, 'Previous analysis', 'binding', 1, 100, 900),
          ('current', 'history', 'Current analysis', 'binding', 2, 200, 300),
          ('other', NULL, 'Other analysis', 'other-binding', 1, 500, 600)
      `);
      yield* db.insert(agentMessages).values({
        id: "message",
        sessionId: "history",
        role: "user",
        data: {
          time: { created: 100 },
          agent: "analyst",
          model: { providerID: "codex" as const, modelID: "tier1" as const },
        },
        createdAt: 100,
        updatedAt: 150,
      });
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, session_id, data, created_at, updated_at)
        VALUES ('part', 'message', 'history', '{"type":"text","text":"Preserve the analysis."}', 100, 150)
      `);
      yield* db.insert(agentTodos).values({
        id: "todo",
        sessionId: "history",
        content: "Research the company.",
        status: "pending",
        priority: "high",
        position: 0,
      });
      const sessions = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      const bindings = yield* db.select().from(agentSessionBindings);
      const messages = yield* db.select().from(agentMessages);
      const parts = yield* db.select().from(agentParts);
      const todos = yield* db.select().from(agentTodos);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(yield* db.select().from(agentSessions)).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      expect(yield* db.select().from(agentSessionBindings)).toEqual(bindings);
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.select().from(agentParts)).toEqual(parts);
      expect(yield* db.select().from(agentTodos)).toEqual(todos);
      expect(
        yield* db.all(sql`
          SELECT id FROM agent_sessions WHERE binding_id = 'binding'
          ORDER BY created_at DESC, id DESC LIMIT 1
        `),
      ).toEqual([{ id: "current" }]);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_sessions)`,
        )).map((column) => column.name),
      ).not.toContain("binding_generation");
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA index_info(idx_agent_sessions_binding)`,
        )).map((column) => column.name),
      ).toEqual(["binding_id", "created_at", "id"]);
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema
          WHERE name = 'uniq_agent_sessions_binding_generation'
        `),
      ).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("rolls back a key collision instead of merging existing binding slots", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_simplify-agent-binding"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.run(sql`
        INSERT INTO agent_session_bindings (id, user_id, surface, feature_key)
        VALUES ('first', 'user-a', 'chart_explain', 'shared'),
          ('second', 'user-b', 'chart_explain', 'shared')
      `);
      const before = yield* db.all(sql`SELECT * FROM agent_session_bindings`);
      expect(
        Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
      ).toBe(true);
      expect(yield* db.all(sql`SELECT * FROM agent_session_bindings`)).toEqual(
        before,
      );
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.slice(0, upgradeIndex).map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
