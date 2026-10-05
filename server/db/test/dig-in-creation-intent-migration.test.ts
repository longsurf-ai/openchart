// Purpose: Proves retiring Dig In creation intents preserves anchors and prompt Runs.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { SessionAnchor } from "@openchart/server/agent/contracts/session-anchor";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

test("removes only creation intents from predecessor anchors and preserves Run intents", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex(({ id }) =>
        id.endsWith("_remove-dig-in-creation-intent"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      const anchors = ["ses_first", "ses_second"].map(
        (childSessionId) =>
          ({
            partId: "prt_source",
            text: " Selected 🌊 text ",
            startOffset: 3,
            endOffset: 21,
            childSessionId,
          }) satisfies SessionAnchor,
      );
      const historical = anchors.map((anchor, position) => ({
        ...anchor,
        sessionIntentId: `creation-${position}`,
      }));
      yield* db.run(sql`INSERT INTO agent_sessions
        (id, title, kind, anchors, created_at, updated_at)
        VALUES ('ses_parent', 'Research', 'chat', ${JSON.stringify(historical)}, 10, 20),
          ('ses_empty', 'Empty', 'chat', '[]', 30, 40)`);
      for (const { childSessionId } of anchors) {
        yield* db.run(sql`INSERT INTO agent_sessions
          (id, parent_id, title, kind, created_at, updated_at)
          VALUES (${childSessionId}, 'ses_parent', 'Dig in', 'dig_in', 50, 60)`);
      }
      yield* db.run(sql`INSERT INTO agent_messages
        (id, session_id, role, data, created_at, updated_at)
        VALUES ('msg_source', 'ses_parent', 'assistant', '{"time":{"created":10}}', 10, 20)`);
      yield* db.run(sql`INSERT INTO agent_parts
        (id, message_id, data, created_at, updated_at)
        VALUES ('prt_source', 'msg_source', '{"type":"text","text":" Selected 🌊 text "}', 10, 20)`);
      const prompt = {
        agent: "analyst",
        model: { providerID: "openai", modelID: "gpt-5" },
        parts: [{ type: "text", text: "Explain" }],
      };
      yield* db.run(sql`INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('run', 'ses_first', 'prompt-intent', ${JSON.stringify(prompt)}, 'queued', 0, 70)`);
      const sessions = yield* db.all<{ id: string; anchors: string | null }>(
        sql`SELECT * FROM agent_sessions ORDER BY id`,
      );
      const tables = ["agent_messages", "agent_parts", "agent_run"];
      const before = yield* Effect.forEach(tables, (table) =>
        db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
      );

      const history = migrations.slice(0, index + 1);
      yield* DatabaseMigration.applyOnly(db, history);
      yield* DatabaseMigration.applyOnly(db, history);

      const migrated = yield* db.all<{ id: string; anchors: string | null }>(
        sql`SELECT * FROM agent_sessions ORDER BY id`,
      );
      expect(migrated).toEqual(
        sessions.map((session) => ({
          ...session,
          anchors:
            session.id === "ses_parent"
              ? JSON.stringify(anchors)
              : session.anchors,
        })),
      );
      const parseAnchors = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Array(SessionAnchor)),
      );
      expect(
        parseAnchors(migrated.find(({ id }) => id === "ses_parent")!.anchors),
      ).toEqual(anchors);
      expect(
        yield* Effect.forEach(tables, (table) =>
          db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
        ),
      ).toEqual(before);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(history.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
