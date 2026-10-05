-- Frozen application schema and migration ledger from 2026-09-27.
-- Keep this baseline together; normal startup applies the pending migrations.

CREATE TABLE `agent_messages` (
          `id` text PRIMARY KEY,
          `session_id` text NOT NULL,
          `role` text NOT NULL,
          `data` text NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT `fk_agent_messages_session_id_agent_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_messages_role" CHECK("role" IN ('user', 'assistant')),
          CONSTRAINT "chk_agent_messages_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
              AND json_type("data", '$.role') IS NULL
            )
        );

CREATE TABLE `agent_parts` (
          `id` text PRIMARY KEY,
          `message_id` text NOT NULL,
          `data` text NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT `fk_agent_parts_message_id_agent_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `agent_messages`(`id`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_parts_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.messageID') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
            )
        );

CREATE TABLE `agent_permission_grants` (
          `id` text PRIMARY KEY,
          `action` text NOT NULL,
          `resource` text NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
        );

CREATE TABLE `agent_permissions` (
          `user_id` text PRIMARY KEY,
          `data` text NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
        );

CREATE TABLE `agent_run` (
          `id` text PRIMARY KEY,
          `session_id` text NOT NULL,
          `session_intent_id` text NOT NULL,
          `input` text NOT NULL,
          `status` text DEFAULT 'queued' NOT NULL,
          `queue_position` integer,
          `created_at` integer NOT NULL,
          `started_at` integer,
          `finished_at` integer,
          CONSTRAINT `fk_agent_run_session_id_agent_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON DELETE RESTRICT,
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

CREATE TABLE `agent_schedule` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `name` text NOT NULL,
          `enabled` integer DEFAULT true NOT NULL,
          `target_json` text NOT NULL,
          `recurrence` text NOT NULL,
          `next_fire_at` integer NOT NULL,
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

CREATE TABLE `agent_schedule_occurrence` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `schedule_id` text NOT NULL,
          `agent_run_id` text NOT NULL,
          `fire_at` integer NOT NULL,
          CONSTRAINT `fk_agent_schedule_occurrence_schedule_id_agent_schedule_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `agent_schedule`(`id`) ON DELETE CASCADE,
          CONSTRAINT `fk_agent_schedule_occurrence_agent_run_id_agent_run_id_fk` FOREIGN KEY (`agent_run_id`) REFERENCES `agent_run`(`id`) ON DELETE RESTRICT,
          CONSTRAINT "agent_schedule_occurrence_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "agent_schedule_occurrence_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "agent_schedule_occurrence_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "agent_schedule_occurrence_updated_at_check" CHECK("updated_at" >= 0)
        );

CREATE TABLE `agent_session_bindings` (
          `id` text PRIMARY KEY,
          `key` text NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT "chk_agent_session_bindings_key" CHECK(trim("key") <> '')
        );

CREATE TABLE "agent_sessions" (
          `id` text PRIMARY KEY,
          `parent_id` text,
          `kind` text NOT NULL,
          `binding_id` text,
          `anchors` text,
          `title` text NOT NULL,
          `compacting_at` integer,
          `archived_at` integer,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT `fk_agent_sessions_binding_id_agent_session_bindings_id_fk` FOREIGN KEY (`binding_id`) REFERENCES `agent_session_bindings`(`id`) ON DELETE RESTRICT,
          CONSTRAINT "agent_sessions_kind_check" CHECK("kind" in ('chat', 'delegate', 'dig_in', 'alert', 'scheduled', 'chart_explain'))
        );

CREATE TABLE `agent_todos` (
          `id` text NOT NULL,
          `session_id` text NOT NULL,
          `content` text NOT NULL,
          `status` text NOT NULL,
          `priority` text NOT NULL,
          `position` integer NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT `agent_todos_pk` PRIMARY KEY(`session_id`, `id`),
          CONSTRAINT `fk_agent_todos_session_id_agent_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON DELETE CASCADE
        );

CREATE TABLE `alert_event` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `rule_id` text NOT NULL,
          `condition` text NOT NULL,
          `time` integer NOT NULL,
          `detail_json` text NOT NULL,
          CONSTRAINT `fk_alert_event_rule_id_alert_rule_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `alert_rule`(`id`) ON DELETE CASCADE,
          CONSTRAINT "alert_event_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "alert_event_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "alert_event_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "alert_event_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_alert_events_condition" CHECK(length("condition") >= 1),
          CONSTRAINT "chk_alert_events_time" CHECK("time" >= 0),
          CONSTRAINT "chk_alert_events_detail_object" CHECK(json_type("detail_json") = 'object')
        );

CREATE TABLE "alert_rule" (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `name` text NOT NULL,
          `enabled` integer DEFAULT true NOT NULL,
          `repeat` integer DEFAULT false NOT NULL,
          `alertable_json` text NOT NULL,
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
                AND json_extract("alertable_json", '$.inputs.session') IN ('regular', 'pre', 'post', 'extended', 'overnight', '24h')
                AND json_type("alertable_json", '$.inputs.adjustment') IS 'text'
                AND json_extract("alertable_json", '$.inputs.adjustment') IN ('raw', 'split', 'split_dividend'))))
        );

CREATE TABLE "app_schema_migrations" (
    version INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

CREATE TABLE `chart` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `dashboard_id` text NOT NULL,
          `preset` text DEFAULT '1' NOT NULL,
          CONSTRAINT `fk_chart_dashboard_id_dashboard_id_fk` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboard`(`id`) ON DELETE CASCADE,
          CONSTRAINT "chart_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "chart_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "chart_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "chart_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chart_preset_check" CHECK("preset" in ('1', '1x2', '1x3', '1x4', '2x1', '2x2', '2x3', '2x4', '3x1', '3x2', '3x3', '3x4', '4x1', '4x2', '4x3', '4x4'))
        );

CREATE TABLE `chart_cell` (
          `id` text PRIMARY KEY,
          `chart_id` text NOT NULL,
          `position` integer NOT NULL,
          `resolution` text DEFAULT '1d' NOT NULL,
          `session` text DEFAULT 'extended' NOT NULL,
          `adjustment` text DEFAULT 'raw' NOT NULL,
          CONSTRAINT `fk_chart_cell_chart_id_chart_id_fk` FOREIGN KEY (`chart_id`) REFERENCES `chart`(`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_cell_position_unique` UNIQUE(`chart_id`,`position`),
          CONSTRAINT `chart_cell_chart_id_unique` UNIQUE(`chart_id`,`id`),
          CONSTRAINT "chart_cell_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_cell_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_cell_resolution_check" CHECK("resolution" in ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')),
          CONSTRAINT "chart_cell_session_check" CHECK("session" in ('regular', 'pre', 'post', 'extended', 'overnight', '24h')),
          CONSTRAINT "chart_cell_adjustment_check" CHECK("adjustment" in ('raw', 'split', 'split_dividend'))
        );

CREATE TABLE `chart_link` (
          `id` text PRIMARY KEY,
          `chart_id` text NOT NULL,
          `from_cell_id` text NOT NULL,
          `to_cell_id` text NOT NULL,
          `sync_listing` integer DEFAULT false NOT NULL,
          `sync_crosshair` integer DEFAULT false NOT NULL,
          CONSTRAINT `fk_chart_link_chart_id_chart_id_fk` FOREIGN KEY (`chart_id`) REFERENCES `chart`(`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_link_from_cell_fk` FOREIGN KEY (`chart_id`,`from_cell_id`) REFERENCES `chart_cell`(`chart_id`,`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_link_to_cell_fk` FOREIGN KEY (`chart_id`,`to_cell_id`) REFERENCES `chart_cell`(`chart_id`,`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_link_endpoints_unique` UNIQUE(`chart_id`,`from_cell_id`,`to_cell_id`),
          CONSTRAINT "chart_link_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_link_distinct_cells_check" CHECK("from_cell_id" <> "to_cell_id"),
          CONSTRAINT "chart_link_sync_listing_check" CHECK("sync_listing" IN (0, 1)),
          CONSTRAINT "chart_link_sync_crosshair_check" CHECK("sync_crosshair" IN (0, 1))
        );

CREATE TABLE `chart_market_source` (
          `id` text PRIMARY KEY,
          `cell_id` text NOT NULL,
          `position` integer NOT NULL,
          `provider` text NOT NULL,
          `listing` text NOT NULL,
          CONSTRAINT `fk_chart_market_source_cell_id_chart_cell_id_fk` FOREIGN KEY (`cell_id`) REFERENCES `chart_cell`(`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_market_source_position_unique` UNIQUE(`cell_id`,`position`),
          CONSTRAINT `chart_market_source_cell_id_unique` UNIQUE(`cell_id`,`id`),
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

CREATE TABLE `chart_pane` (
          `id` text PRIMARY KEY,
          `cell_id` text NOT NULL,
          `position` integer NOT NULL,
          CONSTRAINT `fk_chart_pane_cell_id_chart_cell_id_fk` FOREIGN KEY (`cell_id`) REFERENCES `chart_cell`(`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_pane_position_unique` UNIQUE(`cell_id`,`position`),
          CONSTRAINT `chart_pane_cell_id_unique` UNIQUE(`cell_id`,`id`),
          CONSTRAINT "chart_pane_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_pane_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0)
        );

CREATE TABLE "chart_series" (
          `id` text PRIMARY KEY,
          `cell_id` text NOT NULL,
          `pane_id` text NOT NULL,
          `position` integer NOT NULL,
          `role` text DEFAULT 'normal' NOT NULL,
          `market_source_id` text,
          `indicator_id` text,
          `output` text NOT NULL,
          CONSTRAINT `chart_series_pane_fk` FOREIGN KEY (`cell_id`,`pane_id`) REFERENCES `chart_pane`(`cell_id`,`id`) ON DELETE CASCADE,
          CONSTRAINT `chart_series_market_source_fk` FOREIGN KEY (`cell_id`,`market_source_id`) REFERENCES `chart_market_source`(`cell_id`,`id`),
          CONSTRAINT `chart_series_position_unique` UNIQUE(`pane_id`,`position`),
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

CREATE TABLE `credential` (
          `id` text PRIMARY KEY,
          `integration_id` text,
          `label` text NOT NULL,
          `value` text NOT NULL,
          `connector_id` text,
          `method_id` text,
          `active` integer DEFAULT true NOT NULL,
          `time_created` integer NOT NULL,
          `time_updated` integer NOT NULL,
          CONSTRAINT "credential_active_boolean" CHECK("active" IN (0, 1))
        );

CREATE TABLE `dashboard` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `name` text NOT NULL,
          `favorite` integer DEFAULT false NOT NULL,
          CONSTRAINT "dashboard_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "dashboard_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "dashboard_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "dashboard_name_check" CHECK(length("name") BETWEEN 1 AND 200),
          CONSTRAINT "dashboard_favorite_check" CHECK("favorite" IN (0, 1))
        );

CREATE TABLE `dashboard_widget` (
          `id` text PRIMARY KEY,
          `dashboard_id` text NOT NULL,
          `position` integer NOT NULL,
          `kind` text NOT NULL,
          `resource_id` text,
          `x` integer NOT NULL,
          `y` integer NOT NULL,
          `w` integer NOT NULL,
          `h` integer NOT NULL,
          CONSTRAINT `fk_dashboard_widget_dashboard_id_dashboard_id_fk` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboard`(`id`) ON DELETE CASCADE,
          CONSTRAINT `dashboard_widget_position_unique` UNIQUE(`dashboard_id`,`position`),
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

CREATE TABLE `drawing` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `dashboard_id` text NOT NULL,
          `provider` text NOT NULL,
          `listing` text NOT NULL,
          `data` text NOT NULL,
          CONSTRAINT `fk_drawing_dashboard_id_dashboard_id_fk` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboard`(`id`) ON DELETE CASCADE,
          CONSTRAINT "drawing_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "drawing_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "drawing_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "drawing_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "drawing_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "drawing_listing_check" CHECK(json_valid("listing")),
          CONSTRAINT "drawing_data_check" CHECK(json_valid("data"))
        );

CREATE TABLE `indicator` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `chart_id` text NOT NULL,
          `cell_id` text NOT NULL,
          `workspace_id` text NOT NULL,
          `script_path` text NOT NULL,
          `snapshot` text NOT NULL,
          `parameter_overrides` text NOT NULL,
          CONSTRAINT `fk_indicator_chart_id_chart_id_fk` FOREIGN KEY (`chart_id`) REFERENCES `chart`(`id`) ON DELETE CASCADE,
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

CREATE TABLE "post" (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `author_json` text NOT NULL,
          `origin_json` text NOT NULL,
          `content_json` text NOT NULL,
          `quoted_post_id` text,
          `publication_key` text NOT NULL,
          `publication_hash` text NOT NULL,
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

CREATE TABLE `post_media` (
          `id` text PRIMARY KEY,
          `post_id` text NOT NULL,
          `mime` text NOT NULL,
          `filename` text NOT NULL,
          `bytes` blob NOT NULL,
          CONSTRAINT `fk_post_media_post_id_post_id_fk` FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON DELETE CASCADE,
          CONSTRAINT "chk_post_media_size" CHECK(length("bytes") BETWEEN 1 AND 33554432)
        );

CREATE TABLE `symbology` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `provider` text NOT NULL,
          `listing` text NOT NULL,
          `listing_key` text GENERATED ALWAYS AS (json_array(json_extract(listing, '$.symbol'), json_extract(listing, '$.venue'))) STORED NOT NULL,
          CONSTRAINT "symbology_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "symbology_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "symbology_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "symbology_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "symbology_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "symbology_listing_check" CHECK(json_valid("listing") AND json_type("listing") = 'object')
        );

CREATE TABLE "trigger" (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `name` text NOT NULL,
          `enabled` integer DEFAULT true NOT NULL,
          `event_json` text NOT NULL,
          `target_json` text NOT NULL,
          CONSTRAINT "trigger_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "trigger_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "trigger_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "trigger_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_triggers_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_triggers_event_object" CHECK(json_type("event_json") = 'object'),
          CONSTRAINT "chk_triggers_target_object" CHECK(json_type("target_json") = 'object')
        );

CREATE TABLE `workspace` (
          `id` text PRIMARY KEY,
          `revision` integer DEFAULT 1 NOT NULL,
          `created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          `root` text NOT NULL UNIQUE,
          CONSTRAINT "workspace_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "workspace_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "workspace_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "workspace_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "workspace_root_check" CHECK(length("root") > 0)
        );

CREATE UNIQUE INDEX `agent_run_session_intent_idx` ON `agent_run` (`session_intent_id`);

CREATE INDEX `agent_run_session_queue_idx` ON `agent_run` (`session_id`,`queue_position`) WHERE "agent_run"."status" = 'queued';

CREATE UNIQUE INDEX `agent_run_session_queue_position_idx` ON `agent_run` (`session_id`,`queue_position`) WHERE "agent_run"."status" = 'queued';

CREATE UNIQUE INDEX `agent_run_session_running_idx` ON `agent_run` (`session_id`) WHERE "agent_run"."status" = 'running';

CREATE INDEX `chart_dashboard_index` ON `chart` (`dashboard_id`);

CREATE INDEX `chart_link_target_index` ON `chart_link` (`chart_id`,`to_cell_id`);

CREATE INDEX `chart_series_indicator_index` ON `chart_series` (`cell_id`,`indicator_id`);

CREATE UNIQUE INDEX `chart_series_main_unique` ON `chart_series` (`cell_id`) WHERE "chart_series"."role" = 'main';

CREATE INDEX `chart_series_market_source_index` ON `chart_series` (`cell_id`,`market_source_id`);

CREATE INDEX `drawing_dashboard_provider_index` ON `drawing` (`dashboard_id`,`provider`);

CREATE UNIQUE INDEX `drawing_scope_gesture_unique` ON `drawing` (`dashboard_id`,`provider`,json_array(json_extract("listing", '$.symbol'), json_extract("listing", '$.venue'), json_extract("listing", '$.currency')),json_extract("data", '$.id'));

CREATE INDEX `idx_agent_messages_session_canonical_id` ON `agent_messages` (`session_id`,`id`);

CREATE INDEX `idx_agent_messages_session_created` ON `agent_messages` (`session_id`,`created_at`);

CREATE INDEX `idx_agent_parts_message` ON `agent_parts` (`message_id`);

CREATE INDEX `idx_agent_schedules_due` ON `agent_schedule` (`next_fire_at`,`id`) WHERE "agent_schedule"."enabled" = 1;

CREATE INDEX `idx_agent_schedules_updated` ON `agent_schedule` ("updated_at" desc);

CREATE INDEX `idx_agent_sessions_binding` ON `agent_sessions` (`binding_id`,`created_at`,`id`);

CREATE INDEX `idx_agent_sessions_parent` ON `agent_sessions` (`parent_id`);

CREATE INDEX `idx_agent_sessions_updated` ON `agent_sessions` (`updated_at`);

CREATE INDEX `idx_alert_events_created` ON `alert_event` ("created_at" desc,"id" desc);

CREATE INDEX `idx_alert_events_rule` ON `alert_event` (`rule_id`,`created_at`,`id`);

CREATE INDEX `idx_post_created` ON `post` ("created_at" desc,"id" desc);

CREATE INDEX `idx_post_media_owner` ON `post_media` (`post_id`);

CREATE INDEX `indicator_chart_index` ON `indicator` (`chart_id`);

CREATE INDEX `symbology_created_id_index` ON `symbology` (`created_at`,`id`);

CREATE UNIQUE INDEX `symbology_provider_listing_unique` ON `symbology` (`provider`,`listing_key`);

CREATE UNIQUE INDEX `uniq_agent_permission_grants_action_resource` ON `agent_permission_grants` (`action`,`resource`);

CREATE UNIQUE INDEX `uniq_agent_session_bindings_key` ON `agent_session_bindings` (`key`);

CREATE UNIQUE INDEX `uniq_agent_todos_position` ON `agent_todos` (`session_id`,`position`);

CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_run` ON `agent_schedule_occurrence` (`agent_run_id`);

CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_slot` ON `agent_schedule_occurrence` (`schedule_id`,`fire_at`);

CREATE UNIQUE INDEX `uq_post_publication` ON `post` (`publication_key`);

INSERT INTO app_schema_migrations VALUES (20260904190853, '20260904190853_agent-run', '20260904190853_agent-run.ts', 'a22606e822441952306fc4213ca0957a0fa27ed764cb0aa0798fe2f6a61e3342', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260905180427, '20260905180427_dashboard', '20260905180427_dashboard.ts', '218d4ed0f09805deed62f232dc3e1f2a65883737600d8be0fce22358dad522d5', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260905185237, '20260905185237_dashboard_tables', '20260905185237_dashboard_tables.ts', '052e4922782c681c5f3bb6322b09e4c22874eafae4e2b2b95484d09415a0107c', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260905190404, '20260905190404_resource_timestamps', '20260905190404_resource_timestamps.ts', '13d3a1e341565f0ce03c46d86060ba50ff41c7d0a13410f0633727e49c13912e', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260905230717, '20260905230717_chart-grid', '20260905230717_chart-grid.ts', 'ee6405cea5f2e178c60d5f346089bdd98d8303a39533d8b33b2ff7ded0d8d22d', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260906005122, '20260906005122_tea-script', '20260906005122_tea-script.ts', 'bad812d3d3b2975169617fac1ecd5160b0908cdcf75d2f28306b2c907dca060b', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907070529, '20260907070529_agent-data', '20260907070529_agent-data.ts', 'bfedb36090c8d12115d380726e6622360965b9838e1188f9572302a1f6db04cd', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907073234, '20260907073234_occurrence-resource', '20260907073234_occurrence-resource.ts', 'a1ff11990f021eb1d6f6af4196e9947f1bdc03ade73432151e7f6c33f07c31ec', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907175025, '20260907175025_remove-agent-skills', '20260907175025_remove-agent-skills.ts', '706a731a2c471b42b857ba121c86e3b7bc3d92ed304a73ed2b6320b1959cf857', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907183917, '20260907183917_simplify-agent-binding', '20260907183917_simplify-agent-binding.ts', '858bd49aedb9c6fd3560ce79ae1c42fe210aa9eee415c78b3b6be70b2ba5eed2', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907185415, '20260907185415_remove-tool-display-data', '20260907185415_remove-tool-display-data.ts', '9671c85cece549500cfd99a6ef3b0adde8cfdfcce73a9c88d9a27b1b9a8242e6', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907190439, '20260907190439_remove-assistant-mode', '20260907190439_remove-assistant-mode.ts', 'db9d6cd06ec12908e9b0a60ad1b5198945e158e9b80a4bae8a6dd87f8cc2b818', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907190920, '20260907190920_simplify-context-parts', '20260907190920_simplify-context-parts.ts', '768576cead5db090bcdb4d0bee79379af0eb3d8732c6a39a063870893ed3c64c', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907191229, '20260907191229_rename-assistant-trigger', '20260907191229_rename-assistant-trigger.ts', 'a0601c998bd293047f89f40c0fff2669e4cec915f27c670123ef1fae696ba132', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907191744, '20260907191744_simplify-session-anchors', '20260907191744_simplify-session-anchors.ts', '6680b855dbdd90bb8805fc3fcedf9fb542745c52d5bfa8bc1f2021f6bfe7a40a', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907192917, '20260907192917_remove-patch-parts', '20260907192917_remove-patch-parts.ts', '7368d31251b3e9561aa25c2b3ba8b17984daec4adf123d27b301f03fd9d4061d', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907195014, '20260907195014_merge-quote-dig-in-context', '20260907195014_merge-quote-dig-in-context.ts', '25f5410423e7ed6a4b33ff912f5dd7f1890b2fd076146b1837c3ed9de387c978', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907202209, '20260907202209_remove-session-user', '20260907202209_remove-session-user.ts', '352442ad1787859e3d28af9b6801212ad445ff7f2b66a72987e7e55b60a33cb1', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907204003, '20260907204003_remove-binding-rotation-intent', '20260907204003_remove-binding-rotation-intent.ts', 'ea6fca97fa86cca4d7f0bcc5f80679a34ce25b8edb739212446a27e3791e5925', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907204921, '20260907204921_remove-binding-superseded-at', '20260907204921_remove-binding-superseded-at.ts', 'f16e1eb317ba6dfe3e987a18ffe4c07b88af84a2dee1a72ab2607b7dc999fb14', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907210224, '20260907210224_remove-binding-generation', '20260907210224_remove-binding-generation.ts', '9d89a081cb096def9b6adc3f6584dcc5cb42d40a3d3ee9c2aafbda768808db82', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907210439, '20260907210439_remove-part-run', '20260907210439_remove-part-run.ts', '2af471163f6de8137e6628245f91bebeafd1f48c60ce899f6847df95d3b32216', '2026-09-21T16:36:08.261Z');
INSERT INTO app_schema_migrations VALUES (20260907210446, '20260907210446_agent-run-session-fk', '20260907210446_agent-run-session-fk.ts', '76bb789510e696b0213483ca29c932d26b2ff45e30e76963b334b4d2500b5e09', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260907210622, '20260907210622_remove-message-origin', '20260907210622_remove-message-origin.ts', 'ebfe42cbdec479a6c32af632579de4becd29da48e335479cb12ad6fac77c5155', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260907211310, '20260907211310_remove-occurrence-accepted-at', '20260907211310_remove-occurrence-accepted-at.ts', 'd8545b808864c02858d7394989aafa69441bca9e2560f4ca8ef154b0f18cf7aa', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260907222714, '20260907222714_remove-part-session', '20260907222714_remove-part-session.ts', 'c3f7aae993c77bfce4023fc69bd9bd2a759b2a655b230d398468f84379a219ae', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260909011501, '20260909011501_permission-grants', '20260909011501_permission-grants.ts', 'b3e6e6a925deb03a415fe294c667d369071eb3918ebf8470d33c17e7bbdcb21b', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260909024543, '20260909024543_remove-permission-grants', '20260909024543_remove-permission-grants.ts', '6e67bd3216f718a8d8ee8f467e19bbbcf67b8579bd2376f965e86c2fcc03a25b', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260909052543, '20260909052543_restore-permission-grants', '20260909052543_restore-permission-grants.ts', 'd96c661769dbd8b806eb9d8c228dd877ac55424a6a26aa54cb50a0cc5f56c285', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260909173026, '20260909173026_remove-session-permission', '20260909173026_remove-session-permission.ts', 'ee586760b5c42938419ad29be71b6accc2082b788b3f03cdfb3547a3e47fb78f', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260909173537, '20260909173537_rename-tool-provider-metadata', '20260909173537_rename-tool-provider-metadata.ts', 'c8bd492bb93f831bf0e1b7516b987135fa34e1ed1c648f1639b0e4168ece5f47', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260909180043, '20260909180043_remove-pending-tool-raw', '20260909180043_remove-pending-tool-raw.ts', '11b2c02fb921496b9f94adb4f47b9a036e8503e614488dfa59706260aa61d80d', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260910002225, '20260910002225_remove-schedule-user', '20260910002225_remove-schedule-user.ts', '8ea54845519f2b2676181a5cf2f9b8e9f9809fbdc76c9473ffb2a8c39cb96f54', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260910004036, '20260910004036_schedule-hard-delete', '20260910004036_schedule-hard-delete.ts', 'b66a7a50d36ec79fa4a1f473ea27d1ba6ea82fb31baaebd19013864eb517a057', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260910182114, '20260910182114_remove-text-visibility-flags', '20260910182114_remove-text-visibility-flags.ts', '7f299075b93ce898c1ca442dec0ed025a920b0114711dfc9c753436257e9976c', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260911232652, '20260911232652_credential', '20260911232652_credential.ts', '6b8c5c48e7ad30bc896204f1d32064a1870804cdf02cc7b3d489d849619b9eab', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260912183451, '20260912183451_merge-plugin-context', '20260912183451_merge-plugin-context.ts', '2d62f23597cced7d0f9237205ec2cfceba2535cef3139ec6ff88098f5046f839', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260912204736, '20260912204736_plugin-context-hook', '20260912204736_plugin-context-hook.ts', '5bc2377ccea455f074b4f443f9dcdc74c53418b0f09053d468d2366b884e58e7', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260913041915, '20260913041915_credential-owner', '20260913041915_credential-owner.ts', '8fdf17ae03edb5035a1bf3e9ec43a7dc9d6274106fc8e6dd3953f650754c5761', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260913061609, '20260913061609_credential-integration', '20260913061609_credential-integration.ts', 'a5a4d8c14514aff8381b490eabedea5737e74a629d4429041d514493e223fdb4', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260913073313, '20260913073313_credential-encryption', '20260913073313_credential-encryption.ts', '5ec60dc5de182ac358ef015b0d684f05119c488d31df3b3f96e04d0eb4510810', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260915230711, '20260915230711_credential-active', '20260915230711_credential-active.ts', 'caa7dafa7259292fdcb9bda1774475cded0ea5eb77b77241695a4c01da5f15db', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260916223704, '20260916223704_agent-run-stop', '20260916223704_agent-run-stop.ts', '8736103f271a59e6f4e871e47d71c3409dea2fffce79272e886beb732e860ebb', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917014159, '20260917014159_workspace', '20260917014159_workspace.ts', 'e418c6c25f95250aa715238a001b80f220c083be57e2f5b09983121eb2e84858', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917065127, '20260917065127_chart-provider-listings', '20260917065127_chart-provider-listings.ts', '4848938e02ad3e2216276dace07595dc48dedd16b46d18d0128e11e964d26e25', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917065128, '20260917065128_chart-session-coverage', '20260917065128_chart-session-coverage.ts', 'f65a6215936d170e3ddd9a40538ca98547e57bb02b2c2a56ba3ebc64c58148fb', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917065129, '20260917065129_drawing_resource', '20260917065129_drawing_resource.ts', '70fdbf6602a2a8879e5a6421670758437f0e98bf29a0d2fe085584bbb92db2fb', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917065130, '20260917065130_widget-layout', '20260917065130_widget-layout.ts', '914e8849d3bb27fd908551a32a07e2088f585df8358e61957dee23fc3021e8a6', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917172942, '20260917172942_session-kind-chat', '20260917172942_session-kind-chat.ts', '8b0e62b075cb858b836007e6bedc92280f2bdcaefb16743afa134066bc0e92fd', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260917184400, '20260917184400_remove-dig-in-creation-intent', '20260917184400_remove-dig-in-creation-intent.ts', '4a303eaab304c7d8f7afdb9049f5ccb095d501db971f1c2b62334f6bf18e9543', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260918053502, '20260918053502_user-message-workspace', '20260918053502_user-message-workspace.ts', 'c1c3b2cd9841a38ab80a29c6764ad8354668769a7fbc19159819ae37186d79d8', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260918061811, '20260918061811_optional-user-message-workspace', '20260918061811_optional-user-message-workspace.ts', '113701c7600238e9f3cf2b3a1a2abab0e7b18a6119436491b78f7c70deba5f57', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260918214003, '20260918214003_tool-child-session-links', '20260918214003_tool-child-session-links.ts', '7c26a808ff61dcd3bcf86d0af8978619bf6713c2f7056110c43d17ff461b923c', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260920043340, '20260920043340_remove-quote-source', '20260920043340_remove-quote-source.ts', '87e5dbc1d27c77aee48233a00bb9ec550639b5bc4d35e1abca0d47564433d258', '2026-09-21T16:36:08.262Z');
INSERT INTO app_schema_migrations VALUES (20260921025826, '20260921025826_chart-indicators', '20260921025826_chart-indicators.ts', 'a215325f75a9b314171b6ae21c62489701694b68a929f35835ba03970857ca07', '2026-09-22T04:22:17.563Z');
INSERT INTO app_schema_migrations VALUES (20260921183115, '20260921183115_chart-explain-session-kind', '20260921183115_chart-explain-session-kind.ts', 'eeb22ce144b0116e5c66fdcab16f1e9188aa29c925dc910d5529d385017a08eb', '2026-09-22T04:22:17.574Z');
INSERT INTO app_schema_migrations VALUES (20260921210524, '20260921210524_market-series-output', '20260921210524_market-series-output.ts', '2651bb0239a7e4dca196af64771bb755425396b703a6c6135b54f3f444df26d5', '2026-09-22T04:22:17.576Z');
INSERT INTO app_schema_migrations VALUES (20260921231958, '20260921231958_symbology', '20260921231958_symbology.ts', '6ed3cf7e626715ed36e64aaf0dcc145e0247b80397302a555c172b66a5dbf8be', '2026-09-22T04:22:17.577Z');
INSERT INTO app_schema_migrations VALUES (20260922024059, '20260922024059_alert-trigger', '20260922024059_alert-trigger.ts', '5363b268a61b52d64ae2b12ab2cf6e9ba2fbdb6ef0dfe5cef510a58e98652c83', '2026-09-22T04:22:17.577Z');
INSERT INTO app_schema_migrations VALUES (20260923052528, '20260923052528_alertable', '20260923052528_alertable.ts', 'a0ec78212813fad43c8c00ecfcda1a2b1c605ed8dc9dd4fdf6a44338a8ffe968', '2026-09-25T03:33:14.528Z');
INSERT INTO app_schema_migrations VALUES (20260923215852, '20260923215852_drawing-alerts', '20260923215852_drawing-alerts.ts', 'b89f461a30771174dee3411a9cbe2b072e81117562eab9c7e07ce8b260854250', '2026-09-25T03:33:14.530Z');
INSERT INTO app_schema_migrations VALUES (20260924050749, '20260924050749_post-feed', '20260924050749_post-feed.ts', 'd06c916d87c5c4df798b488117778af8c7fe8b0cc3c9316d25e7fedbfb1398db', '2026-09-25T03:33:14.531Z');
INSERT INTO app_schema_migrations VALUES (20260924051721, '20260924051721_drawing-boundary-touching', '20260924051721_drawing-boundary-touching.ts', 'a5a33676b67e5f2fc3ac880e96397ee0cbd0608864f43add539c164add4f965e', '2026-09-25T03:33:14.538Z');
INSERT INTO app_schema_migrations VALUES (20260924152035, '20260924152035_alert-post-subjects', '20260924152035_alert-post-subjects.ts', '6f0166cf7ed94cd67a8be1589a41397bd8db37fa84578241d8d8646a9a75ce81', '2026-09-25T03:33:14.538Z');
INSERT INTO app_schema_migrations VALUES (20260925183938, '20260925183938_drawing-state-constraints', '20260925183938_drawing-state-constraints.ts', '47532ae32cfa0d8b8c7e983e6bf0b4b33a1abfe7a7ca9485420a107fadb6bae1', '2026-09-28T03:15:25.240Z');
INSERT INTO app_schema_migrations VALUES (20260926174200, '20260926174200_post-markdown', '20260926174200_post-markdown.ts', 'fe323a2ed8aa3f5a7e8d4d3af512e5fd72982b9052361ea9d29c3c446c3d683e', '2026-09-28T03:15:25.240Z');
INSERT INTO app_schema_migrations VALUES (20260926175652, '20260926175652_post-without-kind', '20260926175652_post-without-kind.ts', '3fe17541d9fe9f6a62492b39173b94666133e8e541db6d1bcad12b467684db58', '2026-09-28T03:15:25.242Z');
INSERT INTO app_schema_migrations VALUES (20260926184112, '20260926184112_post-character-limit', '20260926184112_post-character-limit.ts', '463a8bd0eb012f9edc67fa97e6d54598dfb29423894213f2ca7a618db609923f', '2026-09-28T03:15:25.243Z');
INSERT INTO app_schema_migrations VALUES (20260927213244, '20260927213244_indicator-resource', '20260927213244_indicator-resource.ts', '618f5039f211b221fd7ec30b3799d6540fe0c856797b1c9227c557f8cb92bceb', '2026-09-28T03:15:25.244Z');
