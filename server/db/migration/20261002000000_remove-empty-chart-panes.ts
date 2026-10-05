// Purpose: Remove saved panes with no display bindings before nonempty pane validation applies.
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20261002000000_remove-empty-chart-panes",
  /**
   * Removes only unbound panes in the runner-owned transaction. Surviving pane
   * identities and positions, series, and sources stay intact. Each affected
   * chart's revision advances once so stale index-based edits are rejected;
   * its historical timestamps stay unchanged.
   * Renderer data availability never participates in this structural cleanup.
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`
        UPDATE chart SET revision = revision + 1
        WHERE id IN (
          SELECT chart_cell.chart_id
          FROM chart_cell JOIN chart_pane ON chart_pane.cell_id = chart_cell.id
          WHERE NOT EXISTS (
            SELECT 1 FROM chart_series WHERE chart_series.pane_id = chart_pane.id
          )
        )
      `);
      yield* tx.run(sql`
        DELETE FROM chart_pane
        WHERE NOT EXISTS (
          SELECT 1 FROM chart_series WHERE chart_series.pane_id = chart_pane.id
        )
      `);
    });
  },
};
export default migration;
