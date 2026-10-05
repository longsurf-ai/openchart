// Purpose: Rebuilding chart_series to admit volume profiles and their settings keeps every saved binding and its constraints.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("admits market volume profile bindings with settings and keeps every saved binding and rule", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const at = migrations.findIndex(({ id }) =>
        id.endsWith("_market-volume-profile"),
      );
      expect(at).toBeGreaterThan(0);
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Charts')",
      );
      yield* db.run(
        "INSERT INTO chart (id, dashboard_id, revision, created_at, updated_at) VALUES ('cht_saved', 'dsh_saved', 4, 10, 20)",
      );
      yield* db.run(
        "INSERT INTO chart_cell (id, chart_id, position) VALUES ('ccl_saved', 'cht_saved', 0)",
      );
      yield* db.run(
        `INSERT INTO chart_market_source (id, cell_id, position, provider, listing) VALUES ('cms_saved', 'ccl_saved', 0, 'yfinance', '{"symbol":"AAPL","currency":"USD"}')`,
      );
      yield* db.run(
        "INSERT INTO chart_pane (id, cell_id, position) VALUES ('cpn_main', 'ccl_saved', 0), ('cpn_study', 'ccl_saved', 1)",
      );
      const profile =
        "INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, indicator_id, output) VALUES ('csr_profile', 'ccl_saved', 'cpn_main', 2, 'normal', 'cms_saved', NULL, 'volumeProfile')";
      // The predecessor rejects the new output.
      expect(yield* Effect.exit(db.run(profile))).toMatchObject({
        _tag: "Failure",
      });
      yield* db.run(`INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, indicator_id, output) VALUES
      ('csr_main', 'ccl_saved', 'cpn_main', 0, 'main', 'cms_saved', NULL, 'price'),
      ('csr_volume', 'ccl_saved', 'cpn_main', 1, 'normal', 'cms_saved', NULL, 'volume'),
      ('csr_study', 'ccl_saved', 'cpn_study', 0, 'normal', NULL, 'ind_saved', 'value')`);
      const before = yield* db.all("SELECT * FROM chart_series ORDER BY id");

      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      // Saved bindings keep every value and have no settings. A new statement
      // text, since the client caches the expansion of `*`.
      expect(
        yield* db.all("SELECT * FROM chart_series ORDER BY id, position"),
      ).toEqual(
        before.map((row) => ({
          ...(row as object),
          profile_resolution: null,
          profile_rows: null,
        })),
      );
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      yield* db.run(profile);
      // Only a volume profile binding takes settings, within their bounds.
      yield* db.run(
        "UPDATE chart_series SET profile_resolution = '1h', profile_rows = 100 WHERE id = 'csr_profile'",
      );
      for (const invalid of [
        "UPDATE chart_series SET profile_rows = 24 WHERE id = 'csr_volume'",
        "UPDATE chart_series SET profile_rows = 101 WHERE id = 'csr_profile'",
        "UPDATE chart_series SET profile_resolution = '2h' WHERE id = 'csr_profile'",
      ])
        expect(yield* Effect.exit(db.run(invalid))).toMatchObject({
          _tag: "Failure",
        });
      // The other source rules survive the rebuild.
      for (const invalid of [
        "INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, indicator_id, output) VALUES ('csr_bad', 'ccl_saved', 'cpn_main', 3, 'normal', 'cms_saved', NULL, 'depth')",
        "INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, indicator_id, output) VALUES ('csr_bad', 'ccl_saved', 'cpn_study', 1, 'main', 'cms_saved', NULL, 'volumeProfile')",
        "INSERT INTO chart_series (id, cell_id, pane_id, position, role, market_source_id, indicator_id, output) VALUES ('csr_bad', 'ccl_saved', 'cpn_main', 3, 'normal', 'cms_missing', NULL, 'volumeProfile')",
      ])
        expect(yield* Effect.exit(db.run(invalid))).toMatchObject({
          _tag: "Failure",
        });
      expect(
        yield* db.all(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chart_series' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ),
      ).toEqual([
        { name: "chart_series_indicator_index" },
        { name: "chart_series_main_unique" },
        { name: "chart_series_market_source_index" },
      ]);
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
