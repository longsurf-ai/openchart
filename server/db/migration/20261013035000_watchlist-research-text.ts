// Purpose: Removes the obsolete result type from saved research columns.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261013035000_watchlist-research-text",
  /**
   * Removes only semantic resultType fields, preserving column order and prompts.
   * Runs in the caller's transaction; SQL failures propagate to the migration runner.
   * Owns no resources or cleanup.
   * @example yield* migration.up(transaction);
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE watchlist
        SET columns = (
          SELECT json_group_array(json(
            CASE WHEN json_extract(value, '$.metric.kind') = 'semantic'
              THEN json_remove(value, '$.metric.resultType')
              ELSE value
            END
          ) ORDER BY key)
          FROM json_each(watchlist.columns)
        ), revision = revision + 1
        WHERE EXISTS (
          SELECT 1 FROM json_each(watchlist.columns)
          WHERE json_extract(value, '$.metric.kind') = 'semantic'
            AND json_type(value, '$.metric.resultType') IS NOT NULL
        )
      `);
    });
  },
};

export default migration;
