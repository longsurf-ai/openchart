// Purpose: Applies the 20260927213244_indicator-resource forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260927213244_indicator-resource",
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
      // An Indicator is defined by a snapshot of its Workspace files, which a
      // SQL migration cannot read. Chart indicators and their bindings are
      // dropped; users re-add them (precedent: 20260921025826_chart-indicators).
      yield* tx.run("DELETE FROM chart_series WHERE indicator_id IS NOT NULL");
      yield* tx.run(`
        CREATE TABLE \`indicator\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`chart_id\` text NOT NULL,
          \`cell_id\` text NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`script_path\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`parameter_overrides\` text NOT NULL,
          CONSTRAINT \`fk_indicator_chart_id_chart_id_fk\` FOREIGN KEY (\`chart_id\`) REFERENCES \`chart\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "indicator_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "indicator_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "indicator_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "indicator_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "indicator_cell_check" CHECK(length("cell_id") > 0),
          CONSTRAINT "indicator_workspace_check" CHECK(length("workspace_id") > 0),
          CONSTRAINT "indicator_path_check" CHECK(length("script_path") > 0 AND substr("script_path", -4) = '.tea'),
          CONSTRAINT "indicator_snapshot_check" CHECK(json_valid("snapshot") AND json_type("snapshot") = 'object'),
          CONSTRAINT "indicator_overrides_check" CHECK(json_valid("parameter_overrides") AND json_type("parameter_overrides") = 'object')
        );
      `);
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
      yield* tx.run(
        "CREATE INDEX `indicator_chart_index` ON `indicator` (`chart_id`);",
      );
      yield* tx.run("DROP TABLE `chart_indicator`;");
    });
  },
};

export default migration;
