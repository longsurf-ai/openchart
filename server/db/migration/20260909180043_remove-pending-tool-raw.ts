// Purpose: Removes unused raw input fragments from persisted pending tool Parts.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260909180043_remove-pending-tool-raw',
  /**
   * Removes only pending ToolPart state.raw, preserving input and metadata.
   * @example
   * yield* migration.up(transaction);
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE agent_parts
        SET data = json_remove(data, '$.state.raw')
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_extract(data, '$.state.status') = 'pending'
          AND json_type(data, '$.state.raw') IS NOT NULL;
      `);
    });
  },
};

export default migration;
