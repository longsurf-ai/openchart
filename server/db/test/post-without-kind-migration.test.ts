// Purpose: Removes Post kinds while preserving complete publications, quotes, media, and the migration ledger.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema, Struct } from "effect";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { PostEntity } from "@openchart/server/resources/post/entity";
import { posts, postMedia } from "@openchart/server/resources/post/schema";

test.each([true, false])(
  "preserves every former kind and media with foreign keys enabled=%s",
  async (foreignKeys) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        const at = migrations.findIndex(({ id }) =>
          id.endsWith("_post-without-kind"),
        );
        expect(at).toBeGreaterThan(0);
        yield* db.run(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
        yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
        for (const kind of ["alert_event", "note", "analysis"]) {
          const author =
            kind === "alert_event"
              ? { kind: "rule", ruleId: "alr_deleted", name: "Saved rule" }
              : { kind: "provider", providerId: "codex" };
          const origin =
            kind === "alert_event"
              ? {
                  kind: "alert_event",
                  ruleId: "alr_deleted",
                  eventId: "ale_deleted",
                  occurredAt: 5,
                }
              : {
                  kind: "agent_run",
                  runId: `agr_${kind}`,
                  sessionId: "ses_deleted",
                  alert: null,
                };
          const content = [
            ...(kind === "note" ? [] : [{ type: "text", text: `**${kind}**` }]),
            {
              type: "media",
              mediaId: `pmd_${kind}`,
              description: "Saved chart",
            },
          ];
          yield* db.run(sql`
          INSERT INTO post (id, revision, created_at, updated_at, kind,
            author_json, origin_json, content_json, quoted_post_id, publication_key, publication_hash)
          VALUES (${`pst_${kind}`}, 3, 10, 20, ${kind},
            ${JSON.stringify(author)}, ${JSON.stringify(origin)}, ${JSON.stringify(content)},
            ${kind === "alert_event" ? null : "pst_alert_event"}, ${`saved:${kind}`}, ${"a".repeat(64)})
        `);
          yield* db.insert(postMedia).values({
            id: `pmd_${kind}`,
            postId: `pst_${kind}`,
            mime: "image/png",
            filename: `${kind}.png`,
            bytes: Buffer.from([0, 255, 10, 42]),
          });
        }
        const before = yield* db.all<{ kind: string }>(sql`
          SELECT id, revision, created_at, updated_at, kind, author_json,
            origin_json, content_json, quoted_post_id, publication_key, publication_hash
          FROM post ORDER BY id
        `);
        const mediaBefore = yield* db.select().from(postMedia);
        const ledgerBefore = yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        );

        yield* DatabaseMigration.apply(db);
        const after = yield* db.all(sql`SELECT * FROM post ORDER BY id`);
        expect(after).toEqual(
          before.map((post) => Struct.omit(post, ["kind"])),
        );
        expect(yield* db.select().from(postMedia)).toEqual(mediaBefore);
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
          { foreign_keys: Number(foreignKeys) },
        ]);
        expect(
          (yield* db.all<{ name: string }>(sql`PRAGMA table_info(post)`)).map(
            ({ name }) => name,
          ),
        ).not.toContain("kind");
        for (const post of yield* db.select().from(posts)) {
          const entity = Struct.omit(post, [
            "publicationKey",
            "publicationHash",
          ]);
          expect(Schema.decodeUnknownSync(PostEntity)(entity)).toEqual(entity);
        }
        const ledgerAfter = yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        );
        expect(ledgerAfter.slice(0, at)).toEqual(ledgerBefore);
        expect(ledgerAfter).toHaveLength(migrations.length);
        yield* DatabaseMigration.apply(db);
        expect(yield* db.all(sql`SELECT * FROM post ORDER BY id`)).toEqual(
          after,
        );
        expect(yield* db.select().from(postMedia)).toEqual(mediaBefore);
        expect(
          yield* db.all(
            sql`SELECT * FROM app_schema_migrations ORDER BY version`,
          ),
        ).toEqual(ledgerAfter);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    );
  },
);
