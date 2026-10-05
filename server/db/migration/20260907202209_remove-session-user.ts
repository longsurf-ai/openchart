// Purpose: Applies the 20260907202209_remove-session-user forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907202209_remove-session-user',
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
      yield* tx.run('DROP INDEX IF EXISTS `idx_agent_sessions_user_updated`;');
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_updated` ON `agent_sessions` (`updated_at`);',
      );
      yield* tx.run('ALTER TABLE `agent_sessions` DROP COLUMN `user_id`;');
    });
  },
};

export default migration;
