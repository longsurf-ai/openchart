// Purpose: Applies the 20260921231958_symbology forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260921231958_symbology",
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
        CREATE TABLE \`symbology\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          \`listing_key\` text GENERATED ALWAYS AS (json_array(json_extract(listing, '$.symbol'), json_extract(listing, '$.venue'))) STORED NOT NULL,
          CONSTRAINT "symbology_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "symbology_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "symbology_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "symbology_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "symbology_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "symbology_listing_check" CHECK(json_valid("listing") AND json_type("listing") = 'object')
        );
      `);
      yield* tx.run(
        "CREATE UNIQUE INDEX `symbology_provider_listing_unique` ON `symbology` (`provider`,`listing_key`);",
      );
      yield* tx.run(
        "CREATE INDEX `symbology_created_id_index` ON `symbology` (`created_at`,`id`);",
      );
    });
  },
};

export default migration;
