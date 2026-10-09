// Purpose: Applies the 20261009193152_nested-watchlist-sections forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261009193152_nested-watchlist-sections",
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
        CREATE TABLE \`watchlist_item\` (
          \`id\` text PRIMARY KEY,
          \`watchlist_id\` text NOT NULL,
          \`section_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`provider\` text NOT NULL,
          \`listing\` text NOT NULL,
          CONSTRAINT \`watchlist_item_section_fk\` FOREIGN KEY (\`watchlist_id\`,\`section_id\`) REFERENCES \`watchlist_section\`(\`watchlist_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`watchlist_item_position_unique\` UNIQUE(\`section_id\`,\`position\`),
          CONSTRAINT "watchlist_item_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "watchlist_item_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "watchlist_item_provider_check" CHECK(length("provider") > 0),
          CONSTRAINT "watchlist_item_listing_check" CHECK(COALESCE(
                json_type("listing") = 'object'
                AND json_type("listing", '$.symbol') = 'text'
                AND json_type("listing", '$.currency') = 'text',
                0
              ))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`watchlist_section\` (
          \`id\` text PRIMARY KEY,
          \`watchlist_id\` text NOT NULL,
          \`parent_section_id\` text,
          \`position\` integer NOT NULL,
          \`name\` text,
          CONSTRAINT \`fk_watchlist_section_watchlist_id_watchlist_id_fk\` FOREIGN KEY (\`watchlist_id\`) REFERENCES \`watchlist\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`watchlist_section_parent_fk\` FOREIGN KEY (\`watchlist_id\`,\`parent_section_id\`) REFERENCES \`watchlist_section\`(\`watchlist_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`watchlist_section_watchlist_id_unique\` UNIQUE(\`watchlist_id\`,\`id\`),
          CONSTRAINT "watchlist_section_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "watchlist_section_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "watchlist_section_name_check" CHECK("name" IS NULL OR length("name") BETWEEN 1 AND 200),
          CONSTRAINT "watchlist_section_parent_check" CHECK("parent_section_id" IS NULL OR "parent_section_id" != "id")
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`watchlist\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`columns\` text DEFAULT '[]' NOT NULL,
          CONSTRAINT "watchlist_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "watchlist_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "watchlist_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "watchlist_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "watchlist_name_check" CHECK(length("name") BETWEEN 1 AND 200)
        );
      `);
      yield* tx.run(
        "CREATE UNIQUE INDEX `watchlist_item_listing_unique` ON `watchlist_item` (`watchlist_id`,`provider`,case when json_extract(\"listing\", '$.id') is not null then json_array(json_extract(\"listing\", '$.id')) else json_array(json_extract(\"listing\", '$.symbol'), json_extract(\"listing\", '$.venue')) end);",
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `watchlist_section_root_position_unique` ON `watchlist_section` (`watchlist_id`,`position`) WHERE "watchlist_section"."parent_section_id" IS NULL;',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `watchlist_section_child_position_unique` ON `watchlist_section` (`watchlist_id`,`parent_section_id`,`position`) WHERE "watchlist_section"."parent_section_id" IS NOT NULL;',
      );
    });
  },
};

export default migration;
