// Purpose: Applies the 20260917014159_workspace forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260917014159_workspace",
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
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`root\` text NOT NULL UNIQUE,
          CONSTRAINT "workspace_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "workspace_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "workspace_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "workspace_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "workspace_root_check" CHECK(length("root") > 0)
        );
      `);
      yield* tx.run("DROP TABLE `tea_script`;");
      yield* tx.run("DROP TABLE `tea_script_version`;");
    });
  },
};

export default migration;
