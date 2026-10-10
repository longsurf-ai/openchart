// Purpose: Proves the Workspace Datasets migration keeps Schedule history and chart bindings while admitting the new shapes.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

const target = {
  kind: "agent_prompt",
  prompt: {
    agent: "analyst",
    model: { providerID: "codex", modelID: "tier1" },
    parts: [{ type: "text", text: "Research the watchlist." }],
  },
};
const recurrence = { kind: "once", fireAt: "2026-09-11T00:00:00.000Z" };

test("keeps Occurrences and chart series, then accepts collections without Runs", async () => {
  const at = migrations.findIndex((migration) =>
    migration.id.endsWith("_workspace-datasets"),
  );
  expect(at).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(sql`
        INSERT INTO agent_sessions (id, kind, title, created_at, updated_at)
        VALUES ('ses_history', 'chat', 'Scheduled research', 100, 200)
      `);
      yield* db.run(sql`
        INSERT INTO agent_run
          (id, session_id, session_intent_id, input, status, queue_position,
            created_at)
        VALUES ('agr_history', 'ses_history', 'schedule:ags_history:150',
          ${JSON.stringify(target.prompt)}, 'queued', 0, 100)
      `);
      yield* db.run(sql`
        INSERT INTO agent_schedule
          (id, name, enabled, target_json, recurrence, next_fire_at,
            revision, created_at, updated_at)
        VALUES ('ags_history', 'Research', 1, ${JSON.stringify(target)},
          ${JSON.stringify(recurrence)}, 400, 7, 100, 300)
      `);
      yield* db.run(sql`
        INSERT INTO agent_schedule_occurrence
          (id, schedule_id, agent_run_id, fire_at, revision, created_at, updated_at)
        VALUES ('aso_history', 'ags_history', 'agr_history', 150, 3, 200, 250)
      `);
      yield* db.run(sql`
        INSERT INTO dashboard (id, name, revision, created_at, updated_at)
        VALUES ('dsh_a', 'Macro', 1, 100, 100)
      `);
      yield* db.run(sql`
        INSERT INTO chart (id, dashboard_id, revision, created_at, updated_at)
        VALUES ('cht_a', 'dsh_a', 1, 100, 100)
      `);
      yield* db.run(sql`
        INSERT INTO chart_cell (id, chart_id, position) VALUES ('ccl_a', 'cht_a', 0)
      `);
      yield* db.run(sql`
        INSERT INTO chart_pane (id, cell_id, position) VALUES ('cpn_a', 'ccl_a', 0)
      `);
      yield* db.run(sql`
        INSERT INTO chart_market_source (id, cell_id, position, provider, listing)
        VALUES ('cms_a', 'ccl_a', 0, 'yfinance', '{"symbol":"SPY","currency":"USD"}')
      `);
      yield* db.run(sql`
        INSERT INTO chart_series
          (id, cell_id, pane_id, position, role, market_source_id, output)
        VALUES ('csr_a', 'ccl_a', 'cpn_a', 0, 'main', 'cms_a', 'price')
      `);
      const before = {
        schedules: yield* db.all(sql`SELECT * FROM agent_schedule`),
        occurrences: yield* db.all(
          sql`SELECT * FROM agent_schedule_occurrence`,
        ),
      };

      yield* DatabaseMigration.apply(db);

      expect(yield* db.all(sql`SELECT * FROM agent_schedule`)).toEqual(
        before.schedules,
      );
      expect(
        yield* db.all(sql`SELECT * FROM agent_schedule_occurrence`),
      ).toEqual(before.occurrences);
      expect(
        yield* db.all(sql`SELECT id, dataset_id FROM chart_series`),
      ).toEqual([{ id: "csr_a", dataset_id: null }]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

      // New shapes: a collection target, an Occurrence without a Run and a dataset binding.
      yield* db.run(sql`
        INSERT INTO agent_schedule
          (id, name, enabled, target_json, recurrence, next_fire_at)
        VALUES ('ags_collect', 'Collect CPI', 1,
          '{"kind":"data_collection","datasetId":"wsd_cpi"}',
          ${JSON.stringify(recurrence)}, 400)
      `);
      yield* db.run(sql`
        INSERT INTO agent_schedule_occurrence (id, schedule_id, agent_run_id, fire_at)
        VALUES ('aso_collect', 'ags_collect', NULL, 150)
      `);
      yield* db.run(sql`
        INSERT INTO chart_series
          (id, cell_id, pane_id, position, dataset_id, output)
        VALUES ('csr_cpi', 'ccl_a', 'cpn_a', 1, 'wsd_cpi', 'cpi')
      `);
      const invalid = yield* Effect.exit(
        db.run(sql`
          INSERT INTO agent_schedule
            (id, name, enabled, target_json, recurrence, next_fire_at)
          VALUES ('ags_bad', 'Bad', 1, '{"kind":"data_collection"}',
            ${JSON.stringify(recurrence)}, 400)
        `),
      );
      expect(Exit.isFailure(invalid)).toBe(true);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
