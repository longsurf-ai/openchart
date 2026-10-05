// Purpose: Proves patch Part removal preserves messages and every remaining Part's content and ownership.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { PartData } from "@openchart/server/agent/session/message/data";
import { agentMessages, agentParts } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { getTableColumns, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

test("removes original and inherited patch Parts without changing other transcript data", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_remove-patch-parts"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`
        INSERT INTO agent_sessions (id, user_id, title)
        VALUES ('ses_parent', 'user', 'Research')
      `);
      yield* db.insert(agentMessages).values([
        {
          id: "msg_user",
          sessionId: "ses_parent",
          role: "user",
          data: {
            time: { created: 100 },
            agent: "analyst",
            model: { providerID: "openai", modelID: "gpt-5" },
          },
        },
        {
          id: "msg_assistant",
          sessionId: "ses_parent",
          role: "assistant",
          data: {
            time: { created: 101, completed: 102 },
            triggeringUserMessageID: "msg_user",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "analyst",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: {
              input: 1,
              output: 2,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      ]);
      const fixtures = [
        { type: "patch", hash: "before", files: ["report.md"] },
        {
          type: "text",
          text: "Keep the analysis.",
          metadata: { type: "patch", files: ["nested.md"] },
        },
      ];
      for (const origin of ["original", "inherited"]) {
        for (const data of fixtures) {
          yield* db.run(sql`
            INSERT INTO agent_parts
              (id, message_id, session_id, data, origin, created_at, updated_at)
            VALUES (${`prt_${origin}_${data.type}`}, 'msg_assistant',
              'ses_parent', ${JSON.stringify(data)}, ${origin}, 200, 300)
          `);
        }
      }
      const messages = yield* db.select().from(agentMessages);
      const sessions = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      const before = yield* db.select().from(agentParts).orderBy(agentParts.id);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const after = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(after).toEqual(before.filter((part) => part.data.type === "text"));
      expect(after).toHaveLength(2);
      for (const part of after) {
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      }
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.select().from(agentSessions)).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
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
