// Purpose: Widen Cloud sessions while preserving existing charts, alerts and cascade children.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("predecessor upgrade preserves chart children and alert events; accepts provider session only after upgrade", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys=ON");
      const at = migrations.findIndex((m) =>
        m.id.endsWith("_cloud-provider-session"),
      );
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard(id,name) VALUES('dsh_test','Charts')",
      );
      yield* db.run(
        "INSERT INTO chart(id,dashboard_id) VALUES('cht_test','dsh_test')",
      );
      yield* db.run(
        "INSERT INTO chart_cell(id,chart_id,position,session) VALUES('ccl_a','cht_test',0,'regular'),('ccl_b','cht_test',1,'24h')",
      );
      yield* db.run(
        "INSERT INTO chart_pane(id,cell_id,position) VALUES('cpn_a','ccl_a',0)",
      );
      yield* db.run(
        `INSERT INTO chart_market_source(id,cell_id,position,provider,listing) VALUES('cms_a','ccl_a',0,'yfinance','{"symbol":"SPY","currency":"USD"}')`,
      );
      yield* db.run(
        "INSERT INTO chart_series(id,cell_id,pane_id,position,role,market_source_id,output) VALUES('csr_a','ccl_a','cpn_a',0,'main','cms_a','price')",
      );
      yield* db.run(
        "INSERT INTO chart_link(id,chart_id,from_cell_id,to_cell_id) VALUES('clk_a','cht_test','ccl_a','ccl_b')",
      );
      yield* db.run(
        `INSERT INTO alert_rule(id,name,alertable_json) VALUES('alr_a','Old rule','{"kind":"drawing","drawingId":"drw_a","operator":"crossing","inputs":{"provider":"binance","listing":{"symbol":"BTCUSDT","currency":"USD"},"resolution":"1m","session":"24h","adjustment":"raw"}}')`,
      );
      yield* db.run(
        `INSERT INTO alert_event(id,rule_id,condition,time,detail_json) VALUES('ale_a','alr_a','hit',1,'{}')`,
      );
      const tables = [
        "chart_cell",
        "chart_market_source",
        "chart_pane",
        "chart_series",
        "chart_link",
        "alert_rule",
        "alert_event",
      ];
      const before = yield* Effect.forEach(tables, (table) =>
        db.all(`SELECT * FROM ${table} ORDER BY id`),
      );
      expect(
        yield* db
          .run("UPDATE chart_cell SET session='provider'")
          .pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" });
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      const after = yield* Effect.forEach(tables, (table) =>
        db.all(`SELECT * FROM ${table} ORDER BY id`),
      );
      expect(after).toEqual(before);
      yield* db.run(
        "UPDATE chart_cell SET session='provider' WHERE id='ccl_a'",
      );
      yield* db.run(
        "UPDATE alert_rule SET alertable_json=json_set(alertable_json,'$.inputs.session','provider') WHERE id='alr_a'",
      );
      expect(
        yield* db
          .run("UPDATE chart_cell SET session='unknown'")
          .pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" });
      expect(
        yield* db
          .run(
            "UPDATE alert_rule SET alertable_json=json_set(alertable_json,'$.inputs.session','unknown')",
          )
          .pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" });
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
