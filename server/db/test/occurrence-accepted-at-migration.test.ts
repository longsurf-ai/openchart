// Purpose: Proves acceptance timestamps survive consolidation into the Occurrence envelope.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { agentRun } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { agentScheduleOccurrences } from "@openchart/server/resources/agent-schedule-occurrence/schema";
import { agentSchedules } from "@openchart/server/resources/agent-schedule/schema";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("moves legacy acceptance into createdAt while preserving fire identities and relations", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-occurrence-accepted-at"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "session", title: "Research" });
      const input = {
        agent: "analyst",
        model: { providerID: "codex" as const, modelID: "tier1" as const },
        parts: [{ type: "text" as const, text: "Analyze this." }],
      };
      yield* db.run(sql`
        INSERT INTO agent_schedule
          (id, user_id, name, target_json, recurrence, next_fire_at)
        VALUES ('schedule', 'user', 'Research',
          ${JSON.stringify({ kind: "agent_prompt", prompt: input })},
          ${JSON.stringify({ kind: "cron", expression: "0 9 * * *", timeZone: "UTC" })},
          400)
      `);
      yield* db.insert(agentRun).values([
        {
          id: "run-first",
          sessionId: "session",
          sessionIntentId: "first",
          input,
          queuePosition: 0,
          createdAt: 150,
        },
        {
          id: "run-second",
          sessionId: "session",
          sessionIntentId: "second",
          input,
          queuePosition: 1,
          createdAt: 300,
        },
      ]);
      yield* db.run(sql`
        INSERT INTO agent_schedule_occurrence
          (id, schedule_id, agent_run_id, fire_at, accepted_at, created_at, updated_at, revision)
        VALUES ('occ-first', 'schedule', 'run-first', 100, 150, 200, 250, 3),
          ('occ-second', 'schedule', 'run-second', 280, 300, 300, 350, 5)
      `);
      const sessions = yield* db.select().from(agentSessions);
      const schedules = yield* db.select().from(agentSchedules);
      const runs = yield* db.select().from(agentRun).orderBy(agentRun.id);
      const indexes = yield* db.all(
        sql`PRAGMA index_list(agent_schedule_occurrence)`,
      );
      const foreignKeys = yield* db.all<{ from: string; on_delete: string }>(
        sql`PRAGMA foreign_key_list(agent_schedule_occurrence)`,
      );

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(
        yield* db
          .select()
          .from(agentScheduleOccurrences)
          .orderBy(agentScheduleOccurrences.fireAt),
      ).toEqual([
        {
          id: "occ-first",
          scheduleId: "schedule",
          agentRunId: "run-first",
          fireAt: 100,
          createdAt: 150,
          updatedAt: 250,
          revision: 3,
        },
        {
          id: "occ-second",
          scheduleId: "schedule",
          agentRunId: "run-second",
          fireAt: 280,
          createdAt: 300,
          updatedAt: 350,
          revision: 5,
        },
      ]);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_schedule_occurrence)`,
        )).map((column) => column.name),
      ).not.toContain("accepted_at");
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentSchedules)).toEqual(schedules);
      expect(yield* db.select().from(agentRun).orderBy(agentRun.id)).toEqual(
        runs,
      );
      expect(
        yield* db.all(sql`PRAGMA index_list(agent_schedule_occurrence)`),
      ).toEqual(indexes);
      expect(
        yield* db.all(sql`PRAGMA foreign_key_list(agent_schedule_occurrence)`),
      ).toEqual(
        foreignKeys.map((key) =>
          key.from === "schedule_id" ? { ...key, on_delete: "CASCADE" } : key,
        ),
      );
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
