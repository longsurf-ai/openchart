// Purpose: Applies the 20260907070529_agent-data forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907070529_agent-data',
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
        CREATE TABLE \`agent_messages\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`role\` text NOT NULL,
          \`data\` text NOT NULL,
          \`origin\` text DEFAULT 'original' NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_messages_session_id_agent_sessions_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`agent_sessions\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_messages_role" CHECK("role" IN ('user', 'assistant')),
          CONSTRAINT "chk_agent_messages_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
              AND json_type("data", '$.role') IS NULL
              AND json_type("data", '$.origin') IS NULL
            ),
          CONSTRAINT "map_agent_messages_origin_enum" CHECK("origin" IN ('original', 'inherited'))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_parts\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`run_id\` text,
          \`data\` text NOT NULL,
          \`origin\` text DEFAULT 'original' NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_parts_message_id_agent_messages_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`agent_messages\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_parts_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.messageID') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
              AND json_type("data", '$.origin') IS NULL
            ),
          CONSTRAINT "map_agent_parts_origin_enum" CHECK("origin" IN ('original', 'inherited'))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_permissions\` (
          \`user_id\` text PRIMARY KEY,
          \`data\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_schedule_occurrences\` (
          \`id\` text PRIMARY KEY,
          \`schedule_id\` text NOT NULL,
          \`agent_run_id\` text NOT NULL,
          \`fire_at\` integer NOT NULL,
          \`accepted_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`revision\` integer DEFAULT 0 NOT NULL,
          CONSTRAINT \`fk_agent_schedule_occurrences_schedule_id_agent_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`agent_schedule\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_agent_schedule_occurrences_agent_run_id_agent_run_id_fk\` FOREIGN KEY (\`agent_run_id\`) REFERENCES \`agent_run\`(\`id\`) ON DELETE RESTRICT
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_schedule\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`user_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`target_json\` text NOT NULL,
          \`recurrence\` text NOT NULL,
          \`next_fire_at\` integer NOT NULL,
          \`deleted_at\` integer,
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
          CONSTRAINT "chk_agent_schedules_deleted_disabled" CHECK("deleted_at" IS NULL OR "enabled" = 0),
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
      yield* tx.run(`
        CREATE TABLE \`agent_session_bindings\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text NOT NULL,
          \`surface\` text NOT NULL,
          \`feature_key\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT "chk_agent_session_bindings_surface" CHECK("surface" IN (
                'chart_explain',
                'watchlist_builder',
                'watchlist_semantic_column',
                'watchlist_semantic_cell'
              )),
          CONSTRAINT "chk_agent_session_bindings_feature_key" CHECK(trim("feature_key") <> '')
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_sessions\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text NOT NULL,
          \`parent_id\` text,
          \`kind\` text,
          \`binding_id\` text,
          \`binding_generation\` integer,
          \`binding_superseded_at\` integer,
          \`binding_rotation_intent_id\` text,
          \`anchors\` text,
          \`title\` text NOT NULL,
          \`permission\` text,
          \`compacting_at\` integer,
          \`archived_at\` integer,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_sessions_binding_id_agent_session_bindings_id_fk\` FOREIGN KEY (\`binding_id\`) REFERENCES \`agent_session_bindings\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "chk_agent_sessions_binding_shape" CHECK(("binding_id" IS NULL) = ("binding_generation" IS NULL)
                AND (
                  "binding_generation" IS NULL
                  OR "binding_generation" > 0
                ))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_skills\` (
          \`name\` text PRIMARY KEY,
          \`description\` text NOT NULL,
          \`content\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT "chk_agent_skills_name" CHECK(length("name") BETWEEN 1 AND 100
                AND "name" NOT GLOB '*[^a-z0-9-]*'
                AND "name" NOT LIKE '-%'
                AND "name" NOT LIKE '%-'
                AND "name" NOT LIKE '%--%'),
          CONSTRAINT "chk_agent_skills_description" CHECK("description" = trim("description")
                AND length("description") BETWEEN 1 AND 1000),
          CONSTRAINT "chk_agent_skills_content" CHECK("content" = trim("content")
                AND length("content") BETWEEN 1 AND 65536)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_todos\` (
          \`id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`agent_todos_pk\` PRIMARY KEY(\`session_id\`, \`id\`),
          CONSTRAINT \`fk_agent_todos_session_id_agent_sessions_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`agent_sessions\`(\`id\`) ON DELETE CASCADE
        );
      `);
      yield* tx.run(
        'CREATE INDEX `idx_agent_messages_session_created` ON `agent_messages` (`session_id`,`created_at`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_messages_session_canonical_id` ON `agent_messages` (`session_id`,`id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_parts_message` ON `agent_parts` (`message_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_parts_session` ON `agent_parts` (`session_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_parts_run` ON `agent_parts` (`run_id`);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_slot` ON `agent_schedule_occurrences` (`schedule_id`,`fire_at`);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_run` ON `agent_schedule_occurrences` (`agent_run_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_due` ON `agent_schedule` (`next_fire_at`,`id`) WHERE "agent_schedule"."enabled" = 1 AND "agent_schedule"."deleted_at" IS NULL;',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_user_updated` ON `agent_schedule` (`user_id`,"updated_at" desc);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uniq_agent_session_bindings_identity` ON `agent_session_bindings` (`user_id`,`surface`,`feature_key`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_user_updated` ON `agent_sessions` (`user_id`,`updated_at`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_parent` ON `agent_sessions` (`parent_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_binding` ON `agent_sessions` (`binding_id`,`binding_generation`);',
      );
      yield* tx.run(`
        CREATE UNIQUE INDEX \`uniq_agent_sessions_binding_current\` ON \`agent_sessions\` (\`binding_id\`) WHERE "agent_sessions"."binding_id" IS NOT NULL
                  AND "agent_sessions"."binding_superseded_at" IS NULL;
      `);
      yield* tx.run(`
        CREATE UNIQUE INDEX \`uniq_agent_sessions_binding_generation\` ON \`agent_sessions\` (\`binding_id\`,\`binding_generation\`) WHERE "agent_sessions"."binding_id" IS NOT NULL
                  AND "agent_sessions"."binding_generation" IS NOT NULL;
      `);
      yield* tx.run(`
        CREATE UNIQUE INDEX \`uniq_agent_sessions_binding_rotation_intent\` ON \`agent_sessions\` (\`binding_id\`,\`binding_rotation_intent_id\`) WHERE "agent_sessions"."binding_id" IS NOT NULL
                  AND "agent_sessions"."binding_rotation_intent_id" IS NOT NULL;
      `);
      yield* tx.run(
        'CREATE UNIQUE INDEX `uniq_agent_todos_position` ON `agent_todos` (`session_id`,`position`);',
      );
    });
  },
};

export default migration;
