// Purpose: Proves plugin context upgrades preserve transcript and prompt facts atomically.

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
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

const legacy = {
  type: "plugin_context",
  pluginId: "research",
  contributionId: "selection",
  content: " Context €\n**preserve** 🧭 ",
};
const converted = {
  type: "context",
  context: {
    kind: "plugin",
    pluginId: legacy.pluginId,
    hook: "run.before",
    content: legacy.content,
  },
};
const untouched = [
  { type: "text", text: "Question", metadata: { snapshot: legacy } },
  {
    type: "context",
    context: { kind: "document", title: "Notes", text: "Keep" },
  },
  { type: "plugin_input", input: { type: "alert_trigger", eventId: "event" } },
];
const fixtures = [
  { before: legacy, after: converted },
  ...untouched.map((part) => ({ before: part, after: part })),
];
const model = { providerID: "codex" as const, modelID: "tier1" as const };

function predecessor() {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_merge-plugin-context"),
    );
    expect(index).toBeGreaterThan(0);
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
    yield* db
      .insert(agentSessions)
      .values({ kind: "chat", id: "ses_context", title: "Keep" });
    yield* db.insert(agentMessages).values({
      id: "msg_context",
      sessionId: "ses_context",
      role: "user",
      data: { time: { created: 10 }, agent: "analyst", model },
    });
    for (const [index, fixture] of fixtures.entries()) {
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, data, created_at, updated_at)
        VALUES (${`prt_${index}`}, 'msg_context', ${JSON.stringify(fixture.before)}, 100, 200)
      `);
    }
    return { db, index };
  });
}

test("upgrades predecessor transcripts and prompt snapshots without changing other facts", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db, index } = yield* predecessor();
      const promptFixtures = [fixtures, fixtures.slice(1)];
      for (const [index, parts] of promptFixtures.entries()) {
        const prompt = {
          agent: "analyst",
          model,
          parts: parts.map((fixture, index) => ({
            id: `prt_${index}`,
            ...fixture.before,
          })),
        };
        yield* db.run(sql`
        INSERT INTO agent_run (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES (${`agr_${index}`}, 'ses_context', ${`intent_${index}`}, ${JSON.stringify(prompt)}, 'queued', ${index}, 100)
      `);
        yield* db.run(sql`
        INSERT INTO agent_schedule (id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
        VALUES (${`ags_${index}`}, 'Keep', ${JSON.stringify({ kind: "agent_prompt", binding: { key: "slot" }, prompt })},
          '{"kind":"once","fireAt":"2026-09-12T00:00:00.000Z"}', 1000, 7, 100, 200)
      `);
      }
      const sessions = yield* db.select().from(agentSessions);
      const messages = yield* db.select().from(agentMessages);
      const runs = yield* db.select().from(agentRun).orderBy(agentRun.id);
      const schedules = yield* db
        .select()
        .from(agentSchedules)
        .orderBy(agentSchedules.id);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      const parts = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(parts).toEqual(
        fixtures.map((fixture, index) => ({
          id: `prt_${index}`,
          messageId: "msg_context",
          data: fixture.after,
          createdAt: 100,
          updatedAt: 200,
        })),
      );
      for (const part of parts)
        expect(Schema.decodeUnknownSync(PartData)(part.data)).toEqual(
          part.data,
        );
      const prompts = promptFixtures.map((parts) => ({
        agent: "analyst",
        model,
        parts: parts.map((fixture, index) => ({
          id: `prt_${index}`,
          ...fixture.after,
        })),
      }));
      for (const prompt of prompts)
        expect(Schema.decodeUnknownSync(AgentPromptInput)(prompt)).toEqual(
          prompt,
        );
      expect(yield* db.select().from(agentRun).orderBy(agentRun.id)).toEqual(
        runs.map((run, index) => ({ ...run, input: prompts[index] })),
      );
      const savedSchedules = yield* db
        .select()
        .from(agentSchedules)
        .orderBy(agentSchedules.id);
      expect(savedSchedules).toEqual(
        schedules.map((schedule, index) => ({
          ...schedule,
          target: { ...schedule.target, prompt: prompts[index] },
        })),
      );
      for (const schedule of savedSchedules)
        expect(
          Schema.decodeUnknownSync(HistoricalPromptTarget)(schedule.target),
        ).toEqual(schedule.target);
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(yield* db.select().from(agentMessages)).toEqual(messages);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      const savedLedger = yield* db.all<{ id: string }>(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(savedLedger.slice(0, index)).toEqual(ledger);
      expect(savedLedger.map((row) => row.id)).toEqual(
        migrations.map(({ id }) => id),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("invalid historical plugin context rolls back the migration and ledger together", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* predecessor();
      yield* db.run(sql`
      INSERT INTO agent_parts (id, message_id, data)
      VALUES ('prt_invalid', 'msg_context', ${JSON.stringify({ ...legacy, content: null })})
    `);
      const parts = yield* db.select().from(agentParts).orderBy(agentParts.id);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(
        Exit.isFailure(yield* DatabaseMigration.apply(db).pipe(Effect.exit)),
      ).toBe(true);
      expect(
        yield* db.select().from(agentParts).orderBy(agentParts.id),
      ).toEqual(parts);
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
