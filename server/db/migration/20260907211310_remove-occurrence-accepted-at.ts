// Purpose: Applies the 20260907211310_remove-occurrence-accepted-at forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '@openchart/server/db/migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907211310_remove-occurrence-accepted-at',
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
      // @agent invariant: The envelope retains the original acceptance time.
      yield* tx.run(
        'UPDATE `agent_schedule_occurrence` SET `created_at` = `accepted_at`;',
      );
      yield* tx.run(
        'ALTER TABLE `agent_schedule_occurrence` DROP COLUMN `accepted_at`;',
      );
    });
  },
};

export default migration;
