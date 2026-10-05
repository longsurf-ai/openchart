// Purpose: Proves retired text flags cannot expose old content after transcript and prompt upgrades.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { WithParts } from "@openchart/server/agent/contracts/message";
import { PartData } from "@openchart/server/agent/session/message/data";
import { toModelMessages } from "@openchart/server/agent/session/message/to-model-messages";
import { visibleTextPart } from "@openchart/server/agent/session/message/visibility";
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

const text = { type: "text", text: "Visible", time: { start: 10, end: 20 } };
const metadata = { provider: { ignored: true, hiddenContext: true } };
const fixtures = [
  { before: text, after: text },
  { before: { ...text, ignored: false }, after: text },
  {
    before: { ...text, text: "Discard ignored input", ignored: true },
    after: { ...text, text: "", synthetic: true },
  },
  {
    before: { ...text, metadata: { ...metadata, hiddenContext: true } },
    after: { ...text, metadata, synthetic: true },
  },
  {
    before: { ...text, metadata: { ...metadata, hiddenContext: false } },
    after: { ...text, metadata },
  },
  {
    before: { ...text, synthetic: false, metadata: { hiddenContext: true } },
    after: { ...text, synthetic: true, metadata: {} },
  },
  {
    before: {
      ...text,
      text: "Discard both flags",
      ignored: true,
      synthetic: false,
      metadata: { ...metadata, hiddenContext: true },
    },
    after: { ...text, text: "", synthetic: true, metadata },
  },
  {
    before: { ...text, ignored: false, synthetic: true, metadata },
    after: { ...text, synthetic: true, metadata },
  },
  {
    before: {
      type: "reasoning",
      text: "Keep reasoning",
      time: { start: 1 },
      metadata: { hiddenContext: true },
    },
    after: {
      type: "reasoning",
      text: "Keep reasoning",
      time: { start: 1 },
      metadata: { hiddenContext: true },
    },
  },
];
const model = { providerID: "codex" as const, modelID: "tier1" as const };

test("upgrades populated transcripts and Run/Schedule prompts without reviving ignored text", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_remove-text-visibility-flags"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db
        .insert(agentSessions)
        .values({ kind: "chat", id: "ses_flags", title: "Keep" });
      yield* db.insert(agentMessages).values({
        id: "msg_flags",
        sessionId: "ses_flags",
        role: "user",
        data: { time: { created: 10 }, agent: "analyst", model },
      });
      for (const [index, fixture] of fixtures.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_parts (id, message_id, data, created_at, updated_at)
          VALUES (${`prt_${index}`}, 'msg_flags', ${JSON.stringify(fixture.before)}, 100, 200)
        `);
      }
      const promptFixtures = [
        fixtures.filter((fixture) => fixture.before.type === "text"),
        [fixtures[2]!],
      ];
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
          INSERT INTO agent_run
            (id, session_id, session_intent_id, input, status, queue_position, created_at)
          VALUES (${`agr_${index}`}, 'ses_flags', ${`intent_${index}`},
            ${JSON.stringify(prompt)}, 'queued', ${index}, 100)
        `);
        yield* db.run(sql`
          INSERT INTO agent_schedule
            (id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
          VALUES (${`ags_${index}`}, 'Keep',
            ${JSON.stringify({ kind: "agent_prompt", binding: { key: "slot" }, prompt })},
            '{"kind":"once","fireAt":"2026-09-10T00:00:00.000Z"}', 1000, 7, 100, 200)
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

      const saved = yield* db.select().from(agentParts).orderBy(agentParts.id);
      expect(saved).toEqual(
        fixtures.map((fixture, index) => ({
          id: `prt_${index}`,
          messageId: "msg_flags",
          data: fixture.after,
          createdAt: 100,
          updatedAt: 200,
        })),
      );
      for (const part of saved)
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

      const message = Schema.decodeUnknownSync(WithParts)({
        info: {
          id: "msg_flags",
          sessionID: "ses_flags",
          role: "user",
          time: { created: 10 },
          agent: "analyst",
          model,
        },
        parts: saved.map((part) => ({
          ...part.data,
          id: part.id,
          messageID: part.messageId,
        })),
      });
      expect(
        message.parts.filter(visibleTextPart).map((part) => part.id),
      ).toEqual(["prt_0", "prt_1", "prt_4"]);
      const replay = yield* toModelMessages([message], {
        providerID: model.providerID,
        id: model.modelID,
      });
      expect(JSON.stringify(replay)).not.toContain("Discard");
      expect(replay[0]?.content).toEqual(
        fixtures
          .filter((fixture) => fixture.after.type === "text")
          .map((fixture) => ({
            type: "text",
            text: fixture.after.text,
          })),
      );
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
