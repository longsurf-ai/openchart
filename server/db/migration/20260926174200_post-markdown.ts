// Purpose: Removes Post text format selectors while preserving authored text and publication request hashes.
import { sql } from "drizzle-orm";
import { Effect, Schema, Struct } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260926174200_post-markdown",
  /** Converts stored text blocks inside the runner-owned transaction. @example yield* migration.up(tx); */
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{ id: string; content_json: string }>(sql`
        SELECT id, content_json FROM post WHERE EXISTS (
          SELECT 1 FROM json_each(content_json)
          WHERE json_extract(value, '$.type') = 'text'
            AND json_type(value, '$.format') IS NOT NULL
        )
      `);
      // Frozen JSON boundary; historical migrations never import current Post schemas.
      const decode = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Array(Schema.JsonObject)),
      );
      for (const row of rows) {
        const content = decode(row.content_json).map((block) =>
          block.type === "text" ? Struct.omit(block, ["format"]) : block,
        );
        yield* tx.run(sql`
          UPDATE post SET content_json = ${JSON.stringify(content)} WHERE id = ${row.id}
        `);
      }
    });
  },
};
export default migration;
