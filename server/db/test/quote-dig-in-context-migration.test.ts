// Purpose: Proves quote/dig-in context upgrades preserve content, ownership, and prompt snapshots atomically.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { Part } from "@openchart/server/agent/contracts/part";
import { PartData } from "@openchart/server/agent/session/message/data";
import {
  agentMessages,
  agentParts,
  agentRun,
} from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { agentSchedules } from "@openchart/server/resources/agent-schedule/schema";
import { HistoricalPromptTarget } from "./historical-prompt-target";
import { getTableColumns, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema, Struct } from "effect";
import { expect, test } from "vitest";

const text = " Quoted € text\n**Dig deeper** 🧭 ";
const source = {
  sessionId: "ses_parent",
  messageId: "msg_source",
  partId: "prt_source",
  startOffset: 2,
  endOffset: 19,
};
const untouched = {
  type: "text",
  text: "Question",
  metadata: {
    type: "quote",
    nested: { type: "dig_in_context", quoteText: text },
  },
} as const;
const existing = {
  type: "context",
  context: { kind: "document", title: "Document", text },
} as const;
const fixtures = [
  {
    before: { type: "quote", text, source },
    after: { type: "context", context: { kind: "quote", text } },
  },
  { before: untouched, after: untouched },
  {
    before: { type: "dig_in_context", quoteText: text },
    after: { type: "context", context: { kind: "dig_in", quoteText: text } },
  },
  { before: existing, after: existing },
  {
    before: { type: "quote", text: "" },
    after: { type: "context", context: { kind: "quote", text: "" } },
  },
  {
    before: { type: "dig_in_context", quoteText: "" },
    after: { type: "context", context: { kind: "dig_in", quoteText: "" } },
  },
  {
    before: {
      type: "quote",
      text,
      source: { partId: "", startOffset: -1, endOffset: -3 },
    },
    after: {
      type: "context",
      context: {
        kind: "quote",
        text,
      },
    },
  },
] satisfies { before: Schema.JsonObject; after: PartData }[];
const input = {
  agent: "analyst",
  model: { providerID: "codex" as const, modelID: "tier1" as const },
  parts: fixtures.map(({ before }, index) => ({
    ...before,
    id: `prt_${index}`,
    origin: "inherited" as const,
  })),
};
const target = {
  kind: "agent_prompt",
  binding: { key: "slot" },
  prompt: input,
};
const expectedInput = {
  ...input,
  parts: fixtures.map(({ after }, index) => ({
    ...after,
    id: `prt_${index}`,
  })),
};

function predecessor() {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_merge-quote-dig-in-context"),
    );
    expect(index).toBeGreaterThan(0);
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
    yield* db.run(sql`
      INSERT INTO agent_sessions (id, user_id, title, anchors, parent_id, kind)
      VALUES ('ses_parent', 'user', 'Research', ${JSON.stringify([
        {
          partId: source.partId,
          text,
          startOffset: source.startOffset,
          endOffset: source.endOffset,
          childSessionId: "ses_child",
          sessionIntentId: "intent_branch",
        },
      ])}, NULL, NULL),
        ('ses_child', 'user', 'Dig in', NULL, 'ses_parent', 'dig_in')
    `);
    yield* db.insert(agentMessages).values({
      id: "msg_child",
      sessionId: "ses_child",
      role: "user",
      data: { time: { created: 10 }, agent: input.agent, model: input.model },
    });
    for (const [index, fixture] of fixtures.entries()) {
      yield* db.run(sql`
        INSERT INTO agent_parts
          (id, message_id, session_id, data, origin, created_at, updated_at)
        VALUES (${`prt_${index}`}, 'msg_child', 'ses_child',
          ${JSON.stringify(fixture.before)},
          ${index % 2 === 0 ? "original" : "inherited"}, ${100 + index}, ${200 + index})
      `);
    }
    yield* db.run(sql`
      INSERT INTO agent_run (id, session_id, session_intent_id, input, status, queue_position, created_at)
      VALUES ('agr_1', 'ses_child', 'intent_run', ${JSON.stringify(input)}, 'queued', 0, 100)
    `);
    yield* db.run(sql`
      INSERT INTO agent_schedule
        (id, user_id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
      VALUES ('ags_1', 'user', 'Research', ${JSON.stringify(target)},
        ${JSON.stringify({ kind: "once", fireAt: "2026-09-08T00:00:00.000Z" })}, 1000, 7, 100, 200)
    `);
    return db;
  });
}

test("moves both variants into context without changing content, identities, relationships, or row metadata", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      const sessions = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      const messages = yield* db.select().from(agentMessages);
      const parts = yield* db.select().from(agentParts).orderBy(agentParts.id);
      const runs = yield* db.select().from(agentRun);
      const schedules = yield* db.select().from(agentSchedules);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const converted = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      expect(converted).toEqual(
        parts.map((part, index) => ({ ...part, data: fixtures[index]!.after })),
      );
      for (const part of converted) {
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
        const complete = {
          ...part.data,
          id: part.id,
          messageID: part.messageId,
        };
        expect(Schema.decodeUnknownSync(Part)(complete)).toEqual(complete);
      }
      expect(yield* db.select().from(agentSessions)).toEqual(
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
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.select().from(agentRun)).toEqual(
        runs.map((run) => ({ ...run, input: expectedInput })),
      );
      const expectedTarget = { ...target, prompt: expectedInput };
      expect(yield* db.select().from(agentSchedules)).toEqual(
        schedules.map((schedule) => ({ ...schedule, target: expectedTarget })),
      );
      expect(Schema.decodeUnknownSync(AgentPromptInput)(expectedInput)).toEqual(
        expectedInput,
      );
      expect(
        Schema.decodeUnknownSync(HistoricalPromptTarget)(expectedTarget),
      ).toEqual(expectedTarget);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test.each(["part", "run", "schedule"])(
  "rolls back all converted rows and the ledger when a %s has invalid content",
  async (boundary) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* predecessor();
        const invalid = { type: "dig_in_context", quoteText: 42 };
        const invalidInput = { ...input, parts: [...input.parts, invalid] };
        if (boundary === "part") {
          yield* db.run(sql`
            UPDATE agent_parts SET data = ${JSON.stringify(invalid)} WHERE id = 'prt_6'
          `);
        }
        if (boundary === "run") {
          yield* db.run(sql`
            UPDATE agent_run SET input = ${JSON.stringify(invalidInput)} WHERE id = 'agr_1'
          `);
        }
        if (boundary === "schedule") {
          yield* db.run(sql`
            UPDATE agent_schedule SET target_json = ${JSON.stringify({ ...target, prompt: invalidInput })}
            WHERE id = 'ags_1'
          `);
        }
        const parts = yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`);
        const runs = yield* db.all(sql`SELECT * FROM agent_run ORDER BY id`);
        const schedules = yield* db.all(
          sql`SELECT * FROM agent_schedule ORDER BY id`,
        );
        const ledger = yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        );
        expect(
          Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
        ).toBe(true);
        expect(
          yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`),
        ).toEqual(parts);
        expect(yield* db.all(sql`SELECT * FROM agent_run ORDER BY id`)).toEqual(
          runs,
        );
        expect(
          yield* db.all(sql`SELECT * FROM agent_schedule ORDER BY id`),
        ).toEqual(schedules);
        expect(
          yield* db.all(
            sql`SELECT * FROM app_schema_migrations ORDER BY version`,
          ),
        ).toEqual(ledger);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
    );
  },
);
