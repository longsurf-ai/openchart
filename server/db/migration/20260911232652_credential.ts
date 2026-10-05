// Purpose: Applies the 20260911232652_credential forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260911232652_credential',
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
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `);
    });
  },
};

export default migration;
