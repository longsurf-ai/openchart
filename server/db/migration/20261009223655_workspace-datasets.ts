// Purpose: Applies the 20261009223655_workspace-datasets forward-only SQLite migration.

import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261009223655_workspace-datasets",
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
      yield* tx.run(`
        CREATE TABLE \`workspace_dataset\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`description\` text,
          \`workspace_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`time_column\` text NOT NULL,
          \`columns\` text NOT NULL,
          \`collection\` text,
          \`approved_script_hash\` text,
          CONSTRAINT "workspace_dataset_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "workspace_dataset_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "workspace_dataset_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "workspace_dataset_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "workspace_dataset_name_check" CHECK(length(trim("name")) > 0),
          CONSTRAINT "workspace_dataset_workspace_check" CHECK(length("workspace_id") > 0),
          CONSTRAINT "workspace_dataset_path_check" CHECK(length("path") > 4 AND lower(substr("path", -4)) = '.csv'),
          CONSTRAINT "workspace_dataset_time_column_check" CHECK(length("time_column") > 0),
          CONSTRAINT "workspace_dataset_columns_check" CHECK(json_valid("columns") AND json_type("columns") = 'array' AND json_array_length("columns") > 0),
          CONSTRAINT "workspace_dataset_collection_check" CHECK("collection" IS NULL OR (
                json_valid("collection")
                AND json_extract("collection", '$.kind') IN ('agent_prompt', 'script')
              ))
        );
      `);
      yield* tx.run("ALTER TABLE `chart_series` ADD `dataset_id` text;");
      // PRAGMA foreign_keys is a no-op inside the runner's transaction, so
      // dropping agent_schedule would cascade into its Occurrences. Move them
      // aside first and restore them into the rebuilt table, as
      // 20260910004036_schedule-hard-delete does.
      yield* tx.run(`
        CREATE TEMP TABLE __schedule_occurrences AS
        SELECT * FROM agent_schedule_occurrence;
      `);
      yield* tx.run("DROP TABLE `agent_schedule_occurrence`;");
      yield* tx.run(`
        CREATE TABLE \`__new_agent_schedule\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`target_json\` text NOT NULL,
          \`recurrence\` text NOT NULL,
          \`next_fire_at\` integer NOT NULL,
          CONSTRAINT "agent_schedule_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "agent_schedule_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "agent_schedule_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "agent_schedule_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_agent_schedules_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_agent_schedules_target_object" CHECK(json_type("target_json") = 'object'),
          CONSTRAINT "chk_agent_schedules_target" CHECK(CASE json_extract("target_json", '$.kind')
              WHEN 'data_collection' THEN COALESCE(
                json_type("target_json", '$.datasetId') = 'text'
                AND length(json_extract("target_json", '$.datasetId')) > 0,
                0
              )
              ELSE COALESCE(
                json_type("target_json", '$.prompt.model') = 'object'
                AND json_type("target_json", '$.prompt.model.providerID') = 'text'
                AND length(json_extract("target_json", '$.prompt.model.providerID')) > 0
                AND json_extract("target_json", '$.prompt.model.providerID') <> 'unknown'
                AND json_type("target_json", '$.prompt.model.modelID') = 'text'
                AND length(json_extract("target_json", '$.prompt.model.modelID')) > 0
                AND json_extract("target_json", '$.prompt.model.modelID') <> 'unknown'
                AND (
                  json_type("target_json", '$.prompt.model.selectedVariant') IS NULL
                  OR (
                    json_type("target_json", '$.prompt.model.selectedVariant') = 'text'
                    AND length(json_extract("target_json", '$.prompt.model.selectedVariant')) > 0
                  )
                )
                AND json(json_remove(
                  json_extract("target_json", '$.prompt.model'),
                  '$.providerID',
                  '$.modelID',
                  '$.selectedVariant'
                )) = '{}',
                0
              )
              END),
          CONSTRAINT "chk_agent_schedules_recurrence_shape" CHECK(COALESCE(
                (
                  json_extract("recurrence", '$.kind') = 'cron'
                  AND length(
                      trim(json_extract("recurrence", '$.expression'))
                    ) > 0
                  AND length(
                      trim(json_extract("recurrence", '$.timeZone'))
                    ) > 0
                ) OR (
                  json_extract("recurrence", '$.kind') = 'once'
                  AND json_type("recurrence", '$.fireAt') = 'text'
                  AND length(
                      trim(json_extract("recurrence", '$.fireAt'))
                    ) > 0
                ),
                0
              ))
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_agent_schedule`(`id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `target_json`, `recurrence`, `next_fire_at`) SELECT `id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `target_json`, `recurrence`, `next_fire_at` FROM `agent_schedule`;",
      );
      yield* tx.run("DROP TABLE `agent_schedule`;");
      yield* tx.run(
        "ALTER TABLE `__new_agent_schedule` RENAME TO `agent_schedule`;",
      );
      yield* tx.run("PRAGMA foreign_keys=ON;");
      yield* tx.run("PRAGMA foreign_keys=OFF;");
      yield* tx.run(`
        CREATE TABLE \`__new_agent_schedule_occurrence\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`schedule_id\` text NOT NULL,
          \`agent_run_id\` text,
          \`fire_at\` integer NOT NULL,
          CONSTRAINT \`fk_agent_schedule_occurrence_schedule_id_agent_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`agent_schedule\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_agent_schedule_occurrence_agent_run_id_agent_run_id_fk\` FOREIGN KEY (\`agent_run_id\`) REFERENCES \`agent_run\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "agent_schedule_occurrence_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "agent_schedule_occurrence_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "agent_schedule_occurrence_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "agent_schedule_occurrence_updated_at_check" CHECK("updated_at" >= 0)
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_agent_schedule_occurrence`(`id`, `revision`, `created_at`, `updated_at`, `schedule_id`, `agent_run_id`, `fire_at`) SELECT `id`, `revision`, `created_at`, `updated_at`, `schedule_id`, `agent_run_id`, `fire_at` FROM `__schedule_occurrences`;",
      );
      yield* tx.run("DROP TABLE `__schedule_occurrences`;");
      yield* tx.run(
        "ALTER TABLE `__new_agent_schedule_occurrence` RENAME TO `agent_schedule_occurrence`;",
      );
      yield* tx.run("PRAGMA foreign_keys=ON;");
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
          \`dataset_id\` text,
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
                AND "dataset_id" IS NULL
                AND "output" in ('price', 'volume', 'volumeProfile')
              ) OR (
                "market_source_id" IS NULL AND "indicator_id" IS NOT NULL
                AND "dataset_id" IS NULL AND length("output") > 0
              ) OR (
                "market_source_id" IS NULL AND "indicator_id" IS NULL
                AND length("dataset_id") > 0 AND length("output") > 0
              )),
          CONSTRAINT "chart_series_main_market_check" CHECK("role" <> 'main' OR (
                "market_source_id" IS NOT NULL AND "output" = 'price'
              ))
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_chart_series`(`id`, `cell_id`, `pane_id`, `position`, `role`, `market_source_id`, `indicator_id`, `output`, `profile_resolution`, `profile_rows`) SELECT `id`, `cell_id`, `pane_id`, `position`, `role`, `market_source_id`, `indicator_id`, `output`, `profile_resolution`, `profile_rows` FROM `chart_series`;",
      );
      yield* tx.run("DROP TABLE `chart_series`;");
      yield* tx.run(
        "ALTER TABLE `__new_chart_series` RENAME TO `chart_series`;",
      );
      yield* tx.run("PRAGMA foreign_keys=ON;");
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_due` ON `agent_schedule` (`next_fire_at`,`id`) WHERE "agent_schedule"."enabled" = 1;',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_updated` ON `agent_schedule` ("updated_at" desc);',
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_slot` ON `agent_schedule_occurrence` (`schedule_id`,`fire_at`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_run` ON `agent_schedule_occurrence` (`agent_run_id`);",
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `chart_series_main_unique` ON `chart_series` (`cell_id`) WHERE "chart_series"."role" = \'main\';',
      );
      yield* tx.run(
        "CREATE INDEX `chart_series_market_source_index` ON `chart_series` (`cell_id`,`market_source_id`);",
      );
      yield* tx.run(
        "CREATE INDEX `chart_series_indicator_index` ON `chart_series` (`cell_id`,`indicator_id`);",
      );
      const violations = yield* tx.all(sql`PRAGMA foreign_key_check`);
      if (violations.length > 0)
        yield* Effect.die(
          "Workspace Datasets migration left invalid foreign keys",
        );
    });
  },
};

export default migration;
