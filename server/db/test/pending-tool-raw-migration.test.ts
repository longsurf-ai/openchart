// Purpose: Proves removing pending tool raw input preserves all other transcript data.

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

test("removes only pending state.raw from populated predecessor transcripts", async () => {
  const index = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-pending-tool-raw"),
  );
  expect(index).toBeGreaterThan(0);
  const input = { raw: "Keep executable input", nested: { raw: ["keep", 1] } };
  const metadata = { raw: "Keep tool metadata" };
  const states: ToolState[] = [
    { status: "pending", input, metadata },
    { status: "running", input, metadata, time: { start: 10 } },
    {
      status: "completed",
      input,
      output: { type: "json", value: { raw: "Keep model output" } },
      title: "Done",
      metadata,
      time: { start: 10, end: 20 },
    },
    {
      status: "error",
      input,
      error: "Interrupted",
      metadata,
      time: { start: 10, end: 20 },
    },
  ];
  const parts = states.map((state) => ({
    type: "tool",
    tool: "research",
    callID: state.status,
    childSessionId: "ses_child",
    providerMetadata: { provider: { raw: "Keep provider metadata" } },
    state,
  }));
  const pending = parts[0]!;
  const fixtures = [
    ...["", '{"partial":'].map((raw) => ({
      before: { ...pending, state: { ...pending.state, raw } },
      after: pending,
    })),
    ...[
      ...parts,
      { type: "text", text: "Keep text", metadata },
      {
        type: "reasoning",
        text: "Keep reasoning",
        metadata,
        time: { start: 10, end: 20 },
      },
    ].map((part) => ({ before: part, after: part })),
  ];

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "ses_parent", title: "Keep" });
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
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      const saved = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(saved).toEqual(
        fixtures.map((fixture, index) => ({
          id: String(index),
          messageId: "message",
          data:
            fixture.after.type === "tool"
              ? {
                  ...fixture.after,
                  childSessionId: undefined,
                  childSessionIds: ["ses_child"],
                }
              : fixture.after,
          createdAt: 100,
          updatedAt: 200,
        })),
      );
      for (const part of saved) {
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      }
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      const migratedLedger = yield* db.all<{ id: string }>(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(migratedLedger.slice(0, index)).toEqual(ledger);
      expect(migratedLedger.map((row) => row.id)).toEqual(
        migrations.map(({ id }) => id),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
