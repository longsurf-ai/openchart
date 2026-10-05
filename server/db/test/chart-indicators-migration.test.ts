// Purpose: Upgrade placeholders without losing market series or user chart roots.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, it } from "vitest";
it("removes only unconvertible indicator bindings and installs strict source columns", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_chart-indicators"),
      );
      expect(index).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        "INSERT INTO dashboard (id,name) VALUES ('dsh_test','Charts')",
      );
      yield* db.run(
        "INSERT INTO chart (id,dashboard_id) VALUES ('cht_test','dsh_test')",
      );
      yield* db.run(
        "INSERT INTO chart_cell (id,chart_id,position) VALUES ('ccl_a','cht_test',0)",
      );
      yield* db.run(
        "INSERT INTO chart_pane (id,cell_id,position) VALUES ('cpn_a','ccl_a',0)",
      );
      yield* db.run(
        `INSERT INTO chart_market_source (id,cell_id,position,provider,listing) VALUES ('cms_a','ccl_a',0,'binance','{"symbol":"BTCUSDT","currency":"USDT","class":"crypto"}')`,
      );
      yield* db.run(
        "INSERT INTO chart_indicator (id,cell_id,position) VALUES ('cin_a','ccl_a',0)",
      );
      yield* db.run(
        "INSERT INTO chart_series (id,cell_id,pane_id,position,role,market_source_id) VALUES ('csr_main','ccl_a','cpn_a',0,'main','cms_a')",
      );
      yield* db.run(
        "INSERT INTO chart_series (id,cell_id,pane_id,position,role,indicator_id,output) VALUES ('csr_indicator','ccl_a','cpn_a',1,'normal','cin_a','value')",
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(yield* db.all("SELECT id FROM chart_series")).toEqual([
        { id: "csr_main" },
      ]);
      expect(yield* db.all("SELECT id FROM chart_indicator")).toEqual([]);
      expect(yield* db.all("SELECT id FROM chart_pane")).toEqual([
        { id: "cpn_a" },
      ]);
      yield* db.run(
        `INSERT INTO chart_indicator (id,cell_id,position,workspace_id,script_path,parameter_overrides) VALUES ('cin_new','ccl_a',0,'wsp_missing','sma.tea','{}')`,
      );
      expect(
        yield* db.all("SELECT parameter_overrides FROM chart_indicator"),
      ).toEqual([{ parameter_overrides: "{}" }]);
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
