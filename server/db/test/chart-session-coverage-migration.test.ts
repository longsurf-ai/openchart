// Purpose: Widen session choices without losing a grid's source, pane, series, or links.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("preserves every chart child when adding continuous-market sessions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_chart-session-coverage"),
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        sql`INSERT INTO dashboard (id,name) VALUES ('dsh_test','Charts')`,
      );
      yield* db.run(
        sql`INSERT INTO chart (id,dashboard_id,preset) VALUES ('cht_test','dsh_test','1x2')`,
      );
      for (const suffix of ["a", "b"]) {
        const position = suffix === "a" ? 0 : 1;
        yield* db.run(
          sql`INSERT INTO chart_cell (id,chart_id,position) VALUES (${`ccl_${suffix}`},'cht_test',${position})`,
        );
        yield* db.run(
          sql`INSERT INTO chart_market_source (id,cell_id,position,provider,listing) VALUES (${`cms_${suffix}`},${`ccl_${suffix}`},0,'binance','{"symbol":"BTCUSDT","currency":"USDT","class":"crypto"}')`,
        );
        yield* db.run(
          sql`INSERT INTO chart_pane (id,cell_id,position) VALUES (${`cpn_${suffix}`},${`ccl_${suffix}`},0)`,
        );
        yield* db.run(
          sql`INSERT INTO chart_series (id,cell_id,pane_id,position,role,market_source_id) VALUES (${`csr_${suffix}`},${`ccl_${suffix}`},${`cpn_${suffix}`},0,'main',${`cms_${suffix}`})`,
        );
      }
      yield* db.run(
        sql`INSERT INTO chart_indicator (id,cell_id,position) VALUES ('cin_a','ccl_a',0)`,
      );
      yield* db.run(
        sql`INSERT INTO chart_link (id,chart_id,from_cell_id,to_cell_id,sync_crosshair) VALUES ('clk_a','cht_test','ccl_a','ccl_b',1)`,
      );
      const tables = [
        "chart",
        "chart_cell",
        "chart_market_source",
        "chart_pane",
        "chart_series",
        "chart_indicator",
        "chart_link",
      ];
      const before = yield* Effect.all(
        tables.map((table) =>
          db.all(sql`SELECT * FROM ${sql.identifier(table)} ORDER BY id`),
        ),
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      const after = yield* Effect.all(
        tables.map((table) =>
          db.all(sql`SELECT * FROM ${sql.identifier(table)} ORDER BY id`),
        ),
      );
      expect(after).toEqual(before);
      yield* db.run(
        sql`UPDATE chart_cell SET session = '24h' WHERE id = 'ccl_a'`,
      );
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
