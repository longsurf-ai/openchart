// Purpose: Applies the 20260922024059_alert-trigger forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260922024059_alert-trigger",
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
          \`source\` text NOT NULL,
          \`config_json\` text NOT NULL,
          CONSTRAINT "alert_rule_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "alert_rule_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "alert_rule_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "alert_rule_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_alert_rules_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_alert_rules_source" CHECK(length("source") BETWEEN 1 AND 65536),
          CONSTRAINT "chk_alert_rules_config_object" CHECK(json_type("config_json") = 'object')
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
          \`template\` text NOT NULL,
          CONSTRAINT "trigger_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "trigger_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "trigger_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "trigger_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_triggers_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_triggers_event_object" CHECK(json_type("event_json") = 'object'),
          CONSTRAINT "chk_triggers_target_object" CHECK(json_type("target_json") = 'object'),
          CONSTRAINT "chk_triggers_template" CHECK(length("template") >= 1)
        );
      `);
      yield* tx.run(
        'CREATE INDEX `idx_alert_events_created` ON `alert_event` ("created_at" desc,"id" desc);',
      );
      yield* tx.run(
        "CREATE INDEX `idx_alert_events_rule` ON `alert_event` (`rule_id`,`created_at`,`id`);",
      );
    });
  },
};

export default migration;
