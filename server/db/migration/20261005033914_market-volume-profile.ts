// Purpose: Applies the 20261005033914_market-volume-profile forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261005033914_market-volume-profile",
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
      yield* tx.run(
        "ALTER TABLE `chart_series` ADD `profile_resolution` text;",
      );
      yield* tx.run("ALTER TABLE `chart_series` ADD `profile_rows` integer;");
      yield* tx.run("PRAGMA foreign_keys=OFF;");
      yield* tx.run(`
        CREATE TABLE \`__new_chart_series\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`pane_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`role\` text DEFAULT 'normal' NOT NULL,
          \`market_source_id\` text,
          \`indicator_id\` text,
          \`output\` text NOT NULL,
          \`profile_resolution\` text,
          \`profile_rows\` integer,
          CONSTRAINT \`chart_series_pane_fk\` FOREIGN KEY (\`cell_id\`,\`pane_id\`) REFERENCES \`chart_pane\`(\`cell_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_series_market_source_fk\` FOREIGN KEY (\`cell_id\`,\`market_source_id\`) REFERENCES \`chart_market_source\`(\`cell_id\`,\`id\`),
          CONSTRAINT \`chart_series_position_unique\` UNIQUE(\`pane_id\`,\`position\`),
          CONSTRAINT "chart_series_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_series_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_series_role_check" CHECK("role" in ('main', 'normal')),
          CONSTRAINT "chart_series_profile_check" CHECK(("profile_resolution" IS NULL AND "profile_rows" IS NULL) OR (
                "market_source_id" IS NOT NULL AND "output" = 'volumeProfile'
                AND ("profile_resolution" IS NULL OR "profile_resolution" in ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M'))
                AND ("profile_rows" IS NULL OR "profile_rows" BETWEEN 1 AND 100)
              )),
          CONSTRAINT "chart_series_source_check" CHECK((
                "market_source_id" IS NOT NULL AND "indicator_id" IS NULL
                AND "output" in ('price', 'volume', 'volumeProfile')
              ) OR (
                "market_source_id" IS NULL AND "indicator_id" IS NOT NULL
                AND length("output") > 0
              )),
          CONSTRAINT "chart_series_main_market_check" CHECK("role" <> 'main' OR (
                "market_source_id" IS NOT NULL AND "output" = 'price'
              ))
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_chart_series`(`id`, `cell_id`, `pane_id`, `position`, `role`, `market_source_id`, `indicator_id`, `output`) SELECT `id`, `cell_id`, `pane_id`, `position`, `role`, `market_source_id`, `indicator_id`, `output` FROM `chart_series`;",
      );
      yield* tx.run("DROP TABLE `chart_series`;");
      yield* tx.run(
        "ALTER TABLE `__new_chart_series` RENAME TO `chart_series`;",
      );
      yield* tx.run("PRAGMA foreign_keys=ON;");
      yield* tx.run(
        'CREATE UNIQUE INDEX `chart_series_main_unique` ON `chart_series` (`cell_id`) WHERE "chart_series"."role" = \'main\';',
      );
      yield* tx.run(
        "CREATE INDEX `chart_series_market_source_index` ON `chart_series` (`cell_id`,`market_source_id`);",
      );
      yield* tx.run(
        "CREATE INDEX `chart_series_indicator_index` ON `chart_series` (`cell_id`,`indicator_id`);",
      );
    });
  },
};

export default migration;
