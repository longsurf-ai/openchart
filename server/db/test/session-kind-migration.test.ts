// Purpose: Proves explicit chat kinds preserve populated Session history and reject missing kinds.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

test("backfills null kinds and preserves Sessions, bindings, transcript, Runs and Occurrences", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex(({ id }) =>
        id.endsWith("_session-kind-chat"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        sql`INSERT INTO agent_session_bindings (id, key) VALUES ('binding', 'research')`,
      );
      const anchor = [
        {
          partId: "part",
          text: "Selected",
          startOffset: 0,
          endOffset: 8,
          childSessionId: "ses_dig_in",
          sessionIntentId: "dig-intent",
        },
      ];
      yield* db.run(sql`INSERT INTO agent_sessions
        (id, title, kind, binding_id, anchors, created_at, updated_at)
        VALUES ('ses_chat', 'Research', NULL, 'binding', ${JSON.stringify(anchor)}, 10, 20)`);
      for (const kind of ["delegate", "dig_in", "alert", "scheduled"]) {
        yield* db.run(sql`INSERT INTO agent_sessions (id, title, parent_id, kind, created_at, updated_at)
          VALUES (${`ses_${kind}`}, ${kind}, 'ses_chat', ${kind}, 30, 40)`);
      }
      yield* db.run(sql`INSERT INTO agent_messages (id, session_id, role, data, created_at, updated_at)
        VALUES ('message', 'ses_chat', 'assistant', '{"time":{"created":10}}', 10, 20)`);
      yield* db.run(sql`INSERT INTO agent_parts (id, message_id, data, created_at, updated_at)
        VALUES ('part', 'message', '{"type":"text","text":"Selected"}', 10, 20)`);
      yield* db.run(sql`INSERT INTO agent_todos (id, session_id, content, status, priority, position)
        VALUES ('todo', 'ses_chat', 'Research', 'pending', 'high', 0)`);
      const prompt = {
        agent: "analyst",
        model: { providerID: "openai", modelID: "gpt-5" },
        parts: [{ type: "text", text: "Research" }],
      };
      yield* db.run(sql`INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('run', 'ses_chat', 'run-intent', ${JSON.stringify(prompt)}, 'queued', 0, 10)`);
      yield* db.run(sql`INSERT INTO agent_schedule (id, name, target_json, recurrence, next_fire_at)
        VALUES ('schedule', 'Research', ${JSON.stringify({ kind: "agent_prompt", prompt })},
          '{"kind":"once","fireAt":"2026-09-17T00:00:00.000Z"}', 10)`);
      yield* db.run(sql`INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at)
        VALUES ('occurrence', 'schedule', 'run', 10)`);
      const sessions = yield* db.all<{ kind: string | null }>(
        sql`SELECT * FROM agent_sessions ORDER BY id`,
      );
      const tables = [
        "agent_session_bindings",
        "agent_messages",
        "agent_parts",
        "agent_todos",
        "agent_run",
        "agent_schedule",
        "agent_schedule_occurrence",
      ];
      const before = yield* Effect.forEach(tables, (table) =>
        db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
      );
      const indexes = yield* db.all(sql`PRAGMA index_list(agent_sessions)`);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(
        yield* db.all(sql`SELECT * FROM agent_sessions ORDER BY id`),
      ).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      expect(
        yield* Effect.forEach(tables, (table) =>
          db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
        ),
      ).toEqual(before);
      expect(yield* db.all(sql`PRAGMA index_list(agent_sessions)`)).toEqual(
        indexes,
      );
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
      for (const kind of [null, "", "unknown"]) {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              db.run(
                sql`UPDATE agent_sessions SET kind = ${kind} WHERE id = 'ses_chat'`,
              ),
            ),
          ),
        ).toBe(true);
      }
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            db.run(
              sql`INSERT INTO agent_sessions (id, title) VALUES ('missing', 'Missing kind')`,
            ),
          ),
        ),
      ).toBe(true);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("fresh schemas require an explicit valid Session kind", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.apply(db);
      yield* db.run(
        sql`INSERT INTO agent_sessions (id, title, kind) VALUES ('chat', 'Chat', 'chat')`,
      );
      for (const kind of [null, "", "unknown"]) {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              db.run(
                sql`INSERT INTO agent_sessions (id, title, kind) VALUES ('invalid', 'Invalid', ${kind})`,
              ),
            ),
          ),
        ).toBe(true);
      }
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            db.run(
              sql`INSERT INTO agent_sessions (id, title) VALUES ('missing', 'Missing kind')`,
            ),
          ),
        ),
      ).toBe(true);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
