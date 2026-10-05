// Purpose: Proves context conversion preserves prompt facts and all surrounding durable state.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import {
  Part,
  type EvidenceCandidate,
} from "@openchart/server/agent/contracts/part";
import { PartData } from "@openchart/server/agent/session/message/data";
import {
  agentMessages,
  agentParts,
  agentRun,
} from "@openchart/server/agent/schema";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { agentSchedules } from "@openchart/server/resources/agent-schedule/schema";
import { HistoricalPromptTarget } from "./historical-prompt-target";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

function predecessor() {
  return Effect.gen(function* () {
    const index = migrations.findIndex((migration) =>
      migration.id.endsWith("_simplify-context-parts"),
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
        model: { providerID: "codex" as const, modelID: "tier1" as const },
      },
    });
    return db;
  });
}

function resourcePart(type: string, path: string, scope = "attached") {
  return {
    type: "context",
    model: {
      kind: "resource_reference",
      scope,
      pointer: {
        schema: "openchart.resource-pointer.v1",
        type,
        path,
        snapshot: {
          label: "Historical label",
          detail: "Display detail",
          summary: "Display summary",
          thumbnail: { kind: "url", value: "https://example.com/image" },
          revision: 4,
          updatedAt: "2026-09-06T00:00:00.000Z",
        },
      },
    },
    ...(scope === "attached" ? { display: { kind: "resource_tree" } } : {}),
  };
}

test("converts transcript, run, and schedule contexts while preserving evidence and session boundaries", async () => {
  const evidence = [
    {
      source: {
        kind: "web_search_result",
        title: "Source",
        url: "https://example.com/article",
        hostname: "example.com",
      },
      blocks: [{ kind: "excerpt", text: "Exact source text." }],
    },
  ] satisfies EvidenceCandidate[];
  const session = {
    sessionId: "ses_analysis",
    throughCreatedAt: "2026-09-06T00:00:00.000Z",
  };
  const fixtures: { before: Record<string, unknown>; after: PartData }[] = [
    {
      before: resourcePart(
        "chart",
        "/dashboards/dsh_1/charts/chr%20one",
        "current",
      ),
      after: {
        type: "context",
        context: {
          kind: "resource",
          resource: "chart",
          id: "chr one",
          scope: "current",
        },
      },
    },
    {
      before: resourcePart("dashboard", "/dashboards/dsh_1"),
      after: {
        type: "context",
        context: {
          kind: "resource",
          resource: "dashboard",
          id: "dsh_1",
          scope: "attached",
        },
      },
    },
    {
      before: resourcePart(
        "drawing",
        "/dashboards/dsh_1/listings/42/drawings/drw_1",
      ),
      after: {
        type: "context",
        context: {
          kind: "resource",
          resource: "drawing",
          id: "drw_1",
          scope: "attached",
        },
      },
    },
    {
      before: resourcePart(
        "listing_scope",
        "/dashboards/dsh_1/listings/42",
        "current",
      ),
      after: {
        type: "context",
        context: {
          kind: "document",
          title: "Historical label",
          text: "Current listing context:\nDashboard ID: dsh_1\nListing ID: 42",
        },
      },
    },
    {
      before: {
        type: "context",
        model: {
          kind: "document",
          label: "News",
          content: "Analyze sources.",
          evidence,
        },
        display: {
          kind: "news",
          article: { title: "News", publisher: "Publisher" },
        },
      },
      after: {
        type: "context",
        context: {
          kind: "document",
          title: "News",
          text: "Analyze sources.",
          evidence,
        },
      },
    },
    {
      before: {
        type: "context",
        model: { kind: "document", label: "Notes", content: "Full text" },
      },
      after: {
        type: "context",
        context: { kind: "document", title: "Notes", text: "Full text" },
      },
    },
    {
      before: {
        type: "context",
        model: { kind: "session_reference", ...session },
        display: {
          kind: "session_reference",
          label: "Prior analysis",
          detail: "AAPL",
        },
      },
      after: { type: "context", context: { kind: "session", ...session } },
    },
  ];
  const untouched = {
    type: "text" as const,
    text: "Keep this",
    metadata: {
      model: { kind: "session_reference" },
      display: { kind: "news" },
    },
  };
  fixtures.push({ before: untouched, after: untouched });
  const prompt = (parts: unknown[]) => ({
    agent: "analyst",
    model: {
      providerID: "codex" as const,
      modelID: "tier1" as const,
      selectedVariant: "high",
    },
    parts,
  });
  const oldPrompt = prompt(
    fixtures.map(({ before }, index) => ({ id: `prt_${index}`, ...before })),
  );
  const newPrompt = prompt(
    fixtures.map(({ after }, index) => ({ id: `prt_${index}`, ...after })),
  );
  const materialized = {
    type: "evidence",
    evidenceID: "evd_0123456789ABCD",
    sourcePartID: "prt_4",
    capturedAt: 100,
    contentHash: "a".repeat(64),
    source: evidence[0]!.source,
    blocks: [
      {
        id: "b0",
        kind: "excerpt",
        text: "Exact source text.",
        truncated: false,
      },
    ],
  } satisfies PartData;

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
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, session_id, data)
        VALUES ('prt_evidence', 'msg_parent', 'ses_parent', ${JSON.stringify(materialized)})
      `);
      yield* db.run(sql`
        INSERT INTO agent_run (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('agr_original', 'ses_parent', 'intent_1', ${JSON.stringify(oldPrompt)}, 'queued', 0, 100)
      `);
      const target = {
        kind: "agent_prompt",
        prompt: oldPrompt,
        binding: { key: "slot" },
      };
      yield* db.run(sql`
        INSERT INTO agent_schedule
          (id, user_id, name, target_json, recurrence, next_fire_at, revision, created_at, updated_at)
        VALUES ('ags_1', 'user', 'Research', ${JSON.stringify(target)},
          ${JSON.stringify({ kind: "once", fireAt: "2026-09-08T00:00:00.000Z" })}, 1000, 7, 100, 200)
      `);
      const beforeParts = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      const beforeRuns = yield* db.select().from(agentRun);
      const beforeSchedules = yield* db.select().from(agentSchedules);
      const beforeMessages = yield* db.select().from(agentMessages);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const afterParts = yield* db
        .select()
        .from(agentParts)
        .orderBy(agentParts.id);
      expect(afterParts).toEqual(
        beforeParts.map((row) => ({
          ...row,
          data:
            row.id === "prt_evidence"
              ? materialized
              : fixtures[Number(row.id.slice(4))]!.after,
        })),
      );
      expect(yield* db.select().from(agentRun)).toEqual(
        beforeRuns.map((row) => ({ ...row, input: newPrompt })),
      );
      const newTarget = { ...target, prompt: newPrompt };
      expect(yield* db.select().from(agentSchedules)).toEqual(
        beforeSchedules.map((row) => ({ ...row, target: newTarget })),
      );
      expect(yield* db.select().from(agentMessages)).toEqual(beforeMessages);
      expect(Schema.decodeUnknownSync(AgentPromptInput)(newPrompt)).toEqual(
        newPrompt,
      );
      expect(
        Schema.decodeUnknownSync(HistoricalPromptTarget)(newTarget),
      ).toEqual(newTarget);
      for (const row of afterParts) {
        expect(Schema.decodeUnknownSync(PartData)(row.data)).toEqual(row.data);
        const complete = {
          ...row.data,
          id: row.id,
          messageID: row.messageId,
        };
        expect(Schema.decodeUnknownSync(Part)(complete)).toEqual(complete);
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

test.each([
  resourcePart("chart", "/dashboards/dsh_1"),
  resourcePart("chart", "/dashboards/dsh_1/charts/_"),
  {
    type: "context",
    model: { kind: "session_reference", sessionId: "ses_analysis" },
  },
])(
  "rejects invalid context without changing rows or advancing the ledger",
  async (invalid) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* predecessor();
        for (const [index, data] of [
          resourcePart("dashboard", "/dashboards/dsh_1"),
          invalid,
        ].entries()) {
          yield* db.run(sql`
          INSERT INTO agent_parts (id, message_id, session_id, data)
          VALUES (${`prt_${index}`}, 'msg_parent', 'ses_parent', ${JSON.stringify(data)})
        `);
        }
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

test("rolls back transcript and run changes when a scheduled context is invalid", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* predecessor();
      const context = resourcePart("dashboard", "/dashboards/dsh_1");
      const prompt = {
        agent: "analyst",
        model: { providerID: "codex" as const, modelID: "tier1" as const },
        parts: [context],
      };
      yield* db.run(sql`
        INSERT INTO agent_parts (id, message_id, session_id, data)
        VALUES ('prt_1', 'msg_parent', 'ses_parent', ${JSON.stringify(context)})
      `);
      yield* db.run(sql`
        INSERT INTO agent_run (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('agr_1', 'ses_parent', 'intent_1', ${JSON.stringify(prompt)}, 'queued', 0, 100)
      `);
      const target = {
        kind: "agent_prompt",
        prompt: {
          ...prompt,
          parts: [
            {
              type: "context",
              model: { kind: "session_reference", sessionId: "ses_other" },
            },
          ],
        },
      };
      yield* db.run(sql`
        INSERT INTO agent_schedule (id, user_id, name, target_json, recurrence, next_fire_at)
        VALUES ('ags_1', 'user', 'Research', ${JSON.stringify(target)},
          ${JSON.stringify({ kind: "once", fireAt: "2026-09-08T00:00:00.000Z" })}, 1000)
      `);
      const parts = yield* db.select().from(agentParts);
      const runs = yield* db.select().from(agentRun);
      const schedules = yield* db.select().from(agentSchedules);
      const ledger = yield* db.all(sql`SELECT * FROM app_schema_migrations`);
      expect(
        Exit.isFailure(yield* Effect.exit(DatabaseMigration.apply(db))),
      ).toBe(true);
      expect(yield* db.select().from(agentParts)).toEqual(parts);
      expect(yield* db.select().from(agentRun)).toEqual(runs);
      expect(yield* db.select().from(agentSchedules)).toEqual(schedules);
      expect(yield* db.all(sql`SELECT * FROM app_schema_migrations`)).toEqual(
        ledger,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
