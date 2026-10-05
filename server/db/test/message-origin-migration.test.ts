// Purpose: Proves origin removal preserves transcript graphs and prompt snapshots atomically.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import {
  InfoData,
  PartData,
} from "@openchart/server/agent/session/message/data";
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
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

const model = { providerID: "codex" as const, modelID: "tier1" as const };
const messages: InfoData[] = [
  { time: { created: 10 }, agent: "analyst", model },
  {
    time: { created: 11, completed: 12 },
    triggeringUserMessageID: "msg_0",
    ...model,
    agent: "analyst",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  },
];
const attachment = {
  id: "prt_attachment",
  messageID: "msg_1",
  type: "file",
  mime: "text/plain",
  url: "file:///tmp/evidence.txt",
} as const;
const tool = {
  type: "tool",
  tool: "research",
  callID: "call_1",
  childSessionIds: ["ses_delegate"],
  state: {
    status: "completed",
    input: { origin: "user-supplied argument" },
    output: { type: "json", value: { origin: "source evidence" } },
    title: "Research",
    metadata: { origin: "provider metadata" },
    time: { start: 11, end: 12 },
    attachments: [attachment],
  },
} satisfies PartData;
const parts: PartData[] = [
  { type: "text", text: "Parent history", time: { start: 10 } },
  {
    type: "context",
    context: { kind: "dig_in", quoteText: " Selected text 🧭 " },
  },
  tool,
];
const prompt = {
  agent: "analyst",
  model,
  parts: [
    {
      id: "prt_prompt",
      type: "context",
      context: { kind: "dig_in", quoteText: "Target" },
    },
    {
      type: "text",
      text: "Question",
      metadata: { origin: "keep nested data" },
    },
    { type: "text", text: "Without origin" },
  ],
};
const legacyPrompt = {
  ...prompt,
  parts: prompt.parts.map((part, index) =>
    index < 2
      ? { ...part, origin: index === 0 ? "inherited" : "original" }
      : part,
  ),
};
const target = { kind: "agent_prompt", binding: { key: "slot" }, prompt };

function predecessor() {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_remove-message-origin"),
    );
    expect(index).toBeGreaterThan(0);
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
    yield* db.insert(agentSessions).values([
      { kind: "chat", id: "ses_parent", title: "Parent" },
      {
        id: "ses_child",
        title: "Dig in",
        parentId: "ses_parent",
        kind: "dig_in",
      },
    ]);
    for (const [index, data] of messages.entries()) {
      yield* db.run(sql`
        INSERT INTO agent_messages
          (id, session_id, role, data, origin, created_at, updated_at)
        VALUES (${`msg_${index}`}, 'ses_child', ${index === 0 ? "user" : "assistant"},
          ${JSON.stringify(data)}, ${index === 0 ? "inherited" : "original"},
          ${100 + index}, ${200 + index})
      `);
    }
    for (const [index, part] of parts.entries()) {
      const data =
        part.type === "tool"
          ? {
              ...tool,
              childSessionIds: undefined,
              childSessionId: "ses_delegate",
              state: {
                ...tool.state,
                attachments: [
                  {
                    ...attachment,
                    sessionID: "ses_child",
                    origin: "inherited",
                  },
                ],
              },
            }
          : part;
      yield* db.run(sql`
        INSERT INTO agent_parts
          (id, message_id, session_id, data, origin, created_at, updated_at)
        VALUES (${`prt_${index}`}, ${index === 2 ? "msg_1" : "msg_0"}, 'ses_child',
          ${JSON.stringify(data)}, ${index === 0 ? "inherited" : "original"},
          ${100 + index}, ${200 + index})
      `);
    }
    yield* db.run(sql`
      INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, queue_position, created_at)
      VALUES ('agr_1', 'ses_child', 'intent_1', ${JSON.stringify(legacyPrompt)}, 'queued', 0, 100)
    `);
    yield* db.run(sql`
      INSERT INTO agent_schedule
        (id, user_id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
      VALUES ('ags_1', 'user', 'Research', ${JSON.stringify({ ...target, prompt: legacyPrompt })},
        '{"kind":"once","fireAt":"2026-09-08T00:00:00.000Z"}', 1000, 7, 100, 200)
    `);
    return db;
  });
}

test("removes origins without cascading Parts or altering content, references, and row metadata", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      const beforeMessages = yield* db
        .select()
        .from(agentMessages)
        .orderBy(agentMessages.id);
      const beforeParts = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      const sessions = yield* db.select().from(agentSessions);
      const runs = yield* db.select().from(agentRun);
      const schedules = yield* db.select().from(agentSchedules);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(
        yield* db.select().from(agentMessages).orderBy(agentMessages.id),
      ).toEqual(beforeMessages);
      const afterParts = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      expect(afterParts).toEqual(
        beforeParts.map((row, index) => ({ ...row, data: parts[index] })),
      );
      for (const part of afterParts) {
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      }
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
      expect(Schema.decodeUnknownSync(HistoricalPromptTarget)(target)).toEqual(
        target,
      );
      for (const table of ["agent_messages", "agent_parts"]) {
        expect(
          (yield* db.all<{ name: string }>(
            sql`PRAGMA table_info(${sql.identifier(table)})`,
          )).map((column) => column.name),
        ).not.toContain("origin");
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

test("rolls back table rebuilds and the ledger when legacy attachments are malformed", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      const invalid = {
        ...tool,
        state: {
          ...tool.state,
          attachments: [42, { ...attachment, origin: "original" }],
        },
      };
      yield* db.run(
        sql`UPDATE agent_parts SET data = ${JSON.stringify(invalid)} WHERE id = 'prt_2'`,
      );
      const messages = yield* db.all(
        sql`SELECT * FROM agent_messages ORDER BY id`,
      );
      const parts = yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(
        Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
      ).toBe(true);
      expect(
        yield* db.all(sql`SELECT * FROM agent_messages ORDER BY id`),
      ).toEqual(messages);
      expect(yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`)).toEqual(
        parts,
      );
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
