// Purpose: Proves retiring quote sources preserves text, prompt order and unrelated data.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
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
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const source = {
  sessionId: "ses_source",
  messageId: "msg_source",
  partId: "prt_source",
  startOffset: 2,
  endOffset: 19,
};
const quote = {
  kind: "quote",
  text: " Quoted € text\n**preserve** 🧭 ",
} as const;
const untouched = [
  {
    type: "text",
    text: "Question",
    metadata: { snapshot: { type: "context", context: { ...quote, source } } },
  },
  { type: "context", context: { kind: "dig_in", quoteText: "Selection" } },
  {
    type: "context",
    context: { kind: "document", title: "Notes", text: "Keep" },
  },
] as const satisfies readonly PartData[];
const fixtures: { before: Schema.JsonObject; after: PartData }[] = [
  {
    before: { type: "context", context: { ...quote, source } },
    after: { type: "context", context: quote },
  },
  ...untouched.map((part) => ({ before: part, after: part })),
  {
    before: {
      type: "context",
      context: {
        kind: "quote",
        text: "",
        source: { partId: "", startOffset: -1, endOffset: -3 },
      },
    },
    after: { type: "context", context: { kind: "quote", text: "" } },
  },
  {
    before: { type: "context", context: quote },
    after: { type: "context", context: quote },
  },
];
const model = { providerID: "codex" as const, modelID: "tier1" as const };

test("removes only quote sources from predecessor transcripts, Runs and Schedules", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex(({ id }) =>
        id.endsWith("_remove-quote-source"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db
        .insert(agentSessions)
        .values({ id: "ses_quote", kind: "chat", title: "Keep" });
      yield* db.insert(agentMessages).values({
        id: "msg_quote",
        sessionId: "ses_quote",
        role: "user",
        data: { time: { created: 10 }, agent: "analyst", model },
      });
      for (const [index, fixture] of fixtures.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_parts (id, message_id, data, created_at, updated_at)
          VALUES (${`prt_${index}`}, 'msg_quote', ${JSON.stringify(fixture.before)}, 100, 200)
        `);
      }
      const promptFixtures = [fixtures, fixtures.slice(1, 4)];
      for (const [index, parts] of promptFixtures.entries()) {
        const prompt = {
          agent: "analyst",
          model,
          parts: parts.map(({ before }, index) => ({
            ...before,
            id: `prt_${index}`,
          })),
        };
        yield* db.run(sql`
          INSERT INTO agent_run (id, session_id, session_intent_id, input, status, queue_position, created_at)
          VALUES (${`agr_${index}`}, 'ses_quote', ${`intent_${index}`}, ${JSON.stringify(prompt)}, 'queued', ${index}, 100)
        `);
        yield* db.run(sql`
          INSERT INTO agent_schedule (id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
          VALUES (${`ags_${index}`}, 'Keep', ${JSON.stringify({ kind: "agent_prompt", binding: { key: "slot" }, prompt })},
            '{"kind":"once","fireAt":"2026-09-20T00:00:00.000Z"}', 1000, 7, 100, 200)
        `);
      }
      const snapshot = () =>
        Effect.all({
          sessions: db.select().from(agentSessions),
          messages: db.select().from(agentMessages),
          parts: db.select().from(agentParts).orderBy(agentParts.id),
          runs: db.select().from(agentRun).orderBy(agentRun.id),
          schedules: db
            .select()
            .from(agentSchedules)
            .orderBy(agentSchedules.id),
          ledger: db.all(
            sql`SELECT * FROM app_schema_migrations ORDER BY version`,
          ),
        });
      const before = yield* snapshot();
      yield* DatabaseMigration.apply(db);
      const after = yield* snapshot();
      const prompts = promptFixtures.map((parts) => ({
        agent: "analyst",
        model,
        parts: parts.map(({ after }, index) => ({
          ...after,
          id: `prt_${index}`,
        })),
      }));
      expect(after).toEqual({
        ...before,
        parts: before.parts.map((part, index) => ({
          ...part,
          data: fixtures[index]!.after,
        })),
        runs: before.runs.map((run, index) => ({
          ...run,
          input: prompts[index],
        })),
        schedules: before.schedules.map((schedule, index) => ({
          ...schedule,
          target: { ...schedule.target, prompt: prompts[index] },
        })),
        ledger: [
          ...before.ledger,
          ...migrations
            .slice(index)
            .map(({ id }) => expect.objectContaining({ id })),
        ],
      });
      for (const part of after.parts)
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      for (const run of after.runs)
        expect(Schema.decodeUnknownSync(AgentPromptInput)(run.input)).toEqual(
          run.input,
        );
      for (const schedule of after.schedules)
        expect(
          Schema.decodeUnknownSync(HistoricalPromptTarget)(schedule.target),
        ).toEqual(schedule.target);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      yield* DatabaseMigration.apply(db);
      expect(yield* snapshot()).toEqual(after);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
