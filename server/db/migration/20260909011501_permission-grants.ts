// Purpose: Applies the 20260909011501_permission-grants forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260909011501_permission-grants',
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
        CREATE TABLE \`agent_permission_grants\` (
          \`id\` text PRIMARY KEY,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
        );
      `);
      yield* tx.run(
        'CREATE UNIQUE INDEX `uniq_agent_permission_grants_action_resource` ON `agent_permission_grants` (`action`,`resource`);',
      );
    });
  },
};

export default migration;
