// Purpose: Proves the stop lifecycle upgrade preserves Run history and incoming Occurrence references.

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

test("preserves existing Runs and Occurrences while allowing stop only as a terminal state", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const upgradeIndex = migrations.findIndex((migration) =>
        migration.id.endsWith("_agent-run-stop"),
      );
      expect(upgradeIndex).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      const input = {
        agent: "analyst",
        model: { providerID: "codex" as const, modelID: "tier1" as const },
        parts: [{ type: "text" as const, text: "Analyze this." }],
      };
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "session", title: "Research" });
      yield* db.insert(agentSchedules).values({
        id: "schedule",
        name: "Research",
        target: { kind: "agent_prompt", prompt: input },
        recurrence: { kind: "once", fireAt: "2026-09-16T00:00:00.000Z" },
        nextFireAt: 100,
      });
      for (const [index, status] of (
        ["queued", "running", "completed", "failed"] as const
      ).entries()) {
        yield* db.insert(agentRun).values({
          id: `run-${status}`,
          sessionId: "session",
          sessionIntentId: `intent-${status}`,
          input,
          status,
          queuePosition: status === "queued" ? 0 : null,
          createdAt: 100,
          startedAt: status === "queued" ? null : 200,
          finishedAt:
            status === "completed" || status === "failed" ? 300 : null,
        });
        yield* db.insert(agentScheduleOccurrences).values({
          id: `occurrence-${status}`,
          scheduleId: "schedule",
          agentRunId: `run-${status}`,
          fireAt: 100 + index,
          createdAt: 120,
          updatedAt: 130,
          revision: 4,
        });
      }
      const stop = sql`UPDATE agent_run SET status = 'stop', finished_at = 400 WHERE id = 'run-running'`;
      expect(Exit.isFailure(yield* Effect.exit(db.run(stop)))).toBe(true);
      const runs = yield* db.select().from(agentRun).orderBy(agentRun.id);
      const occurrences = yield* db
        .select()
        .from(agentScheduleOccurrences)
        .orderBy(agentScheduleOccurrences.id);
      const indexes = yield* db.all(sql`PRAGMA index_list(agent_run)`);
      const history = migrations.slice(0, upgradeIndex + 1);
      yield* DatabaseMigration.applyOnly(db, history);
      yield* DatabaseMigration.applyOnly(db, history);
      expect(yield* db.select().from(agentRun).orderBy(agentRun.id)).toEqual(
        runs,
      );
      expect(
        yield* db
          .select()
          .from(agentScheduleOccurrences)
          .orderBy(agentScheduleOccurrences.id),
      ).toEqual(occurrences);
      expect(yield* db.all(sql`PRAGMA index_list(agent_run)`)).toEqual(indexes);
      for (const invalid of [
        sql`UPDATE agent_run SET status = 'stop' WHERE id = 'run-running'`,
        sql`UPDATE agent_run SET status = 'stop', queue_position = NULL, finished_at = 400 WHERE id = 'run-queued'`,
        sql`DELETE FROM agent_run WHERE id = 'run-completed'`,
      ]) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(invalid)))).toBe(true);
      }
      yield* db.run(stop);
      expect(
        yield* db.all(
          sql`SELECT status, started_at, finished_at FROM agent_run WHERE id = 'run-running'`,
        ),
      ).toEqual([{ status: "stop", started_at: 200, finished_at: 400 }]);
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
