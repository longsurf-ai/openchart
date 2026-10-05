// Purpose: Applies the 20260921025826_chart-indicators forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260921025826_chart-indicators",
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
      // Identity-only placeholders cannot identify an executable file.
      yield* tx.run("DELETE FROM chart_series WHERE indicator_id IS NOT NULL");
      yield* tx.run("DELETE FROM chart_indicator");
      yield* tx.run(
        "ALTER TABLE `chart_indicator` ADD `workspace_id` text NOT NULL;",
      );
      yield* tx.run(
        "ALTER TABLE `chart_indicator` ADD `script_path` text NOT NULL;",
      );
      yield* tx.run(
        "ALTER TABLE `chart_indicator` ADD `parameter_overrides` text NOT NULL;",
      );
      yield* tx.run("PRAGMA foreign_keys=OFF;");
      yield* tx.run(`
        CREATE TABLE \`__new_chart_indicator\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`script_path\` text NOT NULL,
          \`parameter_overrides\` text NOT NULL,
          CONSTRAINT \`fk_chart_indicator_cell_id_chart_cell_id_fk\` FOREIGN KEY (\`cell_id\`) REFERENCES \`chart_cell\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_indicator_position_unique\` UNIQUE(\`cell_id\`,\`position\`),
          CONSTRAINT \`chart_indicator_cell_id_unique\` UNIQUE(\`cell_id\`,\`id\`),
          CONSTRAINT "chart_indicator_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_indicator_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_indicator_workspace_check" CHECK(length("workspace_id") > 0),
          CONSTRAINT "chart_indicator_path_check" CHECK(length("script_path") > 0 AND substr("script_path", -4) = '.tea'),
          CONSTRAINT "chart_indicator_overrides_check" CHECK(json_valid("parameter_overrides") AND json_type("parameter_overrides") = 'object')
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_chart_indicator`(`id`, `cell_id`, `position`) SELECT `id`, `cell_id`, `position` FROM `chart_indicator`;",
      );
      yield* tx.run("DROP TABLE `chart_indicator`;");
      yield* tx.run(
        "ALTER TABLE `__new_chart_indicator` RENAME TO `chart_indicator`;",
      );
      yield* tx.run("PRAGMA foreign_keys=ON;");
    });
  },
};

export default migration;
