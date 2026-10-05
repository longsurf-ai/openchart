// Purpose: Applies the 20260917065127_chart-provider-listings forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '@openchart/server/db/migration';

const migration: DatabaseMigration.Migration = {
  id: '20260917065127_chart-provider-listings',
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
      // Development-only integer IDs cannot recover provider, symbol, or currency.
      // Remove their complete cells so no main-series references are left dangling;
      // dashboards and grid roots remain available as empty grids.
      yield* tx.run(
        'DELETE FROM chart_cell WHERE id IN (SELECT cell_id FROM chart_market_source);',
      );
      yield* tx.run(
        "ALTER TABLE `chart_cell` ADD `adjustment` text DEFAULT 'raw' NOT NULL;",
      );
      yield* tx.run(
        'ALTER TABLE `chart_market_source` ADD `provider` text NOT NULL;',
      );
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
          CONSTRAINT "chart_cell_session_check" CHECK("session" in ('regular', 'extended')),
          CONSTRAINT "chart_cell_adjustment_check" CHECK("adjustment" in ('raw', 'split', 'split_dividend'))
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_chart_cell`(`id`, `chart_id`, `position`, `resolution`, `session`) SELECT `id`, `chart_id`, `position`, `resolution`, `session` FROM `chart_cell`;',
      );
      yield* tx.run('DROP TABLE `chart_cell`;');
      yield* tx.run('ALTER TABLE `__new_chart_cell` RENAME TO `chart_cell`;');
      yield* tx.run('PRAGMA foreign_keys=ON;');
      yield* tx.run('PRAGMA foreign_keys=OFF;');
      yield* tx.run(`
        CREATE TABLE \`__new_chart_market_source\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          CONSTRAINT \`fk_chart_market_source_cell_id_chart_cell_id_fk\` FOREIGN KEY (\`cell_id\`) REFERENCES \`chart_cell\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_market_source_position_unique\` UNIQUE(\`cell_id\`,\`position\`),
          CONSTRAINT \`chart_market_source_cell_id_unique\` UNIQUE(\`cell_id\`,\`id\`),
          CONSTRAINT "chart_market_source_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_market_source_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_market_source_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "chart_market_source_listing_check" CHECK(COALESCE(
                json_type("listing") = 'object'
                AND json_type("listing", '$.symbol') = 'text'
                AND json_type("listing", '$.currency') = 'text',
                0
              ))
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_chart_market_source`(`id`, `cell_id`, `position`, `listing`) SELECT `id`, `cell_id`, `position`, `listing` FROM `chart_market_source`;',
      );
      yield* tx.run('DROP TABLE `chart_market_source`;');
      yield* tx.run(
        'ALTER TABLE `__new_chart_market_source` RENAME TO `chart_market_source`;',
      );
      yield* tx.run('PRAGMA foreign_keys=ON;');
      yield* tx.run('PRAGMA foreign_keys=OFF;');
      yield* tx.run(`
        CREATE TABLE \`__new_chart_link\` (
          \`id\` text PRIMARY KEY,
          \`chart_id\` text NOT NULL,
          \`from_cell_id\` text NOT NULL,
          \`to_cell_id\` text NOT NULL,
          \`sync_listing\` integer DEFAULT false NOT NULL,
          \`sync_crosshair\` integer DEFAULT false NOT NULL,
          CONSTRAINT \`fk_chart_link_chart_id_chart_id_fk\` FOREIGN KEY (\`chart_id\`) REFERENCES \`chart\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_link_from_cell_fk\` FOREIGN KEY (\`chart_id\`,\`from_cell_id\`) REFERENCES \`chart_cell\`(\`chart_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_link_to_cell_fk\` FOREIGN KEY (\`chart_id\`,\`to_cell_id\`) REFERENCES \`chart_cell\`(\`chart_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_link_endpoints_unique\` UNIQUE(\`chart_id\`,\`from_cell_id\`,\`to_cell_id\`),
          CONSTRAINT "chart_link_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_link_distinct_cells_check" CHECK("from_cell_id" <> "to_cell_id"),
          CONSTRAINT "chart_link_sync_listing_check" CHECK("sync_listing" IN (0, 1)),
          CONSTRAINT "chart_link_sync_crosshair_check" CHECK("sync_crosshair" IN (0, 1))
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_chart_link`(`id`, `chart_id`, `from_cell_id`, `to_cell_id`, `sync_listing`, `sync_crosshair`) SELECT `id`, `chart_id`, `from_cell_id`, `to_cell_id`, `sync_listing`, `sync_crosshair` FROM `chart_link`;',
      );
      yield* tx.run('DROP TABLE `chart_link`;');
      yield* tx.run('ALTER TABLE `__new_chart_link` RENAME TO `chart_link`;');
      yield* tx.run('PRAGMA foreign_keys=ON;');
      yield* tx.run(
        'CREATE INDEX `chart_link_target_index` ON `chart_link` (`chart_id`,`to_cell_id`);',
      );
    });
  },
};

export default migration;
