// Purpose: Bounds existing Post text while retaining identity, references, media bytes and publication hashes.
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260926184112_post-character-limit",
  /** Truncates historical content inside the runner-owned transaction. @example yield* migration.up(tx); */
  up(tx) {
    return Effect.gen(function* () {
      // Frozen JSON boundary; migrations never depend on current entity policies.
      const decode = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Array(
            Schema.Union([
              Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
              Schema.Struct({
                type: Schema.Literal("media"),
                mediaId: Schema.String,
                description: Schema.String,
              }),
              Schema.Struct({
                type: Schema.Literal("resource"),
                resource: Schema.String,
                id: Schema.String,
              }),
            ]),
          ),
        ),
      );
      const rows = yield* tx.all<{ id: string; content_json: string }>(sql`
        SELECT id, content_json FROM post
      `);
      for (const row of rows) {
        const content = decode(row.content_json);
        const count = content.reduce(
          (total, block) => total + Array.from(
            block.type === "text"
              ? block.text
              : block.type === "media"
                ? block.description
                : "",
          ).length,
          0,
        );
        if (count <= 350) continue;
        let remaining = 349;
        let marked = false;
        const truncated = content.flatMap((block): typeof content => {
          if (block.type === "resource") return [block];
          const characters = Array.from(
            block.type === "text" ? block.text : block.description,
          ).slice(0, remaining);
          remaining -= characters.length;
          if (remaining === 0 && !marked) {
            characters.push("…");
            marked = true;
          }
          const text = characters.join("");
          if (block.type === "media") return [{ ...block, description: text }];
          return /\S/.test(text) ? [{ ...block, text }] : [];
        });
        yield* tx.run(sql`
          UPDATE post SET content_json = ${JSON.stringify(truncated)} WHERE id = ${row.id}
        `);
      }
    });
  },
};
export default migration;
