// Purpose: Applies the 20260915230711_credential-active forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '@openchart/server/db/migration';

const migration: DatabaseMigration.Migration = {
  id: '20260915230711_credential-active',
  /**
   * Preserves ciphertext and existing access: the old active column was ignored,
   * so every predecessor credential starts enabled. No host key is needed.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`__new_credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer DEFAULT true NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT "credential_active_boolean" CHECK("active" IN (0, 1))
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_credential`(`id`, `integration_id`, `label`, `value`, `connector_id`, `method_id`, `active`, `time_created`, `time_updated`) SELECT `id`, `integration_id`, `label`, `value`, `connector_id`, `method_id`, 1, `time_created`, `time_updated` FROM `credential`;',
      );
      yield* tx.run('DROP TABLE `credential`;');
      yield* tx.run('ALTER TABLE `__new_credential` RENAME TO `credential`;');
    });
  },
};

export default migration;
