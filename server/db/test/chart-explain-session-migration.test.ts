// Purpose: Preserve Session history while classifying chart explanations outside Chats.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

test("classifies existing drawing chats while preserving bindings, transcripts, Runs and Occurrences", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex(({ id }) =>
        id.endsWith("_chart-explain-session-kind"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`INSERT INTO agent_session_bindings (id, key)
        VALUES ('drawing', 'drawing:drw_selection'), ('research', 'research:slot')`);
      for (const [id, kind, binding] of [
        ["ses_chart", "chat", "drawing"],
        ["ses_history", "chat", "drawing"],
        ["ses_delegate", "delegate", "drawing"],
        ["ses_research", "chat", "research"],
        ["ses_chat", "chat", null],
      ]) {
        yield* db.run(sql`INSERT INTO agent_sessions
          (id, title, kind, binding_id, created_at, updated_at)
          VALUES (${id}, ${id}, ${kind}, ${binding}, 10, 20)`);
      }
      yield* db.run(sql`INSERT INTO agent_messages (id, session_id, role, data)
        VALUES ('message', 'ses_chart', 'assistant', '{"time":{"created":10}}')`);
      yield* db.run(sql`INSERT INTO agent_parts (id, message_id, data)
        VALUES ('part', 'message', '{"type":"text","text":"Explanation"}')`);
      yield* db.run(sql`INSERT INTO agent_todos (id, session_id, content, status, priority, position)
        VALUES ('todo', 'ses_chart', 'Research', 'pending', 'high', 0)`);
      const prompt = {
        agent: "analyst",
        model: { providerID: "codex", modelID: "tier1" },
        parts: [{ type: "text", text: "Explain the selection" }],
      };
      yield* db.run(sql`INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('run', 'ses_chart', 'intent', ${JSON.stringify(prompt)}, 'queued', 0, 10)`);
      yield* db.run(sql`INSERT INTO agent_schedule (id, name, target_json, recurrence, next_fire_at)
        VALUES ('schedule', 'Research', ${JSON.stringify({ kind: "agent_prompt", prompt })},
          '{"kind":"once","fireAt":"2026-09-21T00:00:00.000Z"}', 10)`);
      yield* db.run(sql`INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at)
        VALUES ('occurrence', 'schedule', 'run', 10)`);
      const sessions = yield* db.all<{ id: string; kind: string }>(
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
      const history = migrations.slice(0, index + 1);
      yield* DatabaseMigration.applyOnly(db, history);
      yield* DatabaseMigration.applyOnly(db, history);
      expect(
        yield* db.all(sql`SELECT * FROM agent_sessions ORDER BY id`),
      ).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: ["ses_chart", "ses_history"].includes(session.id)
            ? "chart_explain"
            : session.kind,
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
      yield* db.run(sql`INSERT INTO agent_sessions (id, title, kind)
        VALUES ('ses_new', 'New explanation', 'chart_explain')`);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            db.run(
              sql`UPDATE agent_sessions SET kind = 'invalid' WHERE id = 'ses_new'`,
            ),
          ),
        ),
      ).toBe(true);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
