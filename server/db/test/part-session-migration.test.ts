// Purpose: Proves Part Session removal preserves ownership, nested content, and atomic upgrades.

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
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

const attachment = {
  id: "attachment",
  messageID: "message",
  type: "file",
  mime: "text/plain",
  url: "file:///tmp/result.txt",
} as const;
const tool = {
  type: "tool",
  tool: "research",
  callID: "call",
  childSessionIds: ["child"],
  state: {
    status: "completed",
    input: { sessionID: "input-reference" },
    output: { type: "json", value: { sessionID: "output-reference" } },
    metadata: { sessionID: "provider-reference" },
    title: "Research",
    time: { start: 10, end: 20 },
    attachments: [attachment, { ...attachment, id: "attachment-2" }],
  },
} satisfies PartData;
const legacyTool = {
  ...tool,
  childSessionIds: undefined,
  childSessionId: "child",
  state: {
    ...tool.state,
    attachments: [
      { ...attachment, sessionID: "session" },
      { ...attachment, id: "attachment-2", sessionID: null },
    ],
  },
};
const prompt = {
  agent: "analyst",
  model: { providerID: "codex" as const, modelID: "tier1" as const },
  parts: [
    {
      type: "context",
      context: {
        kind: "session",
        sessionId: "ses_referenced",
        throughCreatedAt: "2026-09-06T00:00:00.000Z",
      },
    },
    {
      type: "text",
      text: "Question",
      metadata: { sessionID: "keep metadata" },
    },
  ],
};
const legacyPrompt = {
  ...prompt,
  parts: prompt.parts.map((part) => ({ ...part, sessionID: "session" })),
};
const target = { kind: "agent_prompt", prompt };

function predecessor() {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_remove-part-session"),
    );
    expect(index).toBeGreaterThan(0);
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
    yield* db
      .insert(agentSessions)
      .values({ kind: "chat", id: "session", title: "Research" });
    yield* db.insert(agentMessages).values({
      id: "message",
      sessionId: "session",
      role: "user",
      data: { time: { created: 10 }, agent: prompt.agent, model: prompt.model },
    });
    // Message ownership wins even when the historical redundant value disagrees.
    yield* db.run(sql`
      INSERT INTO agent_parts (id, message_id, session_id, data, created_at, updated_at)
      VALUES ('tool', 'message', 'redundant-other-session', ${JSON.stringify(legacyTool)}, 100, 200),
        ('text', 'message', 'session', '{"type":"text","text":"Keep content"}', 300, 400)
    `);
    yield* db.run(sql`
      INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, queue_position, created_at)
      VALUES ('run', 'session', 'intent', ${JSON.stringify(legacyPrompt)}, 'queued', 0, 100)
    `);
    yield* db.run(sql`
      INSERT INTO agent_schedule
        (id, user_id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
      VALUES ('schedule', 'user', 'Research', ${JSON.stringify({ ...target, prompt: legacyPrompt })},
        '{"kind":"once","fireAt":"2026-09-08T00:00:00.000Z"}', 1000, 7, 100, 200)
    `);
    return db;
  });
}

test("removes redundant Session ownership while preserving content, references, and foreign keys", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      const parts = yield* db.select().from(agentParts).orderBy(agentParts.id);
      const messages = yield* db.select().from(agentMessages);
      const sessions = yield* db.select().from(agentSessions);
      const runs = yield* db.select().from(agentRun);
      const schedules = yield* db.select().from(agentSchedules);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      const afterParts = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      expect(afterParts).toEqual(
        parts.map((part) =>
          part.id === "tool" ? { ...part, data: tool } : part,
        ),
      );
      for (const part of afterParts) {
        const complete = {
          ...part.data,
          id: part.id,
          messageID: part.messageId,
        };
        expect(Schema.decodeUnknownSync(Part)(complete)).toEqual(complete);
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      }
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentRun)).toEqual(
        runs.map((run) => ({ ...run, input: prompt })),
      );
      expect(yield* db.select().from(agentSchedules)).toEqual(
        schedules.map((schedule) => ({ ...schedule, target })),
      );
      expect(Schema.decodeUnknownSync(AgentPromptInput)(prompt)).toEqual(
        prompt,
      );
      expect(
        yield* db
          .select({ id: agentParts.id })
          .from(agentParts)
          .innerJoin(agentMessages, eq(agentParts.messageId, agentMessages.id))
          .where(eq(agentMessages.sessionId, "session"))
          .orderBy(agentParts.id),
      ).toEqual([{ id: "text" }, { id: "tool" }]);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_parts)`,
        )).map((column) => column.name),
      ).not.toContain("session_id");
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA index_list(agent_parts)`,
        )).map((index) => index.name),
      ).not.toContain("idx_agent_parts_session");
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            db.insert(agentParts).values({
              id: "orphan",
              messageId: "missing",
              data: { type: "text", text: "Invalid" },
            }),
          ),
        ),
      ).toBe(true);
      yield* db.delete(agentMessages).where(eq(agentMessages.id, "message"));
      expect(yield* db.select().from(agentParts)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("rolls back the column removal, content changes, and ledger if attachments are malformed", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      const invalid = {
        ...legacyTool,
        state: {
          ...legacyTool.state,
          attachments: [42, ...legacyTool.state.attachments],
        },
      };
      yield* db.run(sql`
        UPDATE agent_parts SET data = ${JSON.stringify(invalid)} WHERE id = 'tool'
      `);
      const parts = yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`);
      const columns = yield* db.all(sql`PRAGMA table_info(agent_parts)`);
      const indexes = yield* db.all(sql`PRAGMA index_list(agent_parts)`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      const runs = yield* db.select().from(agentRun);
      const schedules = yield* db.select().from(agentSchedules);
      expect(
        Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
      ).toBe(true);
      expect(yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`)).toEqual(
        parts,
      );
      expect(yield* db.all(sql`PRAGMA table_info(agent_parts)`)).toEqual(
        columns,
      );
      expect(yield* db.all(sql`PRAGMA index_list(agent_parts)`)).toEqual(
        indexes,
      );
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
      expect(yield* db.select().from(agentRun)).toEqual(runs);
      expect(yield* db.select().from(agentSchedules)).toEqual(schedules);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
