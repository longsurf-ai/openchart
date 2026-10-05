// Purpose: Remove historical empty panes while preserving every bound pane and other saved chart data.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("removes empty panes, preserves bound panes, and invalidates only affected chart revisions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const at = migrations.findIndex(({ id }) =>
        id.endsWith("_remove-empty-chart-panes"),
      );
      expect(at).toBeGreaterThan(0);
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Charts')",
      );
      yield* db.run(`INSERT INTO chart (id, dashboard_id, revision, created_at, updated_at) VALUES
      ('cht_saved', 'dsh_saved', 7, 10, 20),
      ('cht_other', 'dsh_saved', 3, 30, 40),
      ('cht_empty', 'dsh_saved', 1, 50, 60)`);
      yield* db.run(`INSERT INTO chart_cell (id, chart_id, position) VALUES
      ('ccl_saved', 'cht_saved', 0), ('ccl_other', 'cht_other', 0)`);
      yield* db.run(`INSERT INTO chart_market_source (id, cell_id, position, provider, listing) VALUES
      ('cms_saved', 'ccl_saved', 0, 'yfinance', '{"symbol":"AAPL","currency":"USD"}'),
      ('cms_other', 'ccl_other', 0, 'yfinance', '{"symbol":"MSFT","currency":"USD"}')`);
      yield* db.run(`INSERT INTO chart_pane (id, cell_id, position) VALUES
      ('cpn_before', 'ccl_saved', 0), ('cpn_main', 'ccl_saved', 1),
      ('cpn_between', 'ccl_saved', 2), ('cpn_study', 'ccl_saved', 3),
      ('cpn_after', 'ccl_saved', 4), ('cpn_other', 'ccl_other', 0)`);
      yield* db.run(`INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, indicator_id, output) VALUES
      ('csr_main', 'ccl_saved', 'cpn_main', 0, 'main', 'cms_saved', NULL, 'price'),
      ('csr_volume', 'ccl_saved', 'cpn_main', 1, 'normal', 'cms_saved', NULL, 'volume'),
      ('csr_study', 'ccl_saved', 'cpn_study', 0, 'normal', NULL, 'ind_unavailable', 'value'),
      ('csr_other', 'ccl_other', 'cpn_other', 0, 'main', 'cms_other', NULL, 'price')`);
      const tables = ["chart_cell", "chart_market_source", "chart_series"];
      const before = yield* Effect.forEach(tables, (table) =>
        db.all(sql.raw(`SELECT * FROM ${table} ORDER BY id`)),
      );

      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      expect(
        yield* db.all(
          "SELECT id, cell_id, position FROM chart_pane ORDER BY cell_id, position",
        ),
      ).toEqual([
        { id: "cpn_other", cell_id: "ccl_other", position: 0 },
        { id: "cpn_main", cell_id: "ccl_saved", position: 1 },
        { id: "cpn_study", cell_id: "ccl_saved", position: 3 },
      ]);
      expect(
        yield* Effect.forEach(tables, (table) =>
          db.all(sql.raw(`SELECT * FROM ${table} ORDER BY id`)),
        ),
      ).toEqual(before);
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(
        yield* db.all(
          "SELECT id, revision, created_at, updated_at FROM chart ORDER BY id",
        ),
      ).toEqual([
        { id: "cht_empty", revision: 1, created_at: 50, updated_at: 60 },
        { id: "cht_other", revision: 3, created_at: 30, updated_at: 40 },
        { id: "cht_saved", revision: 8, created_at: 10, updated_at: 20 },
      ]);

      // Reopening verifies the ledger and does not replay the data conversion.
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      expect(yield* db.all("SELECT COUNT(*) AS count FROM chart_pane")).toEqual(
        [{ count: 3 }],
      );
      expect(
        yield* db.all("SELECT revision FROM chart WHERE id = 'cht_saved'"),
      ).toEqual([{ revision: 8 }]);
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
