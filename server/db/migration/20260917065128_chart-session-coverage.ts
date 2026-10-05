// Purpose: Applies the 20260917065128_chart-session-coverage forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '@openchart/server/db/migration';

const migration: DatabaseMigration.Migration = {
  id: '20260917065128_chart-session-coverage',
  /**
   * Applies this migration inside the runner-owned transaction.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      // SQLite cannot change foreign_keys inside the runner's transaction.
      // Retain children before rebuilding their parent; DROP TABLE cascades.
      const children = [
        'chart_market_source',
        'chart_indicator',
        'chart_pane',
        'chart_series',
        'chart_link',
      ];
      for (const table of children) {
        yield* tx.run(
          `CREATE TEMP TABLE "migration_session_${table}" AS SELECT * FROM "${table}";`,
        );
      }
      yield* tx.run('PRAGMA foreign_keys=OFF;');
      yield* tx.run(`
        CREATE TABLE \`__new_chart_cell\` (
          \`id\` text PRIMARY KEY,
          \`chart_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`resolution\` text DEFAULT '1d' NOT NULL,
          \`session\` text DEFAULT 'extended' NOT NULL,
          \`adjustment\` text DEFAULT 'raw' NOT NULL,
          CONSTRAINT \`fk_chart_cell_chart_id_chart_id_fk\` FOREIGN KEY (\`chart_id\`) REFERENCES \`chart\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_cell_position_unique\` UNIQUE(\`chart_id\`,\`position\`),
          CONSTRAINT \`chart_cell_chart_id_unique\` UNIQUE(\`chart_id\`,\`id\`),
          CONSTRAINT "chart_cell_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_cell_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_cell_resolution_check" CHECK("resolution" in ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')),
          CONSTRAINT "chart_cell_session_check" CHECK("session" in ('regular', 'pre', 'post', 'extended', 'overnight', '24h')),
          CONSTRAINT "chart_cell_adjustment_check" CHECK("adjustment" in ('raw', 'split', 'split_dividend'))
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_chart_cell`(`id`, `chart_id`, `position`, `resolution`, `session`, `adjustment`) SELECT `id`, `chart_id`, `position`, `resolution`, `session`, `adjustment` FROM `chart_cell`;',
      );
      yield* tx.run('DROP TABLE `chart_cell`;');
      yield* tx.run('ALTER TABLE `__new_chart_cell` RENAME TO `chart_cell`;');
      for (const table of children) {
        yield* tx.run(
          `INSERT INTO "${table}" SELECT * FROM "migration_session_${table}";`,
        );
        yield* tx.run(`DROP TABLE "migration_session_${table}";`);
      }
      yield* tx.run('PRAGMA foreign_keys=ON;');
    });
  },
};

export default migration;
