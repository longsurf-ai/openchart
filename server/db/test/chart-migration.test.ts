// Purpose: Proves chart migration preserves dashboard data and enforces graph ownership in SQLite.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("upgrades populated dashboards and enforces chart ownership and deletion", async () => {
  const upgradeIndex = migrations.findIndex(
    (migration) => migration.id === "20260905230717_chart-grid",
  );
  expect(upgradeIndex).toBeGreaterThan(0);

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.run(sql`
        INSERT INTO dashboard (id, revision, created_at, updated_at, name, favorite)
        VALUES ('dsh_old', 7, 100, 200, 'Historical', 1)
      `);
      yield* db.run(sql`
        INSERT INTO dashboard_widget (id, dashboard_id, position, kind)
        VALUES ('wdg_old', 'dsh_old', 0, 'feed')
      `);
      const dashboards = (yield* db.all<Record<string, unknown>>(
        sql`SELECT * FROM dashboard`,
      )).map((row) => ({
        ...row,
        revision: 8,
        updated_at: expect.any(Number),
      }));
      const widgets = (yield* db.all<Record<string, unknown>>(
        sql`SELECT * FROM dashboard_widget`,
      )).map((row) => ({ ...row, x: 0, y: 0, w: 12, h: 16 }));

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM dashboard_widget`)).toEqual(
        widgets,
      );
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));

      yield* db.run(sql`
        INSERT INTO chart (id, dashboard_id)
        VALUES ('chart_a', 'dsh_old'), ('chart_b', 'dsh_old')
      `);
      yield* db.run(sql`
        INSERT INTO chart_cell (id, chart_id, position) VALUES
        ('cell_a', 'chart_a', 0), ('cell_b', 'chart_a', 1), ('cell_c', 'chart_b', 0)
      `);
      yield* db.run(sql`
        INSERT INTO chart_pane (id, cell_id, position)
        VALUES ('pane_a', 'cell_a', 0), ('pane_b', 'cell_b', 0)
      `);
      yield* db.run(sql`
        INSERT INTO chart_market_source (id, cell_id, position, provider, listing)
        VALUES ('source_a', 'cell_a', 0, 'yfinance', '{"symbol":"AAPL","currency":"USD"}'),
               ('source_b', 'cell_b', 0, 'yfinance', '{"symbol":"MSFT","currency":"USD"}')
      `);
      yield* db.run(sql`
        INSERT INTO indicator (id, chart_id, cell_id, workspace_id, script_path, snapshot, parameter_overrides)
        VALUES ('indicator_a', 'chart_a', 'cell_a', 'wsp_test', 'test.tea', '{"test.tea":"plot(close)"}', '{}')
      `);
      yield* db.run(sql`
        INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, output)
        VALUES ('series_main', 'cell_a', 'pane_a', 0, 'main', 'source_a', 'price')
      `);
      yield* db.run(sql`
        INSERT INTO chart_series (id, cell_id, pane_id, position, indicator_id, output)
        VALUES ('series_indicator', 'cell_a', 'pane_a', 1, 'indicator_a', 'value')
      `);
      yield* db.run(sql`
        INSERT INTO chart_link (id, chart_id, from_cell_id, to_cell_id)
        VALUES ('link_ab', 'chart_a', 'cell_a', 'cell_b')
      `);

      const invalidWrites = [
        sql`UPDATE chart_series SET market_source_id = 'source_b' WHERE id = 'series_main'`,
        sql`UPDATE chart_series SET pane_id = 'pane_b' WHERE id = 'series_main'`,
        sql`UPDATE chart_series SET indicator_id = 'indicator_a', output = 'value' WHERE id = 'series_main'`,
        sql`UPDATE chart_series SET market_source_id = NULL, indicator_id = 'indicator_a', output = 'value' WHERE id = 'series_main'`,
        sql`UPDATE chart_series SET output = '' WHERE id = 'series_indicator'`,
        sql`INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id)
            VALUES ('second_main', 'cell_a', 'pane_a', 2, 'main', 'source_a')`,
        sql`UPDATE chart_link SET to_cell_id = 'cell_c' WHERE id = 'link_ab'`,
        sql`UPDATE chart_link SET to_cell_id = 'cell_a' WHERE id = 'link_ab'`,
        sql`INSERT INTO chart_link (id, chart_id, from_cell_id, to_cell_id)
            VALUES ('duplicate_link', 'chart_a', 'cell_a', 'cell_b')`,
        sql`DELETE FROM chart_market_source WHERE id = 'source_a'`,
      ];
      for (const statement of invalidWrites) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      }

      // Deleting the owner must remove its whole graph, including links to surviving cells.
      // Indicators belong to the chart, so they survive the cell reinserts of a chart save.
      yield* db.run(sql`DELETE FROM chart_cell WHERE id = 'cell_a'`);
      expect(yield* db.all(sql`SELECT * FROM chart_series`)).toEqual([]);
      expect(yield* db.all(sql`SELECT id FROM indicator`)).toEqual([
        { id: "indicator_a" },
      ]);
      expect(yield* db.all(sql`SELECT * FROM chart_link`)).toEqual([]);
      expect(yield* db.all(sql`SELECT id FROM chart_pane`)).toEqual([
        { id: "pane_b" },
      ]);
      expect(yield* db.all(sql`SELECT id FROM chart_market_source`)).toEqual([
        { id: "source_b" },
      ]);

      yield* db.run(sql`DELETE FROM chart WHERE id = 'chart_a'`);
      expect(yield* db.all(sql`SELECT id FROM chart_cell`)).toEqual([
        { id: "cell_c" },
      ]);
      expect(yield* db.all(sql`SELECT * FROM chart_pane`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM chart_market_source`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM indicator`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM dashboard_widget`)).toEqual(
        widgets,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
