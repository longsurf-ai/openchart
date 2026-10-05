// Purpose: Verifies historical Posts satisfy the entity length invariant without losing references, media or publication identity.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema, Struct } from "effect";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { PostEntity } from "@openchart/server/resources/post/entity";
import { postMedia, posts } from "@openchart/server/resources/post/schema";

const reference = { type: "resource", resource: "chart", id: "chr_kept" };
const mixedMedia = {
  type: "media",
  mediaId: "pmd_mixed",
  description: "😀".repeat(20),
};
const onlyMedia = {
  type: "media",
  mediaId: "pmd_only",
  description: "😀".repeat(351),
};
const fixtures = [
  {
    before: [
      { type: "text", text: "€".repeat(340) },
      reference,
      mixedMedia,
      { type: "text", text: "Remove overflow" },
    ],
    after: [
      { type: "text", text: "€".repeat(340) },
      reference,
      { ...mixedMedia, description: `${"😀".repeat(9)}…` },
    ],
  },
  {
    before: [onlyMedia],
    after: [{ ...onlyMedia, description: `${"😀".repeat(349)}…` }],
  },
  {
    before: [{ type: "text", text: "a".repeat(350) }],
    after: [{ type: "text", text: "a".repeat(350) }],
  },
  {
    before: [
      { type: "text", text: "a".repeat(349) },
      { type: "text", text: "overflow" },
      reference,
    ],
    after: [{ type: "text", text: `${"a".repeat(349)}…` }, reference],
  },
];

test("upgrades long mixed and pure-media Posts once while preserving their envelopes and owned bytes", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const at = migrations.findIndex(({ id }) =>
        id.endsWith("_post-character-limit"),
      );
      expect(at).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      for (const [index, fixture] of fixtures.entries()) {
        yield* db.run(sql`
        INSERT INTO post (id, revision, created_at, updated_at,
          author_json, origin_json, content_json, quoted_post_id, publication_key, publication_hash)
        VALUES (${`pst_${index}`}, 3, 10, 20,
          '{"kind":"provider","providerId":"codex"}',
          '{"kind":"agent_run","runId":"agr_kept","sessionId":"ses_kept","alert":null}',
          ${JSON.stringify(fixture.before)}, 'pst_missing', ${`tool:${index}`}, ${"a".repeat(64)})
      `);
      }
      for (const [index, id] of ["pmd_mixed", "pmd_only"].entries()) {
        yield* db.insert(postMedia).values({
          id,
          postId: `pst_${index}`,
          mime: "image/png",
          filename: "chart.png",
          bytes: Buffer.from("unchanged"),
        });
      }
      const before = yield* db.select().from(posts).orderBy(posts.id);
      const mediaBefore = yield* db.select().from(postMedia);
      const ledgerBefore = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.apply(db);
      const after = yield* db.select().from(posts).orderBy(posts.id);
      expect(after).toEqual(
        before.map((post, index) => ({
          ...post,
          content: fixtures[index]!.after,
        })),
      );
      for (const post of after) {
        const entity = Struct.omit(post, ["publicationKey", "publicationHash"]);
        expect(Schema.decodeUnknownSync(PostEntity)(entity)).toEqual(entity);
      }
      expect(yield* db.select().from(postMedia)).toEqual(mediaBefore);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      const ledgerAfter = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(ledgerAfter.slice(0, at)).toEqual(ledgerBefore);
      expect(ledgerAfter).toHaveLength(migrations.length);
      yield* DatabaseMigration.apply(db);
      expect(yield* db.select().from(posts).orderBy(posts.id)).toEqual(after);
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledgerAfter);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
});
