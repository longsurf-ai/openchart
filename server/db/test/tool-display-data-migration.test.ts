// Purpose: Proves tool display removal preserves child relationships and all remaining transcript data.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Part from "@openchart/server/agent/contracts/part";
import { PartData } from "@openchart/server/agent/session/message/data";
import { agentMessages, agentParts } from "@openchart/server/agent/schema";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

function predecessor() {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_remove-tool-display-data"),
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
      id: "msg_parent",
      sessionId: "ses_parent",
      role: "user",
      data: {
        time: { created: 1 },
        agent: "analyst",
        model: { providerID: "openai", modelID: "gpt-5" },
      },
    });
    return db;
  });
}

test("lifts child sessions in every tool state and removes only tool display payloads", async () => {
  const states: Part.ToolState[] = [
    { status: "pending", input: {} },
    {
      status: "running",
      input: { prompt: "Research" },
      title: "Researching",
      metadata: { sessionId: "ses_child", model: "gpt-5" },
      time: { start: 1 },
    },
    {
      status: "completed",
      input: { prompt: "Research" },
      title: "Researched",
      output: { type: "json", value: { result: ["answer", null, 1] } },
      metadata: { truncated: false },
      time: { start: 1, end: 2, compacted: 3 },
      attachments: [],
    },
    {
      status: "error",
      input: { prompt: "Research" },
      error: "Interrupted",
      metadata: { reason: "cancelled" },
      time: { start: 1, end: 2 },
    },
  ];
  const fixtures: { before: Record<string, unknown>; after: PartData }[] =
    states.map((state) => {
      const part = {
        type: "tool" as const,
        tool: "Agent",
        callID: `call_${state.status}`,
        state,
      };
      return {
        before: {
          ...part,
          state: state.status === "pending" ? { ...state, raw: "{" } : state,
          metadata: { provider: { itemId: "opaque" } },
          displayData: {
            overview: { request: "Researching" },
            details: {
              tool: "task",
              description: "Research",
              prompt: "Research",
              subagentType: "analyst",
              sessionId: "ses_child",
            },
          },
        },
        after: {
          ...part,
          providerMetadata: { provider: { itemId: "opaque" } },
          childSessionIds: ["ses_child"],
        },
      };
    });
  const pending = {
    type: "tool" as const,
    tool: "task",
    callID: "call_unlinked",
    state: { status: "pending" as const, input: {} },
  };
  fixtures.push({
    before: {
      ...pending,
      state: { ...pending.state, raw: "" },
      displayData: {
        overview: { request: "Researching" },
        details: {
          tool: "task",
          description: "Research",
          prompt: "Research",
          subagentType: "analyst",
        },
      },
    },
    after: { ...pending, childSessionIds: [] },
  });
  const search = { ...pending, tool: "websearch", callID: "call_search" };
  fixtures.push({
    before: {
      ...search,
      state: { ...search.state, raw: "" },
      displayData: {
        overview: { request: "Searching" },
        details: { tool: "websearch", query: "Apple", results: [] },
      },
    },
    after: { ...search, childSessionIds: [] },
  });
  fixtures.push({
    before: { ...pending, state: { ...pending.state, raw: "" } },
    after: { ...pending, childSessionIds: [] },
  });
  const text = {
    type: "text" as const,
    text: "Keep this",
    metadata: { key: 1 },
  };
  fixtures.push({ before: text, after: text });

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      for (const [index, fixture] of fixtures.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_parts
            (id, message_id, session_id, run_id, data, origin, created_at, updated_at)
          VALUES (${`prt_${index}`}, 'msg_parent', 'ses_parent', 'agr_original',
            ${JSON.stringify(fixture.before)}, 'inherited', 100, 200)
        `);
      }
      const before = yield* db.select().from(agentParts).orderBy(agentParts.id);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const after = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(after).toEqual(
        before.map((row, index) => ({ ...row, data: fixtures[index]!.after })),
      );
      for (const row of after) {
        expect(Schema.decodeUnknownSync(PartData)(row.data)).toEqual(row.data);
        const complete = {
          ...row.data,
          id: row.id,
          messageID: row.messageId,
        };
        expect(Schema.decodeUnknownSync(Part.Part)(complete)).toEqual(complete);
      }
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("rejects an invalid child session ID without changing rows or advancing the ledger", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, session_id, data)
        VALUES ('prt_invalid', 'msg_parent', 'ses_parent', ${JSON.stringify({
          type: "tool",
          tool: "task",
          callID: "call_invalid",
          state: { status: "pending", input: {}, raw: "" },
          displayData: {
            overview: { request: "Research" },
            details: {
              tool: "task",
              description: "Research",
              prompt: "Research",
              subagentType: "analyst",
              sessionId: "",
            },
          },
        })})
      `);
      const before = yield* db.select().from(agentParts);
      const ledger = yield* db.all(sql`SELECT * FROM app_schema_migrations`);
      expect(
        Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
      ).toBe(true);
      expect(yield* db.select().from(agentParts)).toEqual(before);
      expect(yield* db.all(sql`SELECT * FROM app_schema_migrations`)).toEqual(
        ledger,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
