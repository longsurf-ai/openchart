// Purpose: Verifies replacing development-only numeric listings preserves grid owners and migrates once.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

test("retires numeric-listing cells, preserves dashboards and grids, and accepts provider listings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_chart-provider-listings"),
      );
      expect(index).toBeGreaterThan(0);
      expect(migrations[index - 1]?.id).toBe("20260917014159_workspace");
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        sql`INSERT INTO dashboard (id, name) VALUES ('dsh_old', 'Existing')`,
      );
      yield* db.run(sql`INSERT INTO chart (id, dashboard_id, preset)
        VALUES ('cht_old', 'dsh_old', '1x2'), ('cht_empty', 'dsh_old', '1')`);
      yield* db.run(sql`INSERT INTO chart_cell (id, chart_id, position)
        VALUES ('ccl_old', 'cht_old', 0), ('ccl_other', 'cht_old', 1)`);
      yield* db.run(sql`INSERT INTO chart_market_source (id, cell_id, position, listing)
        VALUES ('cms_old', 'ccl_old', 0, 101), ('cms_other', 'ccl_other', 0, 202)`);
      yield* db.run(sql`INSERT INTO chart_pane (id, cell_id, position)
        VALUES ('cpn_old', 'ccl_old', 0), ('cpn_other', 'ccl_other', 0)`);
      yield* db.run(sql`INSERT INTO chart_indicator (id, cell_id, position)
        VALUES ('cin_old', 'ccl_old', 0)`);
      yield* db.run(sql`INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id)
        VALUES ('csr_old', 'ccl_old', 'cpn_old', 0, 'main', 'cms_old'),
          ('csr_other', 'ccl_other', 'cpn_other', 0, 'main', 'cms_other')`);
      yield* db.run(sql`INSERT INTO chart_link (id, chart_id, from_cell_id, to_cell_id, sync_time_scale)
        VALUES ('clk_old', 'cht_old', 'ccl_old', 'ccl_other', 1)`);
      yield* db.run(
        sql`INSERT INTO workspace (id, root) VALUES ('wsp_existing', '/tmp/existing-workspace')`,
      );
      const workspaces = yield* db.all(sql`SELECT * FROM workspace`);
      const dashboards = (yield* db.all<{
        revision: number;
        [key: string]: unknown;
      }>(sql`SELECT * FROM dashboard`)).map((row) => ({
        ...row,
        revision: row.revision + 1,
        updated_at: expect.any(Number),
      }));
      const grids = yield* db.all(sql`SELECT * FROM chart`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );

      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM chart`)).toEqual(grids);
      expect(yield* db.all(sql`SELECT * FROM workspace`)).toEqual(workspaces);
      for (const table of [
        "chart_cell",
        "chart_pane",
        "chart_series",
        "chart_market_source",
        "indicator",
        "chart_link",
      ]) {
        expect(
          yield* db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
        ).toEqual([]);
      }
      const migrated = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(migrated.slice(0, ledger.length)).toEqual(ledger);
      expect(migrated).toHaveLength(migrations.length);
      expect(
        yield* db.all<{ name: string }>(sql`PRAGMA table_info(chart_link)`),
      ).not.toContainEqual(
        expect.objectContaining({ name: "sync_time_scale" }),
      );

      yield* db.run(
        sql`INSERT INTO chart_cell (id, chart_id, position) VALUES ('ccl_new', 'cht_old', 0)`,
      );
      expect(yield* db.all(sql`SELECT adjustment FROM chart_cell`)).toEqual([
        { adjustment: "raw" },
      ]);
      yield* db.run(sql`INSERT INTO chart_market_source (id, cell_id, position, provider, listing)
        VALUES ('cms_new', 'ccl_new', 0, 'binance', '{"symbol":"BTCUSDT","currency":"USDT"}')`);
      const saved = yield* db.all(sql`SELECT * FROM chart_market_source`);
      for (const statement of [
        sql`UPDATE chart_cell SET adjustment = 'unknown'`,
        sql`UPDATE chart_market_source SET provider = ''`,
        sql`UPDATE chart_market_source SET listing = '101'`,
        sql`UPDATE chart_market_source SET listing = '{"symbol":"BTCUSDT"}'`,
      ]) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      }
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM chart_market_source`)).toEqual(
        saved,
      );
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrated);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  ));
