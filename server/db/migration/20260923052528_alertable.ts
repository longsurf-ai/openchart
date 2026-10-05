// Purpose: Applies the 20260923052528_alertable forward-only SQLite migration.

import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260923052528_alertable",
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
      // Parent replacement cascades even with deferred FKs. Preserve every event
      // before the generated rebuild; foreign_keys cannot be changed inside a Tx.
      yield* tx.run(
        "CREATE TEMP TABLE alertable_event_backup AS SELECT * FROM alert_event",
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
                AND json_extract("alertable_json", '$.kind') IS 'tea'
                AND json_type("alertable_json", '$.source') IS 'text'
                AND length(json_extract("alertable_json", '$.source')) BETWEEN 1 AND 65536
                AND json_type("alertable_json", '$.config') IS 'object')
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_alert_rule`(`id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `repeat`, `alertable_json`) SELECT `id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `repeat`, json_object('kind','tea','source',source,'config',json(config_json)) FROM `alert_rule`;",
      );
      yield* tx.run("DROP TABLE `alert_rule`;");
      yield* tx.run("ALTER TABLE `__new_alert_rule` RENAME TO `alert_rule`;");
      // Also works when the caller's connection has foreign keys disabled.
      yield* tx.run("DELETE FROM alert_event");
      yield* tx.run(`
        INSERT INTO alert_event (id, revision, created_at, updated_at, rule_id, condition, time, detail_json)
        SELECT id, revision, created_at, updated_at, rule_id, condition, time,
          json_object(
            'title', json_extract(detail_json, '$.alert.title'),
            'message', json_extract(detail_json, '$.alert.message'),
            'data', json_object(
              'inputs', json_extract(detail_json, '$.inputs'),
              'parameters', json_extract(detail_json, '$.parameters'),
              'values', json_extract(detail_json, '$.values'),
              'symbol', json_extract(detail_json, '$.inputs.listing.symbol'),
              'provider', json_extract(detail_json, '$.inputs.provider'),
              'resolution', json_extract(detail_json, '$.inputs.resolution')
            )
          )
        FROM alertable_event_backup
      `);
      yield* tx.run("DROP TABLE alertable_event_backup");
      const targets = yield* tx.all<{
        id: string;
        target_json: string;
        template: string;
      }>("SELECT id, target_json, template FROM trigger");
      for (const row of targets) {
        const target = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.JsonObject),
        )(row.target_json);
        // Old templates recognized every {word}, including after a backslash.
        // Escape only literal segments so that substitution remains identical.
        const message = row.template.replace(/\{\w+\}|[\\{}]/g, (part) =>
          /^\{\w+\}$/.test(part) ? part : `\\${part}`,
        );
        let next: Schema.JsonObject;
        if (target.kind === "notification") {
          next = { ...target, message };
        } else if (target.kind === "agent_prompt") {
          const prompt = yield* Schema.decodeUnknownEffect(Schema.JsonObject)(
            target.prompt,
          );
          const original = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.JsonObject),
          )(prompt.parts);
          const parts: Schema.JsonObject[] = [];
          for (const part of original) {
            if (part.type === "text") {
              const text = yield* Schema.decodeUnknownEffect(Schema.String)(
                part.text,
              );
              parts.push({ ...part, text: text.replace(/[\\{}]/g, "\\$&") });
            } else {
              parts.push(part);
            }
          }
          next = {
            ...target,
            prompt: {
              ...prompt,
              parts: [...parts, { type: "text", text: message }],
            },
          };
        } else {
          return yield* Effect.die(
            `Unsupported stored Trigger target: ${String(target.kind)}`,
          );
        }
        yield* tx.run(
          sql`UPDATE trigger SET target_json = ${JSON.stringify(next)} WHERE id = ${row.id}`,
        );
      }

      yield* tx.run(`
        CREATE TABLE \`__new_trigger\` (
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
      yield* tx.run(
        "INSERT INTO `__new_trigger`(`id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `event_json`, `target_json`) SELECT `id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `event_json`, `target_json` FROM `trigger`;",
      );
      yield* tx.run("DROP TABLE `trigger`;");
      yield* tx.run("ALTER TABLE `__new_trigger` RENAME TO `trigger`;");
    });
  },
};

export default migration;
