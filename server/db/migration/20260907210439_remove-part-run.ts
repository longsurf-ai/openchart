// Purpose: Applies the 20260907210439_remove-part-run forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907210439_remove-part-run',
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
      yield* tx.run('DROP INDEX IF EXISTS `idx_agent_parts_run`;');
      yield* tx.run('ALTER TABLE `agent_parts` DROP COLUMN `run_id`;');
    });
  },
};

export default migration;
