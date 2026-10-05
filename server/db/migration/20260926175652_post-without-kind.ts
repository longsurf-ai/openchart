// Purpose: Applies the 20260926175652_post-without-kind forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260926175652_post-without-kind",
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
      // Rebuilding the parent cascades to media; foreign_keys cannot change in a Tx.
      yield* tx.run(
        "CREATE TEMP TABLE post_kind_media_backup AS SELECT * FROM post_media",
      );
      yield* tx.run(`
        CREATE TABLE \`__new_post\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`author_json\` text NOT NULL,
          \`origin_json\` text NOT NULL,
          \`content_json\` text NOT NULL,
          \`quoted_post_id\` text,
          \`publication_key\` text NOT NULL,
          \`publication_hash\` text NOT NULL,
          CONSTRAINT "post_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "post_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "post_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "post_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_post_author" CHECK(json_valid("author_json") AND json_type("author_json") = 'object' AND json_extract("author_json", '$.kind') IN ('provider','rule')),
          CONSTRAINT "chk_post_origin" CHECK(json_valid("origin_json") AND json_type("origin_json") = 'object' AND json_extract("origin_json", '$.kind') IN ('alert_event','agent_run')),
          CONSTRAINT "chk_post_author_origin" CHECK((json_extract("origin_json", '$.kind') IS 'alert_event' AND json_extract("author_json", '$.kind') IS 'rule' AND json_extract("author_json", '$.ruleId') IS json_extract("origin_json", '$.ruleId')) OR (json_extract("origin_json", '$.kind') IS 'agent_run' AND json_extract("author_json", '$.kind') IS 'provider')),
          CONSTRAINT "chk_post_content" CHECK(json_valid("content_json") AND json_type("content_json") = 'array' AND json_array_length("content_json") > 0),
          CONSTRAINT "chk_post_publication" CHECK(length(trim("publication_key")) > 0 AND length("publication_hash") = 64)
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_post`(`id`, `revision`, `created_at`, `updated_at`, `author_json`, `origin_json`, `content_json`, `quoted_post_id`, `publication_key`, `publication_hash`) SELECT `id`, `revision`, `created_at`, `updated_at`, `author_json`, `origin_json`, `content_json`, `quoted_post_id`, `publication_key`, `publication_hash` FROM `post`;",
      );
      yield* tx.run("DELETE FROM post_media");
      yield* tx.run("DROP TABLE `post`;");
      yield* tx.run("ALTER TABLE `__new_post` RENAME TO `post`;");
      yield* tx.run(
        "INSERT INTO post_media SELECT * FROM post_kind_media_backup",
      );
      yield* tx.run("DROP TABLE post_kind_media_backup");
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_post_publication` ON `post` (`publication_key`);",
      );
      yield* tx.run(
        'CREATE INDEX `idx_post_created` ON `post` ("created_at" desc,"id" desc);',
      );
    });
  },
};

export default migration;
