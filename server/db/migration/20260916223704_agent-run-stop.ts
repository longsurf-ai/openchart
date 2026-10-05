// Purpose: Applies the 20260916223704_agent-run-stop forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260916223704_agent-run-stop",
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
        CREATE TABLE \`__new_agent_run\` (
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
      yield* tx.run(
        "INSERT INTO `__new_agent_run`(`id`, `session_id`, `session_intent_id`, `input`, `status`, `queue_position`, `created_at`, `started_at`, `finished_at`) SELECT `id`, `session_id`, `session_intent_id`, `input`, `status`, `queue_position`, `created_at`, `started_at`, `finished_at` FROM `agent_run`;",
      );
      // Preserve incoming Occurrence references while foreign keys stay enabled.
      // The runner transaction restores both tables if rebuilding fails.
      yield* tx.run(`
        CREATE TEMP TABLE __agent_run_occurrences AS
        SELECT * FROM agent_schedule_occurrence;
      `);
      yield* tx.run("DELETE FROM agent_schedule_occurrence;");
      yield* tx.run("DROP TABLE `agent_run`;");
      yield* tx.run("ALTER TABLE `__new_agent_run` RENAME TO `agent_run`;");
      yield* tx.run(`
        INSERT INTO agent_schedule_occurrence
          (id, revision, created_at, updated_at, schedule_id, agent_run_id, fire_at)
        SELECT id, revision, created_at, updated_at, schedule_id, agent_run_id, fire_at
        FROM __agent_run_occurrences;
      `);
      yield* tx.run("DROP TABLE __agent_run_occurrences;");
      yield* tx.run(
        "CREATE UNIQUE INDEX `agent_run_session_intent_idx` ON `agent_run` (`session_intent_id`);",
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
    });
  },
};

export default migration;
