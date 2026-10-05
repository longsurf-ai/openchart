// Purpose: Backfill market bindings as price and enforce the required series output.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, it } from "vitest";
it("backfills market bindings as price, keeps indicator outputs and restricts market outputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_market-series-output"),
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
        `INSERT INTO chart_indicator (id,cell_id,position,workspace_id,script_path,parameter_overrides) VALUES ('cin_a','ccl_a',0,'wsp_a','sma.tea','{}')`,
      );
      const insert = (
        id: string,
        position: number,
        role: string,
        source: string,
        output: string | null,
      ) =>
        db.run(
          `INSERT INTO chart_series (id,cell_id,pane_id,position,role,${source},output) VALUES ('${id}','ccl_a','cpn_a',${position},'${role}','${source === "market_source_id" ? "cms_a" : "cin_a"}',${output === null ? "NULL" : `'${output}'`})`,
        );
      yield* insert("csr_main", 0, "main", "market_source_id", null);
      yield* insert("csr_old_volume", 1, "normal", "market_source_id", null);
      yield* insert("csr_indicator", 2, "normal", "indicator_id", "value");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(
        yield* db.all("SELECT id, output FROM chart_series ORDER BY position"),
      ).toEqual([
        { id: "csr_main", output: "price" },
        { id: "csr_old_volume", output: "price" },
        { id: "csr_indicator", output: "value" },
      ]);
      yield* insert("csr_volume", 3, "normal", "market_source_id", "volume");
      for (const [role, source, output] of [
        ["normal", "market_source_id", null],
        ["normal", "market_source_id", "value"],
        ["normal", "indicator_id", ""],
      ] as const)
        expect(
          yield* Effect.exit(insert("csr_bad", 4, role, source, output)),
        ).toMatchObject({ _tag: "Failure" });
      // Only price can be main, even once the existing main binding is gone.
      yield* db.run("DELETE FROM chart_series WHERE id = 'csr_main'");
      expect(
        yield* Effect.exit(
          insert("csr_bad", 4, "main", "market_source_id", "volume"),
        ),
      ).toMatchObject({ _tag: "Failure" });
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
