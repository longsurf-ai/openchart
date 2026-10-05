// Purpose: Applies the 20260907210446_agent-run-session-fk forward-only SQLite migration.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260907210446_agent-run-session-fk',
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
      const [orphan] = yield* tx.all<{id: string; session_id: string}>(sql`
        SELECT run.id, run.session_id FROM agent_run AS run
        LEFT JOIN agent_sessions AS session ON session.id = run.session_id
        WHERE session.id IS NULL LIMIT 1
      `);
      if (orphan) {
        return yield* Effect.die(
          `Cannot add Run Session FK: run ${orphan.id} references missing session ${orphan.session_id}`,
        );
      }
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
          CONSTRAINT "agent_run_status_check" CHECK("status" IN ('queued', 'running', 'completed', 'failed')),
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
                "status" IN ('completed', 'failed')
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
        'INSERT INTO `__new_agent_run`(`id`, `session_id`, `session_intent_id`, `input`, `status`, `queue_position`, `created_at`, `started_at`, `finished_at`) SELECT `id`, `session_id`, `session_intent_id`, `input`, `status`, `queue_position`, `created_at`, `started_at`, `finished_at` FROM `agent_run`;',
      );
      // @agent invariant: Keep incoming Occurrence references and every row value
      // intact while rebuilding their parent with foreign keys still enabled.
      // The runner transaction restores both tables if any step fails.
      yield* tx.run(`
        CREATE TEMP TABLE __agent_run_occurrences AS
        SELECT * FROM agent_schedule_occurrence;
      `);
      yield* tx.run('DELETE FROM agent_schedule_occurrence;');
      yield* tx.run('DROP TABLE `agent_run`;');
      yield* tx.run('ALTER TABLE `__new_agent_run` RENAME TO `agent_run`;');
      yield* tx.run(`
        INSERT INTO agent_schedule_occurrence
          (id, revision, created_at, updated_at, schedule_id, agent_run_id, fire_at, accepted_at)
        SELECT id, revision, created_at, updated_at, schedule_id, agent_run_id, fire_at, accepted_at
        FROM __agent_run_occurrences;
      `);
      yield* tx.run('DROP TABLE __agent_run_occurrences;');
      yield* tx.run(
        'CREATE UNIQUE INDEX `agent_run_session_intent_idx` ON `agent_run` (`session_intent_id`);',
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
