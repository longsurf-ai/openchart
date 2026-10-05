// Purpose: Removes tool display payloads while preserving delegated child session relationships.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {Effect} from 'effect';

const migration: DatabaseMigration.Migration = {
  id: '20260907185415_remove-tool-display-data',
  /**
   * Lifts task child session IDs and removes display data in the runner's transaction.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      const invalid = yield* tx.all(`
        SELECT id FROM agent_parts
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_extract(data, '$.displayData.details.tool') = 'task'
          AND json_type(data, '$.displayData.details.sessionId') IS NOT NULL
          AND (
            json_type(data, '$.displayData.details.sessionId') <> 'text'
            OR length(json_extract(data, '$.displayData.details.sessionId')) = 0
          );
      `);
      if (invalid.length > 0) {
        return yield* Effect.die(
          'Tool display data contains invalid child session IDs',
        );
      }
      yield* tx.run(`
        UPDATE agent_parts
        SET data = json_remove(
          CASE
            WHEN json_extract(data, '$.displayData.details.tool') = 'task'
              AND json_type(data, '$.displayData.details.sessionId') = 'text'
            THEN json_set(data, '$.childSessionId',
              json_extract(data, '$.displayData.details.sessionId'))
            ELSE data
          END,
          '$.displayData'
        )
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_type(data, '$.displayData') IS NOT NULL;
      `);
    });
  },
};

export default migration;
