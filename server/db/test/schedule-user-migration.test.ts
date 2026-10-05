// Purpose: Proves removing Schedule user identity preserves definitions and accepted-run provenance.

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

test("removes Schedule user identity while preserving definitions, history, and constraints", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-schedule-user"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "ses_research", title: "Research" });
      const input = {
        agent: "analyst",
        model: { providerID: "codex" as const, modelID: "tier1" as const },
        parts: [{ type: "text" as const, text: "Research the watchlist." }],
      };
      const target = { kind: "agent_prompt" as const, prompt: input };
      const recurrence = {
        kind: "once" as const,
        fireAt: "2026-09-11T00:00:00.000Z",
      };
      for (const index of [0, 1]) {
        yield* db.run(sql`
          INSERT INTO agent_schedule
            (id, user_id, name, enabled, target_json, recurrence, next_fire_at,
              deleted_at, revision, created_at, updated_at)
          VALUES (${`ags_${index}`}, ${`legacy-user-${index}`}, 'Research',
            ${index === 0 ? 1 : 0}, ${JSON.stringify(target)},
            ${JSON.stringify(recurrence)}, 400, ${index === 0 ? null : 300},
            7, 100, 300)
        `);
        yield* db.insert(agentRun).values({
          id: `agr_${index}`,
          sessionId: "ses_research",
          sessionIntentId: `scheduled-${index}`,
          input,
          queuePosition: index,
          createdAt: 200,
        });
        yield* db.insert(agentScheduleOccurrences).values({
          id: `aso_${index}`,
          scheduleId: `ags_${index}`,
          agentRunId: `agr_${index}`,
          fireAt: 150,
          revision: 3,
          createdAt: 200,
          updatedAt: 250,
        });
      }
      const schedules = yield* db
        .select()
        .from(agentSchedules)
        .orderBy(agentSchedules.id);
      const occurrences = yield* db
        .select()
        .from(agentScheduleOccurrences)
        .orderBy(agentScheduleOccurrences.id);
      const runs = yield* db.select().from(agentRun).orderBy(agentRun.id);
      const sessions = yield* db.select().from(agentSessions);
      const occurrenceIndexes = yield* db.all(
        sql`PRAGMA index_list(agent_schedule_occurrence)`,
      );
      const foreignKeys = yield* db.all(
        sql`PRAGMA foreign_key_list(agent_schedule_occurrence)`,
      );

      const history = migrations.slice(0, upgradeIndex + 1);
      yield* DatabaseMigration.applyOnly(db, history);
      yield* DatabaseMigration.applyOnly(db, history);

      expect(
        yield* db.select().from(agentSchedules).orderBy(agentSchedules.id),
      ).toEqual(schedules);
      expect(
        yield* db
          .select()
          .from(agentScheduleOccurrences)
          .orderBy(agentScheduleOccurrences.id),
      ).toEqual(occurrences);
      expect(yield* db.select().from(agentRun).orderBy(agentRun.id)).toEqual(
        runs,
      );
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(
        yield* db.all(sql`PRAGMA index_list(agent_schedule_occurrence)`),
      ).toEqual(occurrenceIndexes);
      expect(
        yield* db.all(sql`PRAGMA foreign_key_list(agent_schedule_occurrence)`),
      ).toEqual(foreignKeys);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_schedule)`,
        )).map((column) => column.name),
      ).not.toContain("user_id");
      expect(
        yield* db.all(
          sql`SELECT name FROM sqlite_schema WHERE name = 'idx_agent_schedules_user_updated'`,
        ),
      ).toEqual([]);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA index_info(idx_agent_schedules_updated)`,
        )).map((column) => column.name),
      ).toEqual(["updated_at"]);
      yield* db.insert(agentSchedules).values({
        id: "ags_new",
        name: "New schedule",
        target,
        recurrence,
        nextFireAt: 500,
      });
      for (const statement of [
        sql`DELETE FROM agent_schedule WHERE id = 'ags_0'`,
        sql`DELETE FROM agent_run WHERE id = 'agr_0'`,
        sql`UPDATE agent_schedule_occurrence SET schedule_id = 'missing' WHERE id = 'aso_0'`,
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
