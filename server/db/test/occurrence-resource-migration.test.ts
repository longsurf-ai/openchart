// Purpose: Proves the Occurrence Resource upgrade preserves populated execution provenance.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { agentRun } from "@openchart/server/agent/schema";
import { agentScheduleOccurrences } from "@openchart/server/resources/agent-schedule-occurrence/schema";
import { agentSchedules } from "@openchart/server/resources/agent-schedule/schema";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("preserves occurrence identities, timestamps, revisions, and both foreign keys", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_occurrence-resource"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.run(sql`
        INSERT INTO agent_sessions (id, user_id, title)
        VALUES ('session', 'user', 'Scheduled analysis')
      `);
      const input = {
        agent: "analyst",
        model: { providerID: "codex" as const, modelID: "tier1" as const },
        parts: [{ type: "text" as const, text: "Analyze this." }],
      };
      yield* db.run(sql`
        INSERT INTO agent_schedule
          (id, user_id, name, target_json, recurrence, next_fire_at,
            revision, created_at, updated_at)
        VALUES ('schedule', 'user', 'Recurring analysis',
          ${JSON.stringify({ kind: "agent_prompt", prompt: input })},
          ${JSON.stringify({ kind: "cron", expression: "0 9 * * *", timeZone: "UTC" })},
          400, 7, 10, 20)
      `);
      yield* db.insert(agentRun).values([
        {
          id: "run-first",
          sessionId: "session",
          sessionIntentId: "first",
          input,
          status: "queued",
          queuePosition: 0,
          createdAt: 200,
        },
        {
          id: "run-second",
          sessionId: "session",
          sessionIntentId: "second",
          input,
          status: "queued",
          queuePosition: 1,
          createdAt: 300,
        },
      ]);
      yield* db.run(sql`
        INSERT INTO agent_schedule_occurrences
          (id, schedule_id, agent_run_id, fire_at, accepted_at, revision)
        VALUES ('occ-first', 'schedule', 'run-first', 100, 200, 0),
          ('occ-second', 'schedule', 'run-second', 250, 300, 5)
      `);
      const schedulesBefore = yield* db.select().from(agentSchedules);
      const runsBefore = yield* db.select().from(agentRun);
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
          createdAt: 200,
          updatedAt: 200,
          revision: 1,
        },
        {
          id: "occ-second",
          scheduleId: "schedule",
          agentRunId: "run-second",
          fireAt: 250,
          createdAt: 300,
          updatedAt: 300,
          revision: 5,
        },
      ]);
      expect(yield* db.select().from(agentSchedules)).toEqual(schedulesBefore);
      expect(yield* db.select().from(agentRun)).toEqual(runsBefore);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name = 'agent_schedule_occurrences'
        `),
      ).toEqual([]);
      expect(
        yield* db.all<{ table: string; from: string; on_delete: string }>(
          sql`PRAGMA foreign_key_list(agent_schedule_occurrence)`,
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "agent_schedule",
            from: "schedule_id",
            on_delete: "CASCADE",
          }),
          expect.objectContaining({
            table: "agent_run",
            from: "agent_run_id",
            on_delete: "RESTRICT",
          }),
        ]),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
