// Purpose: Removes the obsolete assistant mode alias while preserving message content.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260907190439_remove-assistant-mode',
  /**
   * Removes only the assistant mode alias inside the runner-owned transaction.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE agent_messages
        SET data = json_remove(data, '$.mode')
        WHERE role = 'assistant'
          AND json_type(data, '$.mode') IS NOT NULL;
      `);
    });
  },
};

export default migration;
