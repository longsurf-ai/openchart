// Purpose: Renames the assistant's triggering user message reference without changing its identity.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260907191229_rename-assistant-trigger',
  /**
   * Renames the assistant reference inside the runner-owned transaction.
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
        SET data = json_remove(
          json_set(data, '$.triggeringUserMessageID', json_extract(data, '$.parentID')),
          '$.parentID'
        )
        WHERE role = 'assistant'
          AND json_type(data, '$.parentID') IS NOT NULL;
      `);
    });
  },
};

export default migration;
