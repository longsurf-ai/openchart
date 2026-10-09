// Purpose: Generated full SQLite schema used for fresh V2 databases.

import { Effect } from "effect";
import type { DatabaseMigration } from "./migration";

const schema: Omit<DatabaseMigration.Migration, "id"> = {
  /**
   * Creates the complete current schema inside the runner-owned transaction.
   *
   * @example
   * ```ts
   * yield* schema.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`agent_permission_grants\` (
          \`id\` text PRIMARY KEY,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_messages\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`role\` text NOT NULL,
          \`data\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_messages_session_id_agent_sessions_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`agent_sessions\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_messages_role" CHECK("role" IN ('user', 'assistant')),
          CONSTRAINT "chk_agent_messages_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
              AND json_type("data", '$.role') IS NULL
            )
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_parts\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_parts_message_id_agent_messages_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`agent_messages\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_parts_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.messageID') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
            )
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
        CREATE TABLE \`agent_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`session_intent_id\` text NOT NULL,
          \`input\` text NOT NULL,
          \`status\` text DEFAULT 'queued' NOT NULL,
          \`queue_position\` integer,
          \`created_at\` integer NOT NULL,
          \`started_at\` integer,
          \`finished_at\` integer,
          CONSTRAINT \`fk_agent_run_session_id_agent_sessions_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`agent_sessions\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "agent_run_status_check" CHECK("status" IN ('queued', 'running', 'completed', 'stop', 'failed')),
          CONSTRAINT "agent_run_lifecycle_check" CHECK((
                "status" = 'queued'
                AND "queue_position" IS NOT NULL
                AND "started_at" IS NULL
                AND "finished_at" IS NULL
              ) OR (
                "status" = 'running'
                AND "queue_position" IS NULL
                AND "started_at" IS NOT NULL
                AND "finished_at" IS NULL
              ) OR (
                "status" IN ('completed', 'stop', 'failed')
                AND "queue_position" IS NULL
                AND "started_at" IS NOT NULL
                AND "finished_at" IS NOT NULL
              )),
          CONSTRAINT "agent_run_input_check" CHECK(json_valid("input")
                AND json_type("input") = 'object'
                AND NULLIF(json_extract("input", '$.agent'), '') IS NOT NULL
                AND NULLIF(
                  json_extract("input", '$.model.providerID'),
                  ''
                ) IS NOT NULL
                AND NULLIF(
                  json_extract("input", '$.model.modelID'),
                  ''
                ) IS NOT NULL
                AND json_type("input", '$.parts') = 'array'
                AND json_array_length("input", '$.parts') > 0)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_session_bindings\` (
          \`id\` text PRIMARY KEY,
          \`key\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT "chk_agent_session_bindings_key" CHECK(trim("key") <> '')
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_sessions\` (
          \`id\` text PRIMARY KEY,
          \`parent_id\` text,
          \`kind\` text NOT NULL,
          \`binding_id\` text,
          \`anchors\` text,
          \`title\` text NOT NULL,
          \`compacting_at\` integer,
          \`archived_at\` integer,
          \`last_read_run_id\` text,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_sessions_binding_id_agent_session_bindings_id_fk\` FOREIGN KEY (\`binding_id\`) REFERENCES \`agent_session_bindings\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_agent_sessions_last_read_run_id_agent_run_id_fk\` FOREIGN KEY (\`last_read_run_id\`) REFERENCES \`agent_run\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "agent_sessions_kind_check" CHECK("kind" in ('chat', 'delegate', 'dig_in', 'alert', 'scheduled', 'chart_explain'))
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
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer DEFAULT true NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT "credential_active_boolean" CHECK("active" IN (0, 1))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`agent_schedule_occurrence\` (
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
      yield* tx.run(`
        CREATE TABLE \`agent_schedule\` (
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
      yield* tx.run(`
        CREATE TABLE \`alert_event\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`rule_id\` text NOT NULL,
          \`condition\` text NOT NULL,
          \`time\` integer NOT NULL,
          \`detail_json\` text NOT NULL,
          CONSTRAINT \`fk_alert_event_rule_id_alert_rule_id_fk\` FOREIGN KEY (\`rule_id\`) REFERENCES \`alert_rule\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "alert_event_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "alert_event_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "alert_event_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "alert_event_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_alert_events_condition" CHECK(length("condition") >= 1),
          CONSTRAINT "chk_alert_events_time" CHECK("time" >= 0),
          CONSTRAINT "chk_alert_events_detail_object" CHECK(json_type("detail_json") = 'object')
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`alert_rule\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`repeat\` integer DEFAULT false NOT NULL,
          \`alertable_json\` text NOT NULL,
          CONSTRAINT "alert_rule_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "alert_rule_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "alert_rule_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "alert_rule_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_alert_rules_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_alert_rules_alertable" CHECK(json_valid("alertable_json") AND json_type("alertable_json") IS 'object'
                AND ((json_extract("alertable_json", '$.kind') IS 'tea'
                AND json_type("alertable_json", '$.source') IS 'text'
                AND length(json_extract("alertable_json", '$.source')) BETWEEN 1 AND 65536
                AND json_type("alertable_json", '$.config') IS 'object')
                OR (json_extract("alertable_json", '$.kind') IS 'drawing'
                AND json_type("alertable_json", '$.drawingId') IS 'text'
                AND substr(json_extract("alertable_json", '$.drawingId'), 1, 4) = 'drw_'
                AND json_type("alertable_json", '$.operator') IS 'text'
                AND json_extract("alertable_json", '$.operator') IN ('crossing', 'crossing_up', 'crossing_down', 'entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel', 'touching')
                AND json_type("alertable_json", '$.inputs') IS 'object'
                AND json_type("alertable_json", '$.inputs.provider') IS 'text'
                AND length(json_extract("alertable_json", '$.inputs.provider')) > 0
                AND json_type("alertable_json", '$.inputs.listing') IS 'object'
                AND json_type("alertable_json", '$.inputs.listing.symbol') IS 'text'
                AND json_type("alertable_json", '$.inputs.listing.currency') IS 'text'
                AND json_type("alertable_json", '$.inputs.resolution') IS 'text'
                AND json_extract("alertable_json", '$.inputs.resolution') IN ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')
                AND json_type("alertable_json", '$.inputs.session') IS 'text'
                AND json_extract("alertable_json", '$.inputs.session') in ('regular', 'extended', '24h')
                AND json_type("alertable_json", '$.inputs.adjustment') IS 'text'
                AND json_extract("alertable_json", '$.inputs.adjustment') IN ('raw', 'split', 'split_dividend'))))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_cell\` (
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
          CONSTRAINT "chart_cell_session_check" CHECK("session" in ('regular', 'extended', '24h')),
          CONSTRAINT "chart_cell_adjustment_check" CHECK("adjustment" in ('raw', 'split', 'split_dividend'))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_link\` (
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
      yield* tx.run(`
        CREATE TABLE \`chart_market_source\` (
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
      yield* tx.run(`
        CREATE TABLE \`chart_pane\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          CONSTRAINT \`fk_chart_pane_cell_id_chart_cell_id_fk\` FOREIGN KEY (\`cell_id\`) REFERENCES \`chart_cell\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_pane_position_unique\` UNIQUE(\`cell_id\`,\`position\`),
          CONSTRAINT \`chart_pane_cell_id_unique\` UNIQUE(\`cell_id\`,\`id\`),
          CONSTRAINT "chart_pane_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_pane_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_series\` (
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
      yield* tx.run(`
        CREATE TABLE \`chart\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`dashboard_id\` text NOT NULL,
          \`preset\` text DEFAULT '1' NOT NULL,
          CONSTRAINT \`fk_chart_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chart_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "chart_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "chart_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "chart_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chart_preset_check" CHECK("preset" in ('1', '1x2', '1x3', '1x4', '2x1', '2x2', '2x3', '2x4', '3x1', '3x2', '3x3', '3x4', '4x1', '4x2', '4x3', '4x4'))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`dashboard\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`favorite\` integer DEFAULT false NOT NULL,
          CONSTRAINT "dashboard_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "dashboard_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "dashboard_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "dashboard_name_check" CHECK(length("name") BETWEEN 1 AND 200),
          CONSTRAINT "dashboard_favorite_check" CHECK("favorite" IN (0, 1))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`dashboard_widget\` (
          \`id\` text PRIMARY KEY,
          \`dashboard_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`resource_id\` text,
          \`x\` integer NOT NULL,
          \`y\` integer NOT NULL,
          \`w\` integer NOT NULL,
          \`h\` integer NOT NULL,
          CONSTRAINT \`fk_dashboard_widget_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`dashboard_widget_position_unique\` UNIQUE(\`dashboard_id\`,\`position\`),
          CONSTRAINT "dashboard_widget_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_widget_position_check" CHECK("position" >= 0),
          CONSTRAINT "dashboard_widget_kind_check" CHECK(length("kind") > 0),
          CONSTRAINT "dashboard_widget_resource_id_check" CHECK("resource_id" IS NULL OR length("resource_id") > 0),
          CONSTRAINT "dashboard_widget_x_check" CHECK(typeof("x") = 'integer' AND "x" >= 0),
          CONSTRAINT "dashboard_widget_y_check" CHECK(typeof("y") = 'integer' AND "y" >= 0),
          CONSTRAINT "dashboard_widget_w_check" CHECK(typeof("w") = 'integer' AND "w" >= 1),
          CONSTRAINT "dashboard_widget_h_check" CHECK(typeof("h") = 'integer' AND "h" >= 1),
          CONSTRAINT "dashboard_widget_width_check" CHECK("x" + "w" <= 12)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`drawing\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`dashboard_id\` text NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_drawing_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "drawing_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "drawing_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "drawing_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "drawing_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "drawing_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "drawing_listing_check" CHECK(json_valid("listing")),
          CONSTRAINT "drawing_data_check" CHECK(json_valid("data"))
        );
      `);
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
      yield* tx.run(`
        CREATE TABLE \`post_media\` (
          \`id\` text PRIMARY KEY,
          \`post_id\` text NOT NULL,
          \`mime\` text NOT NULL,
          \`filename\` text NOT NULL,
          \`bytes\` blob NOT NULL,
          CONSTRAINT \`fk_post_media_post_id_post_id_fk\` FOREIGN KEY (\`post_id\`) REFERENCES \`post\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_post_media_size" CHECK(length("bytes") BETWEEN 1 AND 33554432)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`post\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`author_json\` text NOT NULL,
          \`origin_json\` text NOT NULL,
          \`content_json\` text NOT NULL,
          \`quoted_post_id\` text,
          \`publication_key\` text NOT NULL,
          \`publication_hash\` text NOT NULL,
          CONSTRAINT "post_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "post_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "post_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "post_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_post_author" CHECK(json_valid("author_json") AND json_type("author_json") = 'object' AND json_extract("author_json", '$.kind') IN ('provider','rule')),
          CONSTRAINT "chk_post_origin" CHECK(json_valid("origin_json") AND json_type("origin_json") = 'object' AND json_extract("origin_json", '$.kind') IN ('alert_event','agent_run')),
          CONSTRAINT "chk_post_author_origin" CHECK((json_extract("origin_json", '$.kind') IS 'alert_event' AND json_extract("author_json", '$.kind') IS 'rule' AND json_extract("author_json", '$.ruleId') IS json_extract("origin_json", '$.ruleId')) OR (json_extract("origin_json", '$.kind') IS 'agent_run' AND json_extract("author_json", '$.kind') IS 'provider')),
          CONSTRAINT "chk_post_content" CHECK(json_valid("content_json") AND json_type("content_json") = 'array' AND json_array_length("content_json") > 0),
          CONSTRAINT "chk_post_publication" CHECK(length(trim("publication_key")) > 0 AND length("publication_hash") = 64)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`symbology\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          \`listing_key\` text GENERATED ALWAYS AS (case when json_extract(listing, '$.id') is not null then json_array(json_extract(listing, '$.id')) else json_array(json_extract(listing, '$.symbol'), json_extract(listing, '$.venue')) end) STORED NOT NULL,
          CONSTRAINT "symbology_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "symbology_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "symbology_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "symbology_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "symbology_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "symbology_listing_check" CHECK(json_valid("listing") AND json_type("listing") = 'object')
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`trigger\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`event_json\` text NOT NULL,
          \`target_json\` text NOT NULL,
          CONSTRAINT "trigger_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "trigger_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "trigger_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "trigger_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_triggers_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_triggers_event_object" CHECK(json_type("event_json") = 'object'),
          CONSTRAINT "chk_triggers_target_object" CHECK(json_type("target_json") = 'object')
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`watchlist_item\` (
          \`id\` text PRIMARY KEY,
          \`watchlist_id\` text NOT NULL,
          \`section_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          CONSTRAINT \`watchlist_item_section_fk\` FOREIGN KEY (\`watchlist_id\`,\`section_id\`) REFERENCES \`watchlist_section\`(\`watchlist_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`watchlist_item_position_unique\` UNIQUE(\`section_id\`,\`position\`),
          CONSTRAINT "watchlist_item_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "watchlist_item_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "watchlist_item_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "watchlist_item_listing_check" CHECK(COALESCE(
                json_type("listing") = 'object'
                AND json_type("listing", '$.symbol') = 'text'
                AND json_type("listing", '$.currency') = 'text',
                0
              ))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`watchlist_section\` (
          \`id\` text PRIMARY KEY,
          \`watchlist_id\` text NOT NULL,
          \`parent_section_id\` text,
          \`position\` integer NOT NULL,
          \`name\` text,
          CONSTRAINT \`fk_watchlist_section_watchlist_id_watchlist_id_fk\` FOREIGN KEY (\`watchlist_id\`) REFERENCES \`watchlist\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`watchlist_section_parent_fk\` FOREIGN KEY (\`watchlist_id\`,\`parent_section_id\`) REFERENCES \`watchlist_section\`(\`watchlist_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`watchlist_section_watchlist_id_unique\` UNIQUE(\`watchlist_id\`,\`id\`),
          CONSTRAINT "watchlist_section_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "watchlist_section_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "watchlist_section_name_check" CHECK("name" IS NULL OR length("name") BETWEEN 1 AND 200),
          CONSTRAINT "watchlist_section_parent_check" CHECK("parent_section_id" IS NULL OR "parent_section_id" != "id")
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`watchlist\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`columns\` text DEFAULT '[]' NOT NULL,
          CONSTRAINT "watchlist_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "watchlist_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "watchlist_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "watchlist_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "watchlist_name_check" CHECK(length("name") BETWEEN 1 AND 200)
        );
      `);
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
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`root\` text NOT NULL UNIQUE,
          CONSTRAINT "workspace_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "workspace_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "workspace_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "workspace_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "workspace_root_check" CHECK(length("root") > 0)
        );
      `);
      yield* tx.run(
        "CREATE UNIQUE INDEX `uniq_agent_permission_grants_action_resource` ON `agent_permission_grants` (`action`,`resource`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_messages_session_created` ON `agent_messages` (`session_id`,`created_at`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_messages_session_canonical_id` ON `agent_messages` (`session_id`,`id`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_parts_message` ON `agent_parts` (`message_id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `agent_run_session_intent_idx` ON `agent_run` (`session_intent_id`);",
      );
      yield* tx.run(
        "CREATE INDEX `agent_run_session_id_idx` ON `agent_run` (`session_id`,`id`);",
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `agent_run_session_running_idx` ON `agent_run` (`session_id`) WHERE "agent_run"."status" = \'running\';',
      );
      yield* tx.run(
        'CREATE INDEX `agent_run_session_queue_idx` ON `agent_run` (`session_id`,`queue_position`) WHERE "agent_run"."status" = \'queued\';',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `agent_run_session_queue_position_idx` ON `agent_run` (`session_id`,`queue_position`) WHERE "agent_run"."status" = \'queued\';',
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uniq_agent_session_bindings_key` ON `agent_session_bindings` (`key`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_sessions_updated` ON `agent_sessions` (`updated_at`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_sessions_parent` ON `agent_sessions` (`parent_id`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_sessions_binding` ON `agent_sessions` (`binding_id`,`created_at`,`id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uniq_agent_todos_position` ON `agent_todos` (`session_id`,`position`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_slot` ON `agent_schedule_occurrence` (`schedule_id`,`fire_at`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_run` ON `agent_schedule_occurrence` (`agent_run_id`);",
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_due` ON `agent_schedule` (`next_fire_at`,`id`) WHERE "agent_schedule"."enabled" = 1;',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_updated` ON `agent_schedule` ("updated_at" desc);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_alert_events_created` ON `alert_event` ("created_at" desc,"id" desc);',
      );
      yield* tx.run(
        "CREATE INDEX `idx_alert_events_rule` ON `alert_event` (`rule_id`,`created_at`,`id`);",
      );
      yield* tx.run(
        "CREATE INDEX `chart_link_target_index` ON `chart_link` (`chart_id`,`to_cell_id`);",
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
      yield* tx.run(
        "CREATE INDEX `chart_dashboard_index` ON `chart` (`dashboard_id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `drawing_listing_gesture_unique` ON `drawing` (`dashboard_id`,`provider`,case when json_extract(\"listing\", '$.id') is not null then json_array(json_extract(\"listing\", '$.id')) else json_array(json_extract(\"listing\", '$.symbol'), json_extract(\"listing\", '$.venue')) end,json_extract(\"data\", '$.id'));",
      );
      yield* tx.run(
        "CREATE INDEX `drawing_dashboard_provider_index` ON `drawing` (`dashboard_id`,`provider`);",
      );
      yield* tx.run(
        "CREATE INDEX `indicator_chart_index` ON `indicator` (`chart_id`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_post_media_owner` ON `post_media` (`post_id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_post_publication` ON `post` (`publication_key`);",
      );
      yield* tx.run(
        'CREATE INDEX `idx_post_created` ON `post` ("created_at" desc,"id" desc);',
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `symbology_provider_listing_unique` ON `symbology` (`provider`,`listing_key`);",
      );
      yield* tx.run(
        "CREATE INDEX `symbology_created_id_index` ON `symbology` (`created_at`,`id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `watchlist_item_listing_unique` ON `watchlist_item` (`watchlist_id`,`provider`,case when json_extract(\"listing\", '$.id') is not null then json_array(json_extract(\"listing\", '$.id')) else json_array(json_extract(\"listing\", '$.symbol'), json_extract(\"listing\", '$.venue')) end);",
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `watchlist_section_root_position_unique` ON `watchlist_section` (`watchlist_id`,`position`) WHERE "watchlist_section"."parent_section_id" IS NULL;',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `watchlist_section_child_position_unique` ON `watchlist_section` (`watchlist_id`,`parent_section_id`,`position`) WHERE "watchlist_section"."parent_section_id" IS NOT NULL;',
      );
    });
  },
};

export default schema;
