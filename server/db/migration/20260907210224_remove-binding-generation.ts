// Purpose: Applies the 20260907210224_remove-binding-generation forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260907210224_remove-binding-generation',
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
      // @agent invariant: Rebuilding sessions must preserve their messages,
      // Parts, and todos. Foreign keys stay enabled inside the runner's
      // transaction; save dependents before the parent table is replaced.
      yield* tx.run(
        'CREATE TEMP TABLE __binding_generation_messages AS SELECT * FROM agent_messages;',
      );
      yield* tx.run(
        'CREATE TEMP TABLE __binding_generation_parts AS SELECT * FROM agent_parts;',
      );
      yield* tx.run(
        'CREATE TEMP TABLE __binding_generation_todos AS SELECT * FROM agent_todos;',
      );
      yield* tx.run('DELETE FROM agent_parts;');
      yield* tx.run('DELETE FROM agent_messages;');
      yield* tx.run('DELETE FROM agent_todos;');
      yield* tx.run(`
        CREATE TABLE \`__new_agent_sessions\` (
          \`id\` text PRIMARY KEY,
          \`parent_id\` text,
          \`kind\` text,
          \`binding_id\` text,
          \`anchors\` text,
          \`title\` text NOT NULL,
          \`permission\` text,
          \`compacting_at\` integer,
          \`archived_at\` integer,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_sessions_binding_id_agent_session_bindings_id_fk\` FOREIGN KEY (\`binding_id\`) REFERENCES \`agent_session_bindings\`(\`id\`) ON DELETE RESTRICT
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_agent_sessions`(`id`, `parent_id`, `kind`, `binding_id`, `anchors`, `title`, `permission`, `compacting_at`, `archived_at`, `created_at`, `updated_at`) SELECT `id`, `parent_id`, `kind`, `binding_id`, `anchors`, `title`, `permission`, `compacting_at`, `archived_at`, `created_at`, `updated_at` FROM `agent_sessions`;',
      );
      yield* tx.run('DROP TABLE `agent_sessions`;');
      yield* tx.run(
        'ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;',
      );
      yield* tx.run(
        'DROP INDEX IF EXISTS `uniq_agent_sessions_binding_generation`;',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_updated` ON `agent_sessions` (`updated_at`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_parent` ON `agent_sessions` (`parent_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_sessions_binding` ON `agent_sessions` (`binding_id`,`created_at`,`id`);',
      );
      yield* tx.run(
        'INSERT INTO agent_messages SELECT * FROM __binding_generation_messages;',
      );
      yield* tx.run(
        'INSERT INTO agent_parts SELECT * FROM __binding_generation_parts;',
      );
      yield* tx.run(
        'INSERT INTO agent_todos SELECT * FROM __binding_generation_todos;',
      );
      yield* tx.run('DROP TABLE __binding_generation_parts;');
      yield* tx.run('DROP TABLE __binding_generation_messages;');
      yield* tx.run('DROP TABLE __binding_generation_todos;');
    });
  },
};

export default migration;
