// Purpose: Adds saved subject/value facts to existing Rule Posts without rewriting their source snapshots.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { Effect, Predicate, Schema } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260924152035_alert-post-subjects",
  /** Updates only changed Rule content in the runner-owned transaction. @example yield* migration.up(tx); */
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{
        id: string;
        author_json: string;
        origin_json: string;
        content_json: string;
        quoted_post_id: string | null;
        condition: string;
        detail_json: string;
      }>(sql`SELECT p.id, p.author_json, p.origin_json, p.content_json, p.quoted_post_id, e.condition, e.detail_json
        FROM post p JOIN alert_event e ON e.id = json_extract(p.origin_json, '$.eventId')
        WHERE p.kind = 'alert_event' AND json_extract(p.origin_json, '$.kind') = 'alert_event'`);
      const detailSchema = Schema.fromJsonString(
        Schema.Struct({
          title: Schema.String,
          message: Schema.String,
          data: Schema.JsonObject,
        }),
      );
      const objectSchema = Schema.fromJsonString(Schema.JsonObject);
      const contentSchema = Schema.fromJsonString(Schema.Array(Schema.Json));
      for (const row of rows) {
        const { title, message, data } = Schema.decodeUnknownSync(detailSchema)(
          row.detail_json,
        );
        // Frozen copy: never import the future runtime content formatter into a migration.
        const symbol = Predicate.isString(data.symbol)
          ? data.symbol.trim()
          : "";
        const value = [
          data.value,
          Predicate.isObject(data.values) ? data.values.value : undefined,
        ].find(
          (candidate) =>
            Predicate.isString(candidate) ||
            Predicate.isNumber(candidate) ||
            Predicate.isBoolean(candidate),
        );
        const facts = [
          symbol,
          value === undefined ? "" : `Value: ${String(value)}`,
        ]
          .filter(Boolean)
          .join(" · ");
        const body =
          [title, message].filter((text) => /\S/.test(text)).join("\n\n") ||
          row.condition.trim() ||
          "Alert triggered";
        const first = {
          type: "text",
          format: "plain",
          text: [facts, body].filter(Boolean).join("\n\n"),
        };
        const previous = Schema.decodeUnknownSync(contentSchema)(
          row.content_json,
        );
        const content =
          Predicate.isObject(previous[0]) && previous[0].type === "text"
            ? [first, ...previous.slice(1)]
            : [first, ...previous];
        if (isDeepStrictEqual(content, previous)) continue;
        const author = Schema.decodeUnknownSync(objectSchema)(row.author_json);
        const origin = Schema.decodeUnknownSync(objectSchema)(row.origin_json);
        const publicationHash = createHash("sha256")
          .update(
            JSON.stringify(
              {
                kind: "alert_event",
                author,
                origin,
                content,
                quotedPostId: row.quoted_post_id,
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
        yield* tx.run(sql`UPDATE post SET content_json = ${JSON.stringify(content)}, publication_hash = ${publicationHash},
          revision = revision + 1, updated_at = max(updated_at + 1, CAST(unixepoch('subsec') * 1000 AS INTEGER))
          WHERE id = ${row.id}`);
      }
    });
  },
};
export default migration;
