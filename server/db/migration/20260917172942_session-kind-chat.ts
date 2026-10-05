// Purpose: Applies the 20260917172942_session-kind-chat forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260917172942_session-kind-chat",
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
        CREATE TABLE \`__new_agent_sessions\` (
          \`id\` text PRIMARY KEY,
          \`parent_id\` text,
          \`kind\` text NOT NULL,
          \`binding_id\` text,
          \`anchors\` text,
          \`title\` text NOT NULL,
          \`compacting_at\` integer,
          \`archived_at\` integer,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_sessions_binding_id_agent_session_bindings_id_fk\` FOREIGN KEY (\`binding_id\`) REFERENCES \`agent_session_bindings\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "agent_sessions_kind_check" CHECK("kind" in ('chat', 'delegate', 'dig_in', 'alert', 'scheduled'))
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_agent_sessions`(`id`, `parent_id`, `kind`, `binding_id`, `anchors`, `title`, `compacting_at`, `archived_at`, `created_at`, `updated_at`) SELECT `id`, `parent_id`, COALESCE(`kind`, 'chat'), `binding_id`, `anchors`, `title`, `compacting_at`, `archived_at`, `created_at`, `updated_at` FROM `agent_sessions`;",
      );
      // Preserve incoming references with foreign keys enabled in the runner transaction.
      const dependents = [
        "agent_messages",
        "agent_parts",
        "agent_todos",
        "agent_run",
        "agent_schedule_occurrence",
      ];
      for (const table of dependents) {
        yield* tx.run(
          `CREATE TEMP TABLE __session_kind_${table} AS SELECT * FROM ${table}`,
        );
      }
      for (const table of [...dependents].reverse()) {
        yield* tx.run(`DELETE FROM ${table}`);
      }
      yield* tx.run("DROP TABLE `agent_sessions`;");
      yield* tx.run(
        "ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;",
      );
      for (const table of dependents) {
        yield* tx.run(
          `INSERT INTO ${table} SELECT * FROM __session_kind_${table}`,
        );
        yield* tx.run(`DROP TABLE __session_kind_${table}`);
      }
      if ((yield* tx.all("PRAGMA foreign_key_check")).length > 0) {
        return yield* Effect.die(
          "Session kind migration left invalid foreign keys",
        );
      }
      yield* tx.run(
        "CREATE INDEX `idx_agent_sessions_updated` ON `agent_sessions` (`updated_at`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_sessions_parent` ON `agent_sessions` (`parent_id`);",
      );
      yield* tx.run(
        "CREATE INDEX `idx_agent_sessions_binding` ON `agent_sessions` (`binding_id`,`created_at`,`id`);",
      );
    });
  },
};

export default migration;
