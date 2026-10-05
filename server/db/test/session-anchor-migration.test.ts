// Purpose: Proves dig-in migration preserves sessions, selections, and prompt snapshots atomically.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { SessionAnchor } from "@openchart/server/agent/contracts/session-anchor";
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
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

const anchor = {
  partId: "prt_source",
  text: " Selected text ",
  startOffset: 4,
  endOffset: 25,
  childSessionId: "ses_child",
} satisfies SessionAnchor;

function predecessor(anchors: unknown) {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_simplify-session-anchors"),
    );
    expect(index).toBeGreaterThan(0);
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
    yield* db.run(sql`
      INSERT INTO agent_sessions (id, user_id, title, anchors, created_at, updated_at)
      VALUES ('ses_parent', 'user', 'Research', ${JSON.stringify(anchors)}, 100, 200)
    `);
    yield* db.run(sql`
      INSERT INTO agent_sessions (id, user_id, parent_id, kind, title, anchors)
      VALUES ('ses_child', 'user', 'ses_parent', 'claim', 'Claim: Selected text', NULL),
        ('ses_empty', 'user', NULL, NULL, 'Empty', '[]')
    `);
    return db;
  });
}

test("converts claim anchors and all dig-in prompt snapshots without losing surrounding state", async () => {
  const secondAnchor = {
    ...anchor,
    startOffset: 30,
    endOffset: 40,
    childSessionId: "ses_other",
  };
  const selected = {
    type: "context",
    context: { kind: "dig_in", quoteText: anchor.text },
  } as const;
  const untouched = {
    type: "text",
    text: "Question",
    metadata: { kind: "claim", context: "Keep nested metadata" },
  } as const;
  const prompt = {
    agent: "analyst",
    model: { providerID: "codex" as const, modelID: "tier1" as const },
    parts: [selected, untouched, selected],
  } satisfies AgentPromptInput;
  const historicalPrompt = {
    ...prompt,
    parts: [
      { type: "dig_in_context", quoteText: anchor.text, kind: "claim" },
      untouched,
      { type: "dig_in_context", quoteText: anchor.text, kind: "dig_in" },
    ],
  };
  const target = { kind: "agent_prompt", prompt, binding: { key: "slot" } };

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor([
        {
          ...anchor,
          sessionIntentId: "intent_branch",
          kind: "claim",
          context: "Obsolete context",
        },
        { ...secondAnchor, sessionIntentId: "intent_other", kind: "dig_in" },
      ]);
      yield* db.run(sql`
        INSERT INTO agent_sessions (id, user_id, parent_id, kind, title)
        VALUES ('ses_other', 'user', 'ses_parent', 'dig_in', 'Second dig-in')
      `);
      yield* db.insert(agentMessages).values({
        id: "msg_child",
        sessionId: "ses_child",
        role: "user",
        data: {
          time: { created: 10 },
          agent: prompt.agent,
          model: prompt.model,
        },
      });
      for (const [index, part] of historicalPrompt.parts.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_parts
            (id, message_id, session_id, data, origin, created_at, updated_at)
          VALUES (${`prt_${index}`}, 'msg_child', 'ses_child',
            ${JSON.stringify(part)}, 'inherited', 100, 200)
        `);
      }
      yield* db.run(sql`
        INSERT INTO agent_run (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('agr_1', 'ses_child', 'intent_run', ${JSON.stringify(historicalPrompt)}, 'queued', 0, 100)
      `);
      yield* db.run(sql`
        INSERT INTO agent_schedule
          (id, user_id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
        VALUES ('ags_1', 'user', 'Research',
          ${JSON.stringify({ ...target, prompt: historicalPrompt })},
          ${JSON.stringify({ kind: "once", fireAt: "2026-09-08T00:00:00.000Z" })}, 1000, 7, 100, 200)
      `);
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
      expect(yield* db.select().from(agentSessions)).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind === "claim" ? "dig_in" : (session.kind ?? "chat"),
          anchors:
            session.id === "ses_parent"
              ? [anchor, secondAnchor]
              : session.anchors,
        })),
      );
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      const convertedParts = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      expect(convertedParts).toEqual(
        parts.map((part, index) => ({ ...part, data: prompt.parts[index] })),
      );
      for (const part of convertedParts)
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
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
      expect(
        Schema.decodeUnknownSync(
          Schema.Array(SessionAnchor).pipe(Schema.mutable),
        )([anchor, secondAnchor]),
      ).toEqual([anchor, secondAnchor]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test.each([{ sessionIntentId: undefined }, { startOffset: undefined }])(
  "rejects incomplete historical anchors without rewriting data or advancing the ledger: %j",
  async (missing) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* predecessor([
          {
            ...anchor,
            sessionIntentId: "intent_branch",
            ...missing,
            kind: "claim",
          },
        ]);
        const before = yield* db.select().from(agentSessions);
        const ledger = yield* db.all(sql`SELECT * FROM app_schema_migrations`);
        expect(
          Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
        ).toBe(true);
        expect(yield* db.select().from(agentSessions)).toEqual(before);
        expect(yield* db.all(sql`SELECT * FROM app_schema_migrations`)).toEqual(
          ledger,
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
    );
  },
);
