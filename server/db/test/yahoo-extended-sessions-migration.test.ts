// Purpose: Move only all-Yahoo US-equity regular cells to extended, bumping their charts.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

const aapl = '{"symbol":"AAPL","currency":"USD","class":"stock"}';
const spy = '{"symbol":"SPY","currency":"USD","class":"etf"}';
const vod = '{"symbol":"VOD.L","currency":"GBp","class":"stock"}';
const btc = '{"symbol":"BTCUSDT","currency":"USDT","class":"crypto"}';

test("switches regular cells whose every source is a Yahoo US equity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_yahoo-extended-sessions"),
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      const cells: readonly {
        id: string;
        session: string;
        adjustment: string;
        sources: readonly (readonly [string, string])[];
      }[] = [
        {
          id: "us",
          session: "regular",
          adjustment: "split",
          sources: [
            ["yfinance", aapl],
            ["yfinance", spy],
          ],
        },
        {
          id: "foreign",
          session: "regular",
          adjustment: "split",
          sources: [["yfinance", vod]],
        },
        {
          id: "mixed",
          session: "regular",
          adjustment: "split",
          sources: [
            ["yfinance", aapl],
            ["binance", btc],
          ],
        },
        {
          id: "tradingview",
          session: "regular",
          adjustment: "split",
          sources: [["tradingview", aapl]],
        },
        {
          id: "raw",
          session: "regular",
          adjustment: "raw",
          sources: [["yfinance", aapl]],
        },
      ];
      for (const [position, cell] of cells.entries()) {
        yield* db.run(
          sql`INSERT INTO dashboard (id,name) VALUES (${`dsh_${cell.id}`},'Charts')`,
        );
        yield* db.run(
          sql`INSERT INTO chart (id,dashboard_id) VALUES (${`cht_${cell.id}`},${`dsh_${cell.id}`})`,
        );
        yield* db.run(
          sql`INSERT INTO chart_cell (id,chart_id,position,resolution,session,adjustment) VALUES (${`ccl_${cell.id}`},${`cht_${cell.id}`},${position},'5m',${cell.session},${cell.adjustment})`,
        );
        for (const [at, [provider, listing]] of cell.sources.entries())
          yield* db.run(
            sql`INSERT INTO chart_market_source (id,cell_id,position,provider,listing) VALUES (${`cms_${cell.id}_${at}`},${`ccl_${cell.id}`},${at},${provider},${listing})`,
          );
      }
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(
        yield* db.all(sql`
          SELECT cell.id, cell.session, chart.revision FROM chart_cell cell
          JOIN chart ON chart.id = cell.chart_id ORDER BY cell.id
        `),
      ).toEqual([
        { id: "ccl_foreign", session: "regular", revision: 1 },
        { id: "ccl_mixed", session: "regular", revision: 1 },
        { id: "ccl_raw", session: "regular", revision: 1 },
        { id: "ccl_tradingview", session: "regular", revision: 1 },
        { id: "ccl_us", session: "extended", revision: 2 },
      ]);
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
