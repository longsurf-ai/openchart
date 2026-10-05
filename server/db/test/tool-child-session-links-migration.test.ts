// Purpose: Proves tool child links migrate without losing workflow relationships.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { PartData } from "@openchart/server/agent/session/message/data";
import { agentParts } from "@openchart/server/agent/schema";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

const index = migrations.findIndex(({ id }) =>
  id.endsWith("_tool-child-session-links"),
);

function predecessor(parts: readonly object[]) {
  return Effect.gen(function* () {
    expect(index).toBeGreaterThan(0);
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
    yield* db.run(
      sql`INSERT INTO agent_sessions (id, kind, title) VALUES ('ses_parent', 'chat', 'Parent')`,
    );
    yield* db.run(
      sql`INSERT INTO agent_messages (id, session_id, role, data) VALUES ('msg_parent', 'ses_parent', 'user', '{}')`,
    );
    for (const [i, part] of parts.entries())
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, data, created_at, updated_at)
        VALUES (${`prt_${i}`}, 'msg_parent', ${JSON.stringify(part)}, 100, 200)
      `);
    return db;
  });
}

const pending = {
  type: "tool",
  tool: "task",
  callID: "call",
  state: { status: "pending", input: {} },
};
const trace = {
  resourceSpans: [
    {
      scopeSpans: [
        {
          spans: ["ses_b", "ses_a", "ses_b"].map((id) => ({
            name: "Workflow.agent",
            attributes: [
              { key: "openchart.session.id", value: { stringValue: id } },
            ],
          })),
        },
      ],
    },
  ],
};

test("migrates scalar and trace links to unique collections in every state, preserving other facts", async () => {
  const fixtures = [
    { before: pending, ids: [] },
    { before: { ...pending, childSessionId: "ses_child" }, ids: ["ses_child"] },
    ...[
      { status: "running", input: {}, time: { start: 1 } },
      {
        status: "completed",
        input: {},
        title: "Done",
        output: { type: "text", value: "Done" },
        time: { start: 1, end: 2 },
      },
      {
        status: "error",
        input: {},
        error: "Cancelled",
        time: { start: 1, end: 2 },
      },
    ].map((state) => ({
      before: {
        ...pending,
        tool: "workflow",
        childSessionId: "ses_c",
        state: {
          ...state,
          metadata: { trace, preparedArgs: { topic: "keep" } },
        },
      },
      ids: ["ses_a", "ses_b", "ses_c"],
    })),
    {
      before: {
        ...pending,
        state: {
          status: "running",
          input: {},
          time: { start: 1 },
          metadata: { trace },
        },
      },
      ids: [],
    },
  ];
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor([
        ...fixtures.map(({ before }) => before),
        { type: "text", text: "Untouched" },
      ]);
      const before = yield* db.select().from(agentParts).orderBy(agentParts.id);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const after = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(after).toEqual(
        before.map((row, i) => {
          const fixture = fixtures[i];
          if (!fixture) return row;
          const data = { ...row.data } as Record<string, unknown>;
          delete data.childSessionId;
          return { ...row, data: { ...data, childSessionIds: fixture.ids } };
        }),
      );
      for (const row of after)
        expect(Schema.decodeUnknownSync(PartData)(row.data)).toEqual(row.data);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test.each([
  { ...pending, childSessionId: "" },
  { ...pending, childSessionId: 42 },
  {
    ...pending,
    tool: "workflow",
    state: {
      ...pending.state,
      metadata: {
        trace: {
          attributes: [
            { key: "openchart.session.id", value: { stringValue: "" } },
          ],
        },
      },
    },
  },
])(
  "rejects invalid child links without changing rows or advancing the ledger",
  async (part) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* predecessor([part]);
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
  },
);
