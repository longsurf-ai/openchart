// Purpose: Move chart indicators to the Indicator Resource without touching the rest of the chart.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, it } from "vitest";
it("drops chart indicators and their bindings, keeps the chart, and installs the chart-owned indicator table", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_indicator-resource"),
      );
      expect(index).toBeGreaterThan(0);
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        "INSERT INTO dashboard (id,name) VALUES ('dsh_test','Charts')",
      );
      yield* db.run(
        "INSERT INTO chart (id,dashboard_id) VALUES ('cht_test','dsh_test')",
      );
      yield* db.run(
        "INSERT INTO chart_cell (id,chart_id,position) VALUES ('ccl_a','cht_test',0), ('ccl_b','cht_test',1)",
      );
      yield* db.run(
        "INSERT INTO chart_pane (id,cell_id,position) VALUES ('cpn_a','ccl_a',0)",
      );
      yield* db.run(
        `INSERT INTO chart_market_source (id,cell_id,position,provider,listing) VALUES ('cms_a','ccl_a',0,'binance','{"symbol":"BTCUSDT","currency":"USDT","class":"crypto"}')`,
      );
      yield* db.run(
        `INSERT INTO chart_indicator (id,cell_id,position,workspace_id,script_path,parameter_overrides) VALUES ('cin_a','ccl_a',0,'wsp_a','sma.tea','{}')`,
      );
      yield* db.run(
        "INSERT INTO chart_series (id,cell_id,pane_id,position,role,market_source_id,output) VALUES ('csr_main','ccl_a','cpn_a',0,'main','cms_a','price'), ('csr_volume','ccl_a','cpn_a',1,'normal','cms_a','volume')",
      );
      yield* db.run(
        "INSERT INTO chart_series (id,cell_id,pane_id,position,role,indicator_id,output) VALUES ('csr_indicator','ccl_a','cpn_a',2,'normal','cin_a','value')",
      );
      yield* db.run(
        "INSERT INTO chart_link (id,chart_id,from_cell_id,to_cell_id) VALUES ('clk_ab','cht_test','ccl_a','ccl_b')",
      );
      const tables = [
        "dashboard",
        "chart",
        "chart_cell",
        "chart_pane",
        "chart_market_source",
        "chart_link",
      ];
      const chartRows = () =>
        Effect.forEach(tables, (table) =>
          db.all(`SELECT * FROM ${table} ORDER BY id`),
        );
      const before = yield* chartRows();
      const series = yield* db.all(
        "SELECT * FROM chart_series WHERE indicator_id IS NULL ORDER BY id",
      );

      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(yield* chartRows()).toEqual(before);
      expect(yield* db.all("SELECT * FROM chart_series ORDER BY id")).toEqual(
        series,
      );
      expect(
        yield* db.all(
          "SELECT name FROM sqlite_master WHERE name = 'chart_indicator'",
        ),
      ).toEqual([]);
      expect(
        yield* db.all("PRAGMA foreign_key_list(chart_series)"),
      ).not.toContainEqual(expect.objectContaining({ from: "indicator_id" }));
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);

      const insert = (path: string, snapshot: string, overrides: string) =>
        db.run(
          `INSERT INTO indicator (id,chart_id,cell_id,workspace_id,script_path,snapshot,parameter_overrides) VALUES ('ind_a','cht_test','ccl_a','wsp_a','${path}','${snapshot}','${overrides}')`,
        );
      for (const [path, snapshot, overrides] of [
        ["sma.js", '{"sma.js":"plot(close)"}', "{}"],
        ["sma.tea", "[]", "{}"],
        ["sma.tea", '{"sma.tea":"plot(close)"}', "not json"],
      ] as const)
        expect(
          yield* Effect.exit(insert(path, snapshot, overrides)),
        ).toMatchObject({ _tag: "Failure" });
      yield* insert("sma.tea", '{"sma.tea":"plot(close)"}', '{"length":14}');
      yield* db.run(
        "INSERT INTO chart_series (id,cell_id,pane_id,position,role,indicator_id,output) VALUES ('csr_new','ccl_a','cpn_a',2,'normal','ind_a','value')",
      );
      expect(
        yield* db.all(
          "SELECT indicator_id, output FROM chart_series WHERE id = 'csr_new'",
        ),
      ).toEqual([{ indicator_id: "ind_a", output: "value" }]);
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);

      yield* db.run("DELETE FROM chart WHERE id = 'cht_test'");
      expect(yield* db.all("SELECT id FROM indicator")).toEqual([]);
      expect(yield* db.all("SELECT id FROM chart_series")).toEqual([]);
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
