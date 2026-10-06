// Purpose: Applies the 20261006040216_native-listing-identity forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261006040216_native-listing-identity",
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
      yield* tx.run("PRAGMA foreign_keys=OFF;");
      yield* tx.run(`
        CREATE TABLE \`__new_symbology\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          \`listing_key\` text GENERATED ALWAYS AS (case when json_extract(listing, '$.id') is not null then json_array(json_extract(listing, '$.id')) else json_array(json_extract(listing, '$.symbol'), json_extract(listing, '$.venue')) end) STORED NOT NULL,
          CONSTRAINT "symbology_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "symbology_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "symbology_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "symbology_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "symbology_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "symbology_listing_check" CHECK(json_valid("listing") AND json_type("listing") = 'object')
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_symbology`(`id`, `revision`, `created_at`, `updated_at`, `provider`, `listing`) SELECT `id`, `revision`, `created_at`, `updated_at`, `provider`, `listing` FROM `symbology`;",
      );
      yield* tx.run("DROP TABLE `symbology`;");
      yield* tx.run("ALTER TABLE `__new_symbology` RENAME TO `symbology`;");
      yield* tx.run("PRAGMA foreign_keys=ON;");
      yield* tx.run("DROP INDEX IF EXISTS `drawing_scope_gesture_unique`;");
      yield* tx.run(
        "CREATE UNIQUE INDEX `symbology_provider_listing_unique` ON `symbology` (`provider`,`listing_key`);",
      );
      yield* tx.run(
        "CREATE INDEX `symbology_created_id_index` ON `symbology` (`created_at`,`id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `drawing_listing_gesture_unique` ON `drawing` (`dashboard_id`,`provider`,case when json_extract(\"listing\", '$.id') is not null then json_array(json_extract(\"listing\", '$.id')) else json_array(json_extract(\"listing\", '$.symbol'), json_extract(\"listing\", '$.venue')) end,json_extract(\"data\", '$.id'));",
      );
    });
  },
};

export default migration;
