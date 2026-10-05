// Purpose: Preserves existing Alert Events while backfilling independent, retained Post history.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { alertRules } from "@openchart/server/resources/alert-rule/schema";
import { alertEvents } from "@openchart/server/resources/alert-event/schema";
import { PostEntity } from "@openchart/server/resources/post/entity";
import { posts } from "@openchart/server/resources/post/schema";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

test("backfills nonempty history once and preserves Posts after deleting source Rule", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const at = migrations.findIndex((migration) =>
        migration.id.endsWith("_post-feed"),
      );
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      // The rule as stored at that point in history; current schemas no longer read it.
      const alertable = {
        kind: "tea",
        source: "close",
        config: {
          parameters: {},
          inputs: {
            provider: "yfinance",
            listing: { symbol: "AAPL", currency: "USD" },
            resolution: "1m",
            session: "regular",
            adjustment: "raw",
          },
          requests: {},
        },
      };
      yield* db.run(sql`
        INSERT INTO alert_rule (id, name, enabled, repeat, alertable_json)
        VALUES ('alr_existing', 'Original rule', 0, 1, ${JSON.stringify(alertable)})
      `);
      yield* db.insert(alertEvents).values({
        id: "ale_existing",
        ruleId: "alr_existing",
        condition: "crossing",
        time: 123,
        detail: { title: "Crossed", message: "AAPL above 200", data: {} },
        revision: 3,
        createdAt: 456,
        updatedAt: 789,
      });
      yield* db.insert(alertEvents).values({
        id: "ale_blank",
        ruleId: "alr_existing",
        condition: " ",
        time: 125,
        detail: { title: " ", message: "", data: {} },
      });
      const before = yield* db.select().from(alertEvents);
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.select().from(alertEvents)).toEqual(before);
      const saved = yield* db.select().from(posts);
      expect(saved).toHaveLength(2);
      expect(saved.find((post) => post.id === "pst_blank")?.content).toEqual([
        { type: "text", text: "Alert triggered" },
      ]);
      const { publicationKey, publicationHash, ...post } = saved.find(
        (post) => post.id === "pst_existing",
      )!;
      expect(publicationKey).toBe("event:ale_existing");
      expect(publicationHash).toMatch(/^[a-f0-9]{64}$/);
      expect(Schema.decodeUnknownSync(PostEntity)(post)).toMatchObject({
        id: "pst_existing",
        revision: 1,
        createdAt: 456,
        updatedAt: 789,
        author: { kind: "rule", ruleId: "alr_existing", name: "Original rule" },
        origin: {
          kind: "alert_event",
          eventId: "ale_existing",
          ruleId: "alr_existing",
          occurredAt: 123,
        },
        content: [{ type: "text", text: "Crossed\n\nAAPL above 200" }],
        quotedPostId: null,
      });
      yield* db.delete(alertRules).where(eq(alertRules.id, "alr_existing"));
      expect(yield* db.select().from(alertEvents)).toEqual([]);
      expect(yield* db.select().from(posts)).toEqual(saved);
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.select().from(posts)).toEqual(saved);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
});
