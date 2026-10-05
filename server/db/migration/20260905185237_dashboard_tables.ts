// Purpose: Applies the 20260905185237_dashboard_tables forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260905185237_dashboard_tables',
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
      // Preserve the old JSON rows until both relational tables are populated.
      // Foreign keys stay enabled throughout the runner-owned transaction.
      yield* tx.run('ALTER TABLE `dashboard` RENAME TO `__old_dashboard`;');
      yield* tx.run(`
        CREATE TABLE \`dashboard\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          \`name\` text NOT NULL,
          \`favorite\` integer DEFAULT false NOT NULL,
          CONSTRAINT "dashboard_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "dashboard_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "dashboard_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "dashboard_name_check" CHECK(length("name") BETWEEN 1 AND 200),
          CONSTRAINT "dashboard_favorite_check" CHECK("favorite" IN (0, 1))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`dashboard_widget\` (
          \`id\` text PRIMARY KEY,
          \`dashboard_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`resource_id\` text,
          CONSTRAINT \`fk_dashboard_widget_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`dashboard_widget_position_unique\` UNIQUE(\`dashboard_id\`,\`position\`),
          CONSTRAINT "dashboard_widget_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_widget_position_check" CHECK("position" >= 0),
          CONSTRAINT "dashboard_widget_kind_check" CHECK(length("kind") > 0),
          CONSTRAINT "dashboard_widget_resource_id_check" CHECK("resource_id" IS NULL OR length("resource_id") > 0)
        );
      `);
      yield* tx.run(`
        INSERT INTO dashboard (id, revision, created_at, updated_at, name, favorite)
        SELECT id, revision, created_at, updated_at,
          json_extract(value, '$.name'), json_extract(value, '$.favorite')
        FROM __old_dashboard;
      `);
      yield* tx.run(`
        INSERT INTO dashboard_widget (id, dashboard_id, position, kind, resource_id)
        SELECT json_extract(widget.value, '$.id'), dashboard.id, widget.key,
          json_extract(widget.value, '$.kind'),
          json_extract(widget.value, '$.resourceId')
        FROM __old_dashboard AS dashboard, json_each(dashboard.value, '$.widgets') AS widget;
      `);
      yield* tx.run('DROP TABLE `__old_dashboard`;');
    });
  },
};

export default migration;
