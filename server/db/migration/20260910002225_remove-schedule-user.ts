// Purpose: Applies the 20260910002225_remove-schedule-user forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '@openchart/server/db/migration';

const migration: DatabaseMigration.Migration = {
  id: '20260910002225_remove-schedule-user',
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
      // Keep the Schedule table and its incoming Occurrence foreign keys intact.
      yield* tx.run('DROP INDEX IF EXISTS `idx_agent_schedules_user_updated`;');
      yield* tx.run(
        'CREATE INDEX `idx_agent_schedules_updated` ON `agent_schedule` ("updated_at" desc);',
      );
      yield* tx.run('ALTER TABLE `agent_schedule` DROP COLUMN `user_id`;');
    });
  },
};

export default migration;
