// Purpose: Preserve charts and alert history while replacing retired session selectors.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("converts retired coverage, preserves children, and disables changed alerts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys=ON");
      const at = migrations.findIndex((m) =>
        m.id.endsWith("_three-bar-sessions"),
      );
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard(id,name) VALUES('dsh_test','Charts')",
      );
      yield* db.run(
        "INSERT INTO chart(id,dashboard_id) VALUES('cht_test','dsh_test')",
      );
      const old = [
        "provider",
        "pre",
        "post",
        "overnight",
        "regular",
        "extended",
        "24h",
        "provider",
      ];
      for (const [i, session] of old.entries()) {
        yield* db.run(
          `INSERT INTO chart_cell(id,chart_id,position,session) VALUES('ccl_${i}','cht_test',${i},'${session}')`,
        );
      }
      yield* db.run(
        `INSERT INTO chart_market_source(id,cell_id,position,provider,listing) VALUES('cms_a','ccl_7',0,'openchart','{"id":42,"symbol":"BTCUSD","currency":"USD","class":"crypto"}')`,
      );
      yield* db.run(
        "INSERT INTO chart_pane(id,cell_id,position) VALUES('cpn_a','ccl_7',0)",
      );
      yield* db.run(
        "INSERT INTO chart_series(id,cell_id,pane_id,position,role,market_source_id,output) VALUES('csr_a','ccl_7','cpn_a',0,'main','cms_a','price')",
      );
      yield* db.run(
        "INSERT INTO chart_link(id,chart_id,from_cell_id,to_cell_id) VALUES('clk_a','cht_test','ccl_0','ccl_7')",
      );
      yield* db.run(
        `INSERT INTO alert_rule(id,name,alertable_json) VALUES('alr_a','Pre','{"kind":"drawing","drawingId":"drw_a","operator":"crossing","inputs":{"provider":"openchart","listing":{"symbol":"SPY","currency":"USD"},"resolution":"1m","session":"pre","adjustment":"raw"}}')`,
      );
      yield* db.run(
        "INSERT INTO alert_event(id,rule_id,condition,time,detail_json) VALUES('ale_a','alr_a','hit',1,'{}')",
      );
      const children = [
        "chart_market_source",
        "chart_pane",
        "chart_series",
        "chart_link",
        "alert_event",
      ];
      const before = yield* Effect.forEach(children, (table) =>
        db.all(`SELECT * FROM ${table}`),
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      expect(
        yield* db.all("SELECT session FROM chart_cell ORDER BY position"),
      ).toEqual(
        [
          "regular",
          "extended",
          "extended",
          "24h",
          "regular",
          "extended",
          "24h",
          "24h",
        ].map((session) => ({ session })),
      );
      expect(
        yield* Effect.forEach(children, (table) =>
          db.all(`SELECT * FROM ${table}`),
        ),
      ).toEqual(before);
      expect(
        yield* db.all(
          "SELECT enabled,revision,json_extract(alertable_json,'$.inputs.session') AS session FROM alert_rule",
        ),
      ).toEqual([{ enabled: 0, revision: 2, session: "extended" }]);
      expect(
        yield* db
          .run("UPDATE chart_cell SET session='provider'")
          .pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" });
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
