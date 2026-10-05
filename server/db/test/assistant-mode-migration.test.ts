// Purpose: Proves assistant metadata migrations preserve message relationships and transcript content.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { MessageInfo } from "@openchart/server/agent/contracts/message";
import { InfoData } from "@openchart/server/agent/session/message/data";
import { agentMessages } from "@openchart/server/agent/schema";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

test.each(["_remove-assistant-mode", "_rename-assistant-trigger"])(
  "upgrades assistant metadata from before %s without changing other content",
  async (suffix) => {
    const assistant = {
      time: { created: 101, completed: 102 },
      triggeringUserMessageID: "msg_user",
      modelID: "gpt-5",
      providerID: "openai",
      agent: "analyst",
      path: { cwd: "/tmp/session", root: "/tmp" },
      summary: true,
      cost: 0.2,
      tokens: {
        input: 100,
        output: 25,
        reasoning: 10,
        cache: { read: 50, write: 5 },
      },
      finish: "stop",
      request: {
        system: ["Analyze the market."],
        tools: [
          {
            id: "tool",
            description: "Keep nested mode fields.",
            inputSchema: {
              type: "object",
              properties: { mode: { type: "string" } },
            },
          },
        ],
      },
    } satisfies InfoData;
    const { triggeringUserMessageID, ...content } = assistant;
    const historical = { ...content, parentID: triggeringUserMessageID };
    await Effect.runPromise(
      Effect.gen(function* () {
        const index = migrations.findIndex((migration) =>
          migration.id.endsWith(suffix),
        );
        expect(index).toBeGreaterThan(0);
        const db = yield* makeWithDefaults();
        yield* db.run("PRAGMA foreign_keys = ON");
        yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
        yield* db.run(sql`
          INSERT INTO agent_sessions (id, user_id, title)
          VALUES ('ses_parent', 'user', 'Research')
        `);
        yield* db.insert(agentMessages).values({
          id: "msg_user",
          sessionId: "ses_parent",
          role: "user",
          data: {
            time: { created: 100 },
            agent: "analyst",
            model: { providerID: "openai", modelID: "gpt-5" },
          },
        });
        const fixtures =
          suffix === "_remove-assistant-mode"
            ? [
                { ...historical, mode: "analyst" },
                { ...historical, mode: "obsolete-agent" },
                historical,
              ]
            : [historical, assistant];
        for (const [position, data] of fixtures.entries()) {
          yield* db.run(sql`
          INSERT INTO agent_messages
            (id, session_id, role, data, origin, created_at, updated_at)
          VALUES (${`msg_assistant_${position}`}, 'ses_parent', 'assistant',
            ${JSON.stringify(data)}, 'inherited', 200, 300)
        `);
        }
        const before = yield* db
          .select()
          .from(agentMessages)
          .orderBy(agentMessages.id);
        yield* DatabaseMigration.apply(db);
        yield* DatabaseMigration.apply(db);
        const after = yield* db
          .select()
          .from(agentMessages)
          .orderBy(agentMessages.id);
        expect(after).toEqual(
          before.map((row) =>
            row.role === "assistant" ? { ...row, data: assistant } : row,
          ),
        );
        for (const row of after) {
          expect(Schema.decodeUnknownSync(InfoData)(row.data)).toEqual(
            row.data,
          );
          const complete = {
            ...row.data,
            id: row.id,
            sessionID: row.sessionId,
            role: row.role,
          };
          expect(Schema.decodeUnknownSync(MessageInfo)(complete)).toEqual(
            complete,
          );
        }
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        expect(
          yield* db.all(
            sql`SELECT id FROM app_schema_migrations ORDER BY version`,
          ),
        ).toEqual(migrations.map(({ id }) => ({ id })));
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
    );
  },
);
