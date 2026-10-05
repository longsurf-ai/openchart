// Purpose: Applies the 20260906005122_tea-script forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260906005122_tea-script',
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
        CREATE TABLE \`tea_script\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`draft_source\` text NOT NULL,
          \`current_version_id\` text,
          CONSTRAINT \`tea_script_current_version_fk\` FOREIGN KEY (\`id\`,\`current_version_id\`) REFERENCES \`tea_script_version\`(\`script_id\`,\`version_id\`),
          CONSTRAINT "tea_script_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "tea_script_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "tea_script_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "tea_script_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "tea_script_name_check" CHECK(length("name") BETWEEN 1 AND 200),
          CONSTRAINT "tea_script_current_version_id_check" CHECK("current_version_id" IS NULL OR length("current_version_id") > 0)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`tea_script_version\` (
          \`script_id\` text NOT NULL,
          \`version_id\` text NOT NULL,
          \`source\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`tea_script_version_pk\` PRIMARY KEY(\`script_id\`, \`version_id\`),
          CONSTRAINT \`fk_tea_script_version_script_id_tea_script_id_fk\` FOREIGN KEY (\`script_id\`) REFERENCES \`tea_script\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "tea_script_version_id_check" CHECK(length("version_id") > 0),
          CONSTRAINT "tea_script_version_created_at_check" CHECK("created_at" >= 0)
        );
      `);
    });
  },
};

export default migration;
