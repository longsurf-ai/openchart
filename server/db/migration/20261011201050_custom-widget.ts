// Purpose: Applies the 20261011201050_custom-widget forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261011201050_custom-widget",
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
        CREATE TABLE \`custom_widget\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`kind\` text NOT NULL CONSTRAINT \`custom_widget_kind_unique\` UNIQUE,
          \`title\` text NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          CONSTRAINT "custom_widget_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "custom_widget_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "custom_widget_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "custom_widget_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "custom_widget_kind_check" CHECK(length("kind") BETWEEN 1 AND 64 AND "kind" GLOB '[a-z]*' AND "kind" NOT GLOB '*[^a-z0-9-]*'),
          CONSTRAINT "custom_widget_title_check" CHECK(length(trim("title")) > 0 AND length("title") <= 80),
          CONSTRAINT "custom_widget_workspace_check" CHECK(length("workspace_id") > 0),
          CONSTRAINT "custom_widget_path_check" CHECK(substr("path", -11) = '.widget.tsx')
        );
      `);
    });
  },
};

export default migration;
