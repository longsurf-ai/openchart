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
        revision: 7,
        updated_at: 200,
      }));
      const widgets = yield* db.all<Record<string, unknown>>(
        sql`SELECT * FROM dashboard_widget`,
      );

      yield* DatabaseMigration.applyOnly(
        db,
        migrations.slice(0, upgradeIndex + 1),
      );
      yield* DatabaseMigration.applyOnly(
        db,
        migrations.slice(0, upgradeIndex + 1),
      );
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM dashboard_widget`)).toEqual(
        widgets,
      );
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(
        migrations.slice(0, upgradeIndex + 1).map(({ id }) => ({ id })),
      );

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
        INSERT INTO chart_market_source (id, cell_id, position, listing)
        VALUES ('source_a', 'cell_a', 0, 101), ('source_b', 'cell_b', 0, 102)
      `);
      yield* db.run(sql`
        INSERT INTO chart_indicator (id, cell_id, position)
        VALUES ('indicator_a', 'cell_a', 0)
      `);
      yield* db.run(sql`
        INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id)
        VALUES ('series_main', 'cell_a', 'pane_a', 0, 'main', 'source_a')
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
      yield* db.run(sql`DELETE FROM chart_cell WHERE id = 'cell_a'`);
      expect(yield* db.all(sql`SELECT * FROM chart_series`)).toEqual([]);
      expect(yield* db.all(sql`SELECT id FROM chart_indicator`)).toEqual([]);
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
      expect(yield* db.all(sql`SELECT * FROM chart_indicator`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM dashboard_widget`)).toEqual(
        widgets,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
