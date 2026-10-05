// Purpose: Applies the 20260910004036_schedule-hard-delete forward-only SQLite migration.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260910004036_schedule-hard-delete',
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
      // Preserve surviving Occurrences before rebuilding their parent with FKs
      // enabled. Legacy tombstones are deleted, never revived as paused schedules.
      // Runs, Sessions, and transcripts are not owned by either rebuilt table.
      yield* tx.run(`
        CREATE TEMP TABLE __schedule_occurrences AS
        SELECT * FROM agent_schedule_occurrence
        WHERE schedule_id NOT IN (
          SELECT id FROM agent_schedule WHERE deleted_at IS NOT NULL
        );
      `);
      yield* tx.run('DROP TABLE `agent_schedule_occurrence`;');
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
          CONSTRAINT "chk_agent_schedules_model" CHECK(COALESCE(
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
              )),
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
        'INSERT INTO `__new_agent_schedule`(`id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `target_json`, `recurrence`, `next_fire_at`) SELECT `id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `target_json`, `recurrence`, `next_fire_at` FROM `agent_schedule` WHERE `deleted_at` IS NULL;',
      );
      yield* tx.run('DROP TABLE `agent_schedule`;');
      yield* tx.run(
        'ALTER TABLE `__new_agent_schedule` RENAME TO `agent_schedule`;',
      );
      yield* tx.run(`
        CREATE TABLE \`__new_agent_schedule_occurrence\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`schedule_id\` text NOT NULL,
          \`agent_run_id\` text NOT NULL,
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
        'INSERT INTO `__new_agent_schedule_occurrence`(`id`, `revision`, `created_at`, `updated_at`, `schedule_id`, `agent_run_id`, `fire_at`) SELECT `id`, `revision`, `created_at`, `updated_at`, `schedule_id`, `agent_run_id`, `fire_at` FROM `__schedule_occurrences`;',
      );
      yield* tx.run('DROP TABLE `__schedule_occurrences`;');
      yield* tx.run(
        'ALTER TABLE `__new_agent_schedule_occurrence` RENAME TO `agent_schedule_occurrence`;',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_due` ON `agent_schedule` (`next_fire_at`,`id`) WHERE "agent_schedule"."enabled" = 1;',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_updated` ON `agent_schedule` ("updated_at" desc);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_slot` ON `agent_schedule_occurrence` (`schedule_id`,`fire_at`);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_run` ON `agent_schedule_occurrence` (`agent_run_id`);',
      );
      const violations = yield* tx.all(sql`PRAGMA foreign_key_check`);
      if (violations.length > 0) {
        yield* Effect.die(
          'Schedule deletion migration left invalid foreign keys',
        );
      }
    });
  },
};

export default migration;
