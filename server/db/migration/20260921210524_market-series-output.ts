// Purpose: Applies the 20260921210524_market-series-output forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260921210524_market-series-output",
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
          CONSTRAINT \`chart_series_pane_fk\` FOREIGN KEY (\`cell_id\`,\`pane_id\`) REFERENCES \`chart_pane\`(\`cell_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_series_market_source_fk\` FOREIGN KEY (\`cell_id\`,\`market_source_id\`) REFERENCES \`chart_market_source\`(\`cell_id\`,\`id\`),
          CONSTRAINT \`chart_series_indicator_fk\` FOREIGN KEY (\`cell_id\`,\`indicator_id\`) REFERENCES \`chart_indicator\`(\`cell_id\`,\`id\`),
          CONSTRAINT \`chart_series_position_unique\` UNIQUE(\`pane_id\`,\`position\`),
          CONSTRAINT "chart_series_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_series_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_series_role_check" CHECK("role" in ('main', 'normal')),
          CONSTRAINT "chart_series_source_check" CHECK((
                "market_source_id" IS NOT NULL AND "indicator_id" IS NULL
                AND "output" in ('price', 'volume')
              ) OR (
                "market_source_id" IS NULL AND "indicator_id" IS NOT NULL
                AND length("output") > 0
              )),
          CONSTRAINT "chart_series_main_market_check" CHECK("role" <> 'main' OR (
                "market_source_id" IS NOT NULL AND "output" = 'price'
              ))
        );
      `);
      // Handwritten backfill: market bindings had no output and all drew price.
      // Which of them showed volume lived only in browser-local preferences.
      yield* tx.run(
        "INSERT INTO `__new_chart_series`(`id`, `cell_id`, `pane_id`, `position`, `role`, `market_source_id`, `indicator_id`, `output`) SELECT `id`, `cell_id`, `pane_id`, `position`, `role`, `market_source_id`, `indicator_id`, COALESCE(`output`, 'price') FROM `chart_series`;",
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
