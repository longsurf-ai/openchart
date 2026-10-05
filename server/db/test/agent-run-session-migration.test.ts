// Purpose: Proves the Run Session FK preserves execution history and rejects orphan upgrades atomically.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { agentRun } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { agentScheduleOccurrences } from "@openchart/server/resources/agent-schedule-occurrence/schema";
import { agentSchedules } from "@openchart/server/resources/agent-schedule/schema";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

const upgradeIndex = migrations.findIndex((migration) =>
  migration.id.endsWith("_agent-run-session-fk"),
);

const predecessor = Effect.gen(function* () {
  expect(upgradeIndex).toBeGreaterThan(0);
  const db = yield* makeWithDefaults();
  yield* db.run("PRAGMA foreign_keys = ON");
  yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
  yield* db.insert(agentSessions).values({
    kind: "chat",
    id: "session",
    title: "Research",
    createdAt: 10,
    updatedAt: 20,
  });
  const input = {
    agent: "analyst",
    model: { providerID: "codex" as const, modelID: "tier1" as const },
    parts: [{ type: "text" as const, text: "Analyze this." }],
  };
  for (const status of ["queued", "running", "completed", "failed"] as const) {
    yield* db.insert(agentRun).values({
      id: `run-${status}`,
      sessionId: "session",
      sessionIntentId: `intent-${status}`,
      input,
      status,
      queuePosition: status === "queued" ? 0 : null,
      createdAt: 100,
      startedAt: status === "queued" ? null : 200,
      finishedAt: status === "completed" || status === "failed" ? 300 : null,
    });
  }
  yield* db.run(sql`
    INSERT INTO agent_schedule
      (id, user_id, name, target_json, recurrence, next_fire_at)
    VALUES ('schedule', 'user', 'Research',
      ${JSON.stringify({ kind: "agent_prompt", prompt: input })},
      ${JSON.stringify({ kind: "once", fireAt: "2026-09-08T00:00:00.000Z" })},
      100)
  `);
  yield* db.run(sql`
    INSERT INTO agent_schedule_occurrence
      (id, schedule_id, agent_run_id, fire_at, accepted_at, created_at, updated_at, revision)
    VALUES ('occurrence', 'schedule', 'run-completed', 100, 110, 120, 130, 4)
  `);
  return db;
});

test("preserves every Run lifecycle and Occurrence while enforcing the Session FK", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor;
      const runs = yield* db.select().from(agentRun).orderBy(agentRun.id);
      const sessions = yield* db.select().from(agentSessions);
      const schedules = yield* db.select().from(agentSchedules);
      const occurrences = yield* db.select().from(agentScheduleOccurrences);
      const indexes = yield* db.all(sql`PRAGMA index_list(agent_run)`);

      const history = migrations.slice(0, upgradeIndex + 1);
      yield* DatabaseMigration.applyOnly(db, history);
      yield* DatabaseMigration.applyOnly(db, history);

      expect(yield* db.select().from(agentRun).orderBy(agentRun.id)).toEqual(
        runs,
      );
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentSchedules)).toEqual(schedules);
      expect(yield* db.select().from(agentScheduleOccurrences)).toEqual(
        occurrences,
      );
      expect(yield* db.all(sql`PRAGMA index_list(agent_run)`)).toEqual(indexes);
      expect(yield* db.all(sql`PRAGMA foreign_key_list(agent_run)`)).toEqual([
        expect.objectContaining({
          table: "agent_sessions",
          from: "session_id",
          to: "id",
          on_delete: "RESTRICT",
        }),
      ]);
      for (const statement of [
        sql`UPDATE agent_run SET session_id = 'missing' WHERE id = 'run-queued'`,
        sql`DELETE FROM agent_sessions WHERE id = 'session'`,
        sql`DELETE FROM agent_run WHERE id = 'run-completed'`,
      ]) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      }
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(history.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test.each(["orphan", "restore"] as const)(
  "preserves tables, rows, and ledger when the FK upgrade fails during %s",
  async (failure) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* predecessor;
        if (failure === "orphan") {
          yield* db.run(sql`
            UPDATE agent_run SET session_id = 'missing' WHERE id = 'run-queued'
          `);
        }
        if (failure === "restore") {
          yield* db.run(sql`
            CREATE TRIGGER reject_occurrence_restore
            BEFORE INSERT ON agent_schedule_occurrence
            BEGIN SELECT RAISE(ABORT, 'test occurrence restore failure'); END
          `);
        }
        const runs = yield* db.select().from(agentRun).orderBy(agentRun.id);
        const sessions = yield* db.select().from(agentSessions);
        const occurrences = yield* db.select().from(agentScheduleOccurrences);
        const ledger = yield* db.all(sql`SELECT * FROM app_schema_migrations`);
        const schema = yield* db.all(
          sql`SELECT * FROM sqlite_schema ORDER BY name`,
        );

        const result = yield* Effect.exit(DatabaseMigration.apply(db));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* db.select().from(agentRun).orderBy(agentRun.id)).toEqual(
          runs,
        );
        expect(yield* db.select().from(agentSessions)).toEqual(sessions);
        expect(yield* db.select().from(agentScheduleOccurrences)).toEqual(
          occurrences,
        );
        expect(yield* db.all(sql`SELECT * FROM app_schema_migrations`)).toEqual(
          ledger,
        );
        expect(
          yield* db.all(sql`SELECT * FROM sqlite_schema ORDER BY name`),
        ).toEqual(schema);
        expect(
          yield* db.all(sql`
          SELECT name FROM sqlite_temp_schema WHERE name = '__agent_run_occurrences'
        `),
        ).toEqual([]);
        expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
          { foreign_keys: 1 },
        ]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
    );
  },
);
