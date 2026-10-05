// Purpose: Applies the 20260924050749_post-feed forward-only SQLite migration.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { Effect, Predicate, Schema } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260924050749_post-feed",
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
        CREATE TABLE \`post_media\` (
          \`id\` text PRIMARY KEY,
          \`post_id\` text NOT NULL,
          \`mime\` text NOT NULL,
          \`filename\` text NOT NULL,
          \`bytes\` blob NOT NULL,
          CONSTRAINT \`fk_post_media_post_id_post_id_fk\` FOREIGN KEY (\`post_id\`) REFERENCES \`post\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_post_media_size" CHECK(length("bytes") BETWEEN 1 AND 33554432)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`post\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`kind\` text NOT NULL,
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
          CONSTRAINT "chk_post_kind" CHECK("kind" IN ('note','analysis','alert_event')),
          CONSTRAINT "chk_post_author" CHECK(json_valid("author_json") AND json_type("author_json") = 'object' AND json_extract("author_json", '$.kind') IN ('provider','rule')),
          CONSTRAINT "chk_post_origin" CHECK(json_valid("origin_json") AND json_type("origin_json") = 'object' AND json_extract("origin_json", '$.kind') IN ('alert_event','agent_run')),
          CONSTRAINT "chk_post_author_origin" CHECK((json_extract("origin_json", '$.kind') IS 'alert_event' AND "kind" IS 'alert_event' AND json_extract("author_json", '$.kind') IS 'rule' AND json_extract("author_json", '$.ruleId') IS json_extract("origin_json", '$.ruleId')) OR (json_extract("origin_json", '$.kind') IS 'agent_run' AND "kind" IS NOT 'alert_event' AND json_extract("author_json", '$.kind') IS 'provider')),
          CONSTRAINT "chk_post_content" CHECK(json_valid("content_json") AND json_type("content_json") = 'array' AND json_array_length("content_json") > 0),
          CONSTRAINT "chk_post_publication" CHECK(length(trim("publication_key")) > 0 AND length("publication_hash") = 64)
        );
      `);
      yield* tx.run(
        "CREATE INDEX `idx_post_media_owner` ON `post_media` (`post_id`);",
      );
      yield* tx.run(
        "CREATE UNIQUE INDEX `uq_post_publication` ON `post` (`publication_key`);",
      );
      yield* tx.run(
        'CREATE INDEX `idx_post_created` ON `post` ("created_at" desc,"id" desc);',
      );
      // Frozen historical conversion: keep Event rows byte-for-byte and give each
      // original a persistent Post before future Rule deletion can remove it.
      const events = yield* tx.all<{
        id: string;
        rule_id: string;
        condition: string;
        time: number;
        detail_json: string;
        created_at: number;
        updated_at: number;
        name: string;
      }>(
        sql`SELECT e.*, r.name FROM alert_event e JOIN alert_rule r ON r.id = e.rule_id ORDER BY e.created_at, e.id`,
      );
      const detailSchema = Schema.fromJsonString(
        Schema.Struct({
          title: Schema.String,
          message: Schema.String,
          data: Schema.JsonObject,
        }),
      );
      for (const event of events) {
        const detail = Schema.decodeUnknownSync(detailSchema)(
          event.detail_json,
        );
        const author = {
          kind: "rule",
          ruleId: event.rule_id,
          name: event.name,
        };
        const origin = {
          kind: "alert_event",
          eventId: event.id,
          ruleId: event.rule_id,
          occurredAt: event.time,
        };
        const content = [
          {
            type: "text",
            format: "plain",
            text:
              [detail.title, detail.message]
                .filter((text) => /\S/.test(text))
                .join("\n\n") ||
              event.condition.trim() ||
              "Alert triggered",
          },
        ];
        const hash = createHash("sha256")
          .update(
            JSON.stringify(
              {
                kind: "alert_event",
                author,
                origin,
                content,
                quotedPostId: null,
              },
              (_key, value: unknown) =>
                Predicate.isObject(value)
                  ? Object.fromEntries(
                      Object.entries(value).sort(([a], [b]) =>
                        a.localeCompare(b),
                      ),
                    )
                  : value,
            ),
          )
          .digest("hex");
        yield* tx.run(sql`INSERT INTO post (id, revision, created_at, updated_at, kind, author_json, origin_json, content_json, quoted_post_id, publication_key, publication_hash)
          VALUES (${`pst_${event.id.slice(4)}`}, 1, ${event.created_at}, ${event.updated_at}, 'alert_event', ${JSON.stringify(author)}, ${JSON.stringify(origin)}, ${JSON.stringify(content)}, NULL, ${`event:${event.id}`}, ${hash})`);
      }
    });
  },
};

export default migration;
