// Purpose: Applies the 20260905180427_dashboard forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260905180427_dashboard',
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
        CREATE TABLE \`dashboard\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          \`value\` text NOT NULL,
          CONSTRAINT "dashboard_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "dashboard_value_check" CHECK(json_valid("value") AND json_type("value") = 'object')
        );
      `);
    });
  },
};

export default migration;
