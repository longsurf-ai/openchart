// Purpose: Removes obsolete file-change audit Parts while preserving the rest of each transcript.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260907192917_remove-patch-parts',
  /**
   * Deletes only patch Parts inside the runner-owned transaction.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        DELETE FROM agent_parts
        WHERE json_extract(data, '$.type') = 'patch';
      `);
    });
  },
};

export default migration;
