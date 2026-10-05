// Purpose: Applies the 20260907204921_remove-binding-superseded-at forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907204921_remove-binding-superseded-at',
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
      yield* tx.run(
        'DROP INDEX IF EXISTS `uniq_agent_sessions_binding_current`;',
      );
      yield* tx.run(
        'ALTER TABLE `agent_sessions` DROP COLUMN `binding_superseded_at`;',
      );
    });
  },
};

export default migration;
