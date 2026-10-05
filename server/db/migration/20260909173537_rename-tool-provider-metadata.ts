// Purpose: Renames ToolPart provider metadata while preserving tool execution state.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260909173537_rename-tool-provider-metadata',
  /**
   * Renames the outer ToolPart metadata key inside the runner-owned transaction.
   * @example
   * yield* migration.up(transaction);
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE agent_parts
        SET data = json_remove(
          json_set(data, '$.providerMetadata', json_extract(data, '$.metadata')),
          '$.metadata'
        )
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_type(data, '$.metadata') IS NOT NULL;
      `);
    });
  },
};

export default migration;
