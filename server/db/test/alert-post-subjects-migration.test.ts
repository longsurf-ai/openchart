// Purpose: Upgrades Rule Post facts without rewriting historical identity, source snapshots, or media.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Predicate, Schema, Struct } from "effect";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { alertEvents } from "@openchart/server/resources/alert-event/schema";
import {
  PostEntity,
  lookupPublishedPost,
} from "@openchart/server/resources/post";
import { posts, postMedia } from "@openchart/server/resources/post/schema";

const hash = (body: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(body, (_key, value: unknown) =>
        Predicate.isObject(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            )
          : value,
      ),
    )
    .digest("hex");

test("updates changed source-backed Posts once, preserves attachments/snapshots, and skips missing or unchanged sources", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const at = migrations.findIndex((migration) =>
        migration.id.endsWith("_alert-post-subjects"),
      );
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      // The rule as stored at that point in history; current schemas no longer read it.
      const alertable = {
        kind: "tea",
        source: "close",
        config: {
          parameters: { threshold: 999 },
          inputs: {
            provider: "yfinance",
            listing: { symbol: "WRONG", currency: "USD" },
            resolution: "1m",
            session: "regular",
            adjustment: "raw",
          },
          requests: {},
        },
      };
      yield* db.run(sql`
        INSERT INTO alert_rule (id, name, enabled, repeat, alertable_json)
        VALUES ('alr_source', 'Current renamed rule', 0, 1, ${JSON.stringify(alertable)})
      `);
      const cases: { id: string; data: Schema.JsonObject }[] = [
        {
          id: "direct",
          data: { symbol: "AAPL", value: 21.79, values: { value: 999 } },
        },
        { id: "nested", data: { symbol: "AAPL", values: { value: 21.69 } } },
        {
          id: "unchanged",
          data: {
            inputs: { listing: { symbol: "WRONG" } },
            parameters: { value: 999 },
          },
        },
        { id: "missing", data: { symbol: "MSFT", value: 42 } },
      ];
      for (const item of cases) {
        yield* db.insert(alertEvents).values({
          id: `ale_${item.id}`,
          ruleId: "alr_source",
          condition: "volume",
          time: 9,
          detail: {
            title: "Volume",
            message: "Threshold met",
            data: item.data,
          },
        });
        const post = Schema.decodeUnknownSync(PostEntity)({
          id: `pst_${item.id}`,
          revision: 3,
          createdAt: 10,
          updatedAt: 20,
          author: {
            kind: "rule",
            ruleId: "alr_source",
            name: "Original saved rule name",
          },
          origin: {
            kind: "alert_event",
            eventId: `ale_${item.id}`,
            ruleId: "alr_source",
            occurredAt: 9,
          },
          content: [
            { type: "text", text: "Volume\n\nThreshold met" },
            ...(item.id === "direct"
              ? [
                  {
                    type: "media",
                    mediaId: "pmd_kept",
                    description: "Existing attachment",
                  },
                ]
              : []),
          ],
          quotedPostId: "pst_saved_quote",
        });
        const historicalPost = {
          ...post,
          kind: "alert_event",
          content: post.content.map((block) =>
            block.type === "text" ? { ...block, format: "plain" } : block,
          ),
        };
        const body = Struct.omit(historicalPost, [
          "id",
          "revision",
          "createdAt",
          "updatedAt",
        ]);
        yield* db.run(sql`
          INSERT INTO post (id, revision, created_at, updated_at, kind,
            author_json, origin_json, content_json, quoted_post_id, publication_key, publication_hash)
          VALUES (${post.id}, ${post.revision}, ${post.createdAt}, ${post.updatedAt}, ${historicalPost.kind},
            ${JSON.stringify(post.author)}, ${JSON.stringify(post.origin)},
            ${JSON.stringify(historicalPost.content)}, ${post.quotedPostId},
            ${`event:ale_${item.id}`}, ${hash(body)})
        `);
      }
      yield* db.insert(postMedia).values({
        id: "pmd_kept",
        postId: "pst_direct",
        mime: "image/png",
        filename: "kept.png",
        bytes: Buffer.from("unchanged bytes"),
      });
      yield* db.delete(alertEvents).where(eq(alertEvents.id, "ale_missing"));
      const before = yield* db.select().from(posts);
      const eventsBefore = yield* db.select().from(alertEvents);
      const mediaBefore = yield* db.select().from(postMedia);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      const after = yield* db.select().from(posts);
      expect(yield* db.select().from(alertEvents)).toEqual(eventsBefore);
      expect(yield* db.select().from(postMedia)).toEqual(mediaBefore);
      for (const old of before) {
        const updated = after.find((post) => post.id === old.id)!;
        if (old.id === "pst_unchanged" || old.id === "pst_missing") {
          expect(updated).toEqual(old);
          continue;
        }
        expect(
          Struct.omit(updated, [
            "content",
            "publicationHash",
            "revision",
            "updatedAt",
          ]),
        ).toEqual(
          Struct.omit(old, [
            "content",
            "publicationHash",
            "revision",
            "updatedAt",
          ]),
        );
        expect(updated.revision).toBe(old.revision + 1);
        expect(updated.updatedAt).toBeGreaterThan(old.updatedAt);
        expect(updated.content).toEqual([
          {
            type: "text",
            format: "plain",
            text: `AAPL · Value: ${old.id === "pst_direct" ? 21.79 : 21.69}\n\nVolume\n\nThreshold met`,
          },
          ...old.content.slice(1),
        ]);
        expect(updated.publicationHash).toBe(
          hash({
            ...Struct.omit(updated, [
              "id",
              "revision",
              "createdAt",
              "updatedAt",
              "publicationKey",
              "publicationHash",
            ]),
            kind: "alert_event",
          }),
        );
      }
      // Later shape migrations preserve the original request hash used by replay lookup.
      const nested = after.find((post) => post.id === "pst_nested")!;
      yield* DatabaseMigration.applyOnly(db, migrations);
      const replay = yield* db.transaction((tx) =>
        lookupPublishedPost(
          nested.publicationKey,
          nested.publicationHash,
        ).apply(tx, undefined),
      );
      expect(replay?.id).toBe(nested.id);
      expect(replay?.revision).toBe(4);
      const current = yield* db.select().from(posts);
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.select().from(posts)).toEqual(current);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
});
