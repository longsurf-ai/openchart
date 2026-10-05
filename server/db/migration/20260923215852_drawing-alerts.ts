// Purpose: Applies the 20260923215852_drawing-alerts forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260923215852_drawing-alerts",
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
      // Parent replacement cascades inside the runner's transaction. Keep the
      // exact event rows; foreign_keys cannot be disabled within a transaction.
      yield* tx.run(
        "CREATE TEMP TABLE drawing_alert_event_backup AS SELECT * FROM alert_event",
      );
      yield* tx.run(`
        CREATE TABLE \`__new_alert_rule\` (
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
                AND json_extract("alertable_json", '$.operator') IN ('crossing', 'crossing_up', 'crossing_down', 'entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel')
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
      `);
      yield* tx.run(
        "INSERT INTO `__new_alert_rule`(`id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `repeat`, `alertable_json`) SELECT `id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `repeat`, `alertable_json` FROM `alert_rule`;",
      );
      yield* tx.run("DROP TABLE `alert_rule`;");
      yield* tx.run("ALTER TABLE `__new_alert_rule` RENAME TO `alert_rule`;");
      // Clear first so this also works for callers with foreign keys disabled.
      yield* tx.run("DELETE FROM alert_event");
      yield* tx.run(
        "INSERT INTO alert_event SELECT * FROM drawing_alert_event_backup",
      );
      yield* tx.run("DROP TABLE drawing_alert_event_backup");
    });
  },
};

export default migration;
