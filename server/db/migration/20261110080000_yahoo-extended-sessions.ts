// Purpose: Move Yahoo US-equity chart cells to the extended session Yahoo now offers first.
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

/**
 * A frozen copy of Yahoo's extended-hours rule at this migration: USD stocks
 * and ETFs whose symbols carry no exchange suffix.
 */
const usEquity = (source: string) => `
  ${source}.provider = 'yfinance'
  AND json_extract(${source}.listing, '$.class') IN ('stock', 'etf')
  AND json_extract(${source}.listing, '$.currency') = 'USD'
  AND instr(json_extract(${source}.listing, '$.symbol'), '.') = 0`;

/** Regular split-adjusted cells whose every market source is a Yahoo US equity. */
const eligible = `
  cell.session = 'regular'
  AND cell.adjustment = 'split'
  AND EXISTS (SELECT 1 FROM chart_market_source source WHERE source.cell_id = cell.id)
  AND NOT EXISTS (
    SELECT 1 FROM chart_market_source source
    WHERE source.cell_id = cell.id AND NOT (${usEquity("source")})
  )`;

const migration: DatabaseMigration.Migration = {
  id: "20261110080000_yahoo-extended-sessions",
  /**
   * Inside the runner-owned transaction, switches eligible chart cells from
   * `regular` to `extended` and bumps their charts' revisions. Cells mixing in
   * any other source keep their session, because one cell session applies to
   * all of its sources. Alert rules keep the coverage they were reviewed with.
   *
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        sql.raw(`
          UPDATE chart
          SET revision = revision + 1,
            updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
          WHERE id IN (SELECT cell.chart_id FROM chart_cell cell WHERE ${eligible})
        `),
      );
      yield* tx.run(
        sql.raw(
          `UPDATE chart_cell AS cell SET session = 'extended' WHERE ${eligible}`,
        ),
      );
    });
  },
};

export default migration;
