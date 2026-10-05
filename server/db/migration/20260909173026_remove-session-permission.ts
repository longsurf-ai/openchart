// Purpose: Applies the 20260909173026_remove-session-permission forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260909173026_remove-session-permission',
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
      yield* tx.run('ALTER TABLE `agent_sessions` DROP COLUMN `permission`;');
    });
  },
};

export default migration;
