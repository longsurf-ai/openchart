// Purpose: Proves removing Part Run associations preserves transcript and execution rows.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import {
  agentMessages,
  agentParts,
  agentRun,
} from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("removes nullable and populated Part Run associations without losing transcript rows", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-part-run"),
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
      yield* db.insert(agentMessages).values({
        id: "message",
        sessionId: "session",
        role: "user",
        data: {
          time: { created: 50 },
          agent: "analyst",
          model: { providerID: "codex" as const, modelID: "tier1" as const },
        },
      });
      yield* db.insert(agentRun).values({
        id: "run",
        sessionId: "session",
        sessionIntentId: "intent",
        input: {
          agent: "analyst",
          model: { providerID: "codex" as const, modelID: "tier1" as const },
          parts: [{ type: "text", text: "Research" }],
        },
        queuePosition: 0,
        createdAt: 50,
      });
      yield* db.run(sql`
        INSERT INTO agent_parts
          (id, message_id, session_id, run_id, data, origin, created_at, updated_at)
        VALUES ('inherited', 'message', 'session', 'run',
          '{"type":"text","text":"Inherited","time":{"start":50}}',
          'inherited', 100, 200),
          ('original', 'message', 'session', NULL,
          '{"type":"text","text":"Original","metadata":{"key":1}}',
          'original', 300, 400)
      `);
      const parts = yield* db.select().from(agentParts).orderBy(agentParts.id);
      const messages = yield* db.select().from(agentMessages);
      const sessions = yield* db.select().from(agentSessions);
      const runs = yield* db.select().from(agentRun);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(
        yield* db.select().from(agentParts).orderBy(agentParts.id),
      ).toEqual(parts);
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentRun)).toEqual(runs);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_parts)`,
        )).map((column) => column.name),
      ).not.toContain("run_id");
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA index_list(agent_parts)`,
        )).map((index) => index.name),
      ).not.toContain("idx_agent_parts_run");
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
