// Purpose: Applies the 20260904190853_agent-run forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260904190853_agent-run',
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
