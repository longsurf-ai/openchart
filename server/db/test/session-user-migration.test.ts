// Purpose: Proves removing Session user identity preserves sessions and related data.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Session } from "@openchart/server/agent/contracts/session";
import {
  agentMessages,
  agentParts,
  agentSessionBindings,
  agentTodos,
} from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { getTableColumns, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema, Struct } from "effect";
import { expect, test } from "vitest";

test("removes legacy user identity while preserving session facts and dependents", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-session-user"),
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
      const anchors = [
        {
          partId: "part",
          text: "Selected text",
          startOffset: 0,
          endOffset: 13,
          childSessionId: "ses_child",
          sessionIntentId: "branch",
        },
      ];
      yield* db.run(sql`
        INSERT INTO agent_sessions
          (id, user_id, parent_id, kind, binding_id, binding_generation,
            binding_superseded_at, binding_rotation_intent_id, anchors, title,
            permission, compacting_at, archived_at, created_at, updated_at)
        VALUES ('ses_parent', 'legacy-user', NULL, NULL, 'binding', 1,
          200, 'rotate', ${JSON.stringify(anchors)}, 'Research',
          '{"rules":[]}', 150, 250, 100, 300),
          ('ses_child', 'legacy-user', 'ses_parent', 'dig_in', 'binding', 2,
          NULL, NULL, NULL, 'Dig in', NULL, NULL, NULL, 200, 400)
      `);
      yield* db.insert(agentMessages).values({
        id: "message",
        sessionId: "ses_parent",
        role: "user",
        data: {
          time: { created: 100 },
          agent: "analyst",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      });
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, session_id, data)
        VALUES ('part', 'message', 'ses_parent', '{"type":"text","text":"Selected text"}')
      `);
      yield* db.insert(agentTodos).values({
        id: "todo",
        sessionId: "ses_parent",
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
        .from(agentSessions)
        .orderBy(agentSessions.id);
      const bindings = yield* db.select().from(agentSessionBindings);
      const messages = yield* db.select().from(agentMessages);
      const parts = yield* db.select().from(agentParts);
      const todos = yield* db.select().from(agentTodos);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      const migrated = yield* db
        .select()
        .from(agentSessions)
        .orderBy(agentSessions.id);
      expect(migrated).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
          anchors:
            session.anchors?.map((anchor) =>
              Struct.pick(anchor, [
                "partId",
                "text",
                "startOffset",
                "endOffset",
                "childSessionId",
              ]),
            ) ?? null,
        })),
      );
      for (const session of migrated) {
        expect(
          Schema.decodeUnknownSync(
            Session.mapFields(Struct.omit(["lastReadRunId"])),
          )(session),
        ).toEqual(session);
      }
      expect(yield* db.select().from(agentSessionBindings)).toEqual(bindings);
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.select().from(agentParts)).toEqual(parts);
      expect(yield* db.select().from(agentTodos)).toEqual(todos);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_sessions)`,
        )).map((column) => column.name),
      ).not.toContain("user_id");
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema
          WHERE name = 'idx_agent_sessions_user_updated'
        `),
      ).toEqual([]);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA index_info(idx_agent_sessions_updated)`,
        )).map((column) => column.name),
      ).toEqual(["updated_at"]);
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "ses_new", title: "New session" });
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
