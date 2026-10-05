// Purpose: Applies the 20260917065129_drawing_resource forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260917065129_drawing_resource",
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
        CREATE TABLE \`drawing\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`dashboard_id\` text NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_drawing_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "drawing_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "drawing_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "drawing_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "drawing_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "drawing_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "drawing_listing_check" CHECK(json_valid("listing")),
          CONSTRAINT "drawing_data_check" CHECK(json_valid("data"))
        );
      `);
      yield* tx.run(
        "CREATE INDEX `drawing_dashboard_provider_index` ON `drawing` (`dashboard_id`,`provider`);",
      );
    });
  },
};

export default migration;
