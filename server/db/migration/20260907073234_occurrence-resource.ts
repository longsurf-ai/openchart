// Purpose: Applies the 20260907073234_occurrence-resource forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907073234_occurrence-resource',
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
      // SQLite cannot add nonconstant timestamp defaults to a populated table.
      // Rebuild this leaf table with its outgoing foreign keys still enforced.
      yield* tx.run(`
        CREATE TABLE \`agent_schedule_occurrence\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`schedule_id\` text NOT NULL,
          \`agent_run_id\` text NOT NULL,
          \`fire_at\` integer NOT NULL,
          \`accepted_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_schedule_occurrence_schedule_id_agent_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`agent_schedule\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_agent_schedule_occurrence_agent_run_id_agent_run_id_fk\` FOREIGN KEY (\`agent_run_id\`) REFERENCES \`agent_run\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "agent_schedule_occurrence_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "agent_schedule_occurrence_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "agent_schedule_occurrence_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "agent_schedule_occurrence_updated_at_check" CHECK("updated_at" >= 0)
        );
      `);
      // Acceptance is the existing row's creation fact. Preserve positive
      // revisions and only translate the old initial revision from zero to one.
      yield* tx.run(`
        INSERT INTO agent_schedule_occurrence
          (id, revision, created_at, updated_at, schedule_id, agent_run_id, fire_at, accepted_at)
        SELECT id, CASE WHEN revision = 0 THEN 1 ELSE revision END,
          accepted_at, accepted_at, schedule_id, agent_run_id, fire_at, accepted_at
        FROM agent_schedule_occurrences;
      `);
      yield* tx.run('DROP TABLE `agent_schedule_occurrences`;');
      yield* tx.run(
        'CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_slot` ON `agent_schedule_occurrence` (`schedule_id`,`fire_at`);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uq_agent_schedule_occurrences_run` ON `agent_schedule_occurrence` (`agent_run_id`);',
      );
    });
  },
};

export default migration;
