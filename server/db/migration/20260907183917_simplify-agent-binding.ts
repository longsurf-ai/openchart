// Purpose: Applies the 20260907183917_simplify-agent-binding forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907183917_simplify-agent-binding',
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
      yield* tx.run(
        'ALTER TABLE `agent_session_bindings` RENAME COLUMN `feature_key` TO `key`;',
      );
      // Sessions retain their binding IDs while the referenced table is rebuilt.
      // Foreign keys cannot be disabled inside the runner-owned transaction.
      yield* tx.run('PRAGMA defer_foreign_keys=ON;');
      yield* tx.run(`
        CREATE TABLE \`__new_agent_session_bindings\` (
          \`id\` text PRIMARY KEY,
          \`key\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT "chk_agent_session_bindings_key" CHECK(trim("key") <> '')
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_agent_session_bindings`(`id`, `key`, `created_at`, `updated_at`) SELECT `id`, `surface` || ':' || `key`, `created_at`, `updated_at` FROM `agent_session_bindings`;",
      );
      yield* tx.run('DROP TABLE `agent_session_bindings`;');
      yield* tx.run(
        'ALTER TABLE `__new_agent_session_bindings` RENAME TO `agent_session_bindings`;',
      );
      yield* tx.run(
        'DROP INDEX IF EXISTS `uniq_agent_session_bindings_identity`;',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `uniq_agent_session_bindings_key` ON `agent_session_bindings` (`key`);',
      );
      yield* tx.run(`
        UPDATE agent_schedule
        SET target_json = json_set(target_json, '$.binding', json_object(
          'key', json_extract(target_json, '$.binding.surface') || ':' ||
            json_extract(target_json, '$.binding.key')
        ))
        WHERE json_type(target_json, '$.binding') = 'object';
      `);
      // SQLite retains deferred violations from dropping the old parent table
      // even after its replacement restores every ID. Check the final graph
      // before clearing those counters and restoring immediate enforcement.
      if ((yield* tx.all('PRAGMA foreign_key_check;')).length > 0) {
        return yield* Effect.die('Binding migration left invalid foreign keys');
      }
      yield* tx.run('PRAGMA defer_foreign_keys=OFF;');
    });
  },
};

export default migration;
