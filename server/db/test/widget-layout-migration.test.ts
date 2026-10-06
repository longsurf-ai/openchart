// Purpose: Verifies populated Dashboard layout backfill, preservation, and atomic rollback.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

const index = migrations.findIndex(
  ({ id }) => id === "20260917065130_widget-layout",
);
if (index < 1)
  throw new Error("Widget layout migration requires a predecessor");
const predecessor = migrations.slice(0, index);
const throughLayout = migrations.slice(0, index + 1);

test("preserves existing placements and Chart graphs, appends missing Charts, and advances each affected Dashboard once", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, predecessor);
      yield* db.run(sql`
      INSERT INTO dashboard (id, name, revision, created_at, updated_at) VALUES
      ('dsh_research', 'Research', 7, 100, 200),
      ('dsh_charts', 'Charts only', 3, 101, 201),
      ('dsh_empty', 'Empty', 2, 102, 202)
    `);
      yield* db.run(sql`
      INSERT INTO chart (id, dashboard_id, revision, created_at, updated_at) VALUES
      ('cht_existing', 'dsh_research', 4, 100, 200),
      ('cht_missing', 'dsh_research', 5, 101, 201),
      ('cht_alone', 'dsh_charts', 6, 102, 202)
    `);
      yield* db.run(sql`
      INSERT INTO dashboard_widget (id, dashboard_id, position, kind, resource_id) VALUES
      ('wdg_unknown', 'dsh_research', 2, 'future-kind', 'file_reference'),
      ('wdg_existing', 'dsh_research', 8, 'chart', 'cht_existing')
    `);
      yield* db.run(
        sql`INSERT INTO chart_cell (id, chart_id, position) VALUES ('ccl_saved', 'cht_missing', 0)`,
      );
      yield* db.run(
        sql`INSERT INTO chart_pane (id, cell_id, position) VALUES ('cpn_saved', 'ccl_saved', 0)`,
      );
      yield* db.run(sql`
      INSERT INTO chart_market_source (id, cell_id, position, provider, listing)
      VALUES ('cms_saved', 'ccl_saved', 0, 'yfinance', '{"symbol":"AAPL","currency":"USD"}')
    `);
      yield* db.run(sql`
      INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id)
      VALUES ('csr_saved', 'ccl_saved', 'cpn_saved', 0, 'main', 'cms_saved')
    `);
      const data = JSON.stringify(
        Drawing.create("trend_line", [
          { time: 1, price: 100 },
          { time: 2, price: 110 },
        ]),
      );
      yield* db.run(sql`
      INSERT INTO drawing (id, dashboard_id, provider, listing, data)
      VALUES ('drw_saved', 'dsh_research', 'yfinance', '{"symbol":"AAPL","currency":"USD"}', ${data})
    `);
      const tables = [
        "chart",
        "chart_cell",
        "chart_pane",
        "chart_market_source",
        "chart_series",
        "drawing",
      ];
      const before = yield* Effect.forEach(tables, (table) =>
        db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
      );
      yield* DatabaseMigration.applyOnly(db, throughLayout);
      yield* DatabaseMigration.applyOnly(db, throughLayout);
      const after = yield* Effect.forEach(tables, (table) =>
        db.all(sql`SELECT * FROM ${sql.identifier(table)}`),
      );
      expect(after).toEqual(before);
      expect(
        yield* db.all(
          sql`SELECT id, revision, created_at, updated_at FROM dashboard ORDER BY id`,
        ),
      ).toEqual([
        {
          id: "dsh_charts",
          revision: 4,
          created_at: 101,
          updated_at: expect.any(Number),
        },
        { id: "dsh_empty", revision: 2, created_at: 102, updated_at: 202 },
        {
          id: "dsh_research",
          revision: 8,
          created_at: 100,
          updated_at: expect.any(Number),
        },
      ]);
      expect(
        yield* db.all(
          sql`SELECT * FROM dashboard_widget ORDER BY dashboard_id, position`,
        ),
      ).toEqual([
        {
          id: expect.stringMatching(/^wdg_/),
          dashboard_id: "dsh_charts",
          position: 0,
          kind: "chart",
          resource_id: "cht_alone",
          x: 0,
          y: 0,
          w: 12,
          h: 16,
        },
        {
          id: "wdg_unknown",
          dashboard_id: "dsh_research",
          position: 2,
          kind: "future-kind",
          resource_id: "file_reference",
          x: 0,
          y: 0,
          w: 12,
          h: 16,
        },
        {
          id: "wdg_existing",
          dashboard_id: "dsh_research",
          position: 8,
          kind: "chart",
          resource_id: "cht_existing",
          x: 0,
          y: 16,
          w: 12,
          h: 16,
        },
        {
          id: expect.stringMatching(/^wdg_/),
          dashboard_id: "dsh_research",
          position: 9,
          kind: "chart",
          resource_id: "cht_missing",
          x: 0,
          y: 32,
          w: 12,
          h: 16,
        },
      ]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      for (const statement of [
        sql`UPDATE dashboard_widget SET x = 0.5`,
        sql`UPDATE dashboard_widget SET y = -1`,
        sql`UPDATE dashboard_widget SET y = 0.5`,
        sql`UPDATE dashboard_widget SET w = 0`,
        sql`UPDATE dashboard_widget SET w = 1.5`,
        sql`UPDATE dashboard_widget SET h = 0`,
        sql`UPDATE dashboard_widget SET h = 1.5`,
        sql`UPDATE dashboard_widget SET x = 1, w = 12`,
      ])
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      const columns = yield* db.all<{
        name: string;
        notnull: number;
        dflt_value: unknown;
      }>(sql`PRAGMA table_info(dashboard_widget)`);
      expect(
        columns
          .filter(({ name }) => ["x", "y", "w", "h"].includes(name))
          .map(({ name, notnull, dflt_value }) => ({
            name,
            notnull,
            dflt_value,
          })),
      ).toEqual(
        ["x", "y", "w", "h"].map((name) => ({
          name,
          notnull: 1,
          dflt_value: null,
        })),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("a failure after backfill restores the old placement table and migration ledger", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, predecessor);
      yield* db.run(
        sql`INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Saved')`,
      );
      yield* db.run(
        sql`INSERT INTO chart (id, dashboard_id) VALUES ('cht_saved', 'dsh_saved')`,
      );
      yield* db.run(
        `CREATE TEMP TRIGGER fail_revision BEFORE UPDATE ON dashboard BEGIN SELECT RAISE(ABORT, 'injected revision failure'); END;`,
      );
      const schema = yield* db.all(
        sql`SELECT sql FROM sqlite_master WHERE name = 'dashboard_widget'`,
      );
      const dashboards = yield* db.all(sql`SELECT * FROM dashboard`);
      expect(
        Exit.isFailure(
          yield* Effect.exit(DatabaseMigration.applyOnly(db, throughLayout)),
        ),
      ).toBe(true);
      expect(
        yield* db.all(
          sql`SELECT sql FROM sqlite_master WHERE name = 'dashboard_widget'`,
        ),
      ).toEqual(schema);
      expect(yield* db.all(sql`SELECT * FROM dashboard_widget`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(predecessor.map(({ id }) => ({ id })));
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
