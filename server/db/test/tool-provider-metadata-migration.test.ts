// Purpose: Proves the ToolPart metadata rename preserves transcript and execution facts.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { ToolState } from "@openchart/server/agent/contracts/part";
import { PartData } from "@openchart/server/agent/session/message/data";
import { agentMessages, agentParts } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const metadata = { pagesRead: 3, nested: { metadata: { keep: true } } };
const states: ToolState[] = [
  { status: "pending", input: {}, metadata },
  { status: "running", input: {}, time: { start: 10 }, metadata },
  {
    status: "completed",
    input: { metadata: { keep: "input" } },
    output: { type: "json", value: { metadata: { keep: "output" } } },
    title: "Research",
    metadata,
    time: { start: 10, end: 20 },
    attachments: [
      {
        id: "attachment",
        messageID: "message",
        type: "file",
        mime: "text/plain",
        url: "file:///tmp/result.txt",
      },
    ],
  },
  {
    status: "error",
    input: ["invalid", null],
    error: "Invalid input",
    metadata,
    time: { start: 10, end: 20 },
  },
];
const providerMetadata = {
  openai: { itemId: "fc_123", nested: [1, true, null] },
};
const fixtures = [
  ...states.map((state) => {
    const part = {
      type: "tool",
      tool: "research",
      callID: state.status,
      childSessionId: "ses_child",
      state,
    };
    return {
      before: {
        ...part,
        state: state.status === "pending" ? { ...state, raw: "" } : state,
        metadata: providerMetadata,
      },
      after: {
        ...part,
        childSessionId: undefined,
        childSessionIds: ["ses_child"],
        providerMetadata,
      },
    };
  }),
  ...[
    { type: "tool", tool: "research", callID: "missing", state: states[0] },
    { type: "text", text: "Keep text metadata", metadata: providerMetadata },
    {
      type: "reasoning",
      text: "Keep reasoning metadata",
      time: { start: 10 },
      metadata: providerMetadata,
    },
  ].map((part) => ({
    before: part,
    after: part.type === "tool" ? { ...part, childSessionIds: [] } : part,
  })),
];

test("renames only outer tool metadata in populated predecessor transcripts", async () => {
  const index = migrations.findIndex((migration) =>
    migration.id.endsWith("_rename-tool-provider-metadata"),
  );
  expect(index).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "ses_parent", title: "Research" });
      yield* db.insert(agentMessages).values({
        id: "message",
        sessionId: "ses_parent",
        role: "user",
        data: {
          time: { created: 10 },
          agent: "analyst",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      });
      for (const [index, fixture] of fixtures.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_parts (id, message_id, data, created_at, updated_at)
          VALUES (${String(index)}, 'message', ${JSON.stringify(fixture.before)}, 100, 200)
        `);
      }
      const sessions = yield* db.select().from(agentSessions);
      const messages = yield* db.select().from(agentMessages);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      const parts = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(parts).toEqual(
        fixtures.map((fixture, index) => ({
          id: String(index),
          messageId: "message",
          data: fixture.after,
          createdAt: 100,
          updatedAt: 200,
        })),
      );
      for (const part of parts) {
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      }
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
