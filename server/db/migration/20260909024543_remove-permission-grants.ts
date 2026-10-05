// Purpose: Applies the 20260909024543_remove-permission-grants forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260909024543_remove-permission-grants',
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
        'DROP INDEX IF EXISTS `uniq_agent_permission_grants_action_resource`;',
      );
      yield* tx.run('DROP TABLE `agent_permission_grants`;');
    });
  },
};

export default migration;
