// Purpose: Proves retired model providers cannot leave unusable Trigger rows behind.

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("removes agent-prompt Triggers that name a retired provider", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_retired-trigger-provider"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));

      const target = (providerID: string) =>
        JSON.stringify({
          kind: "agent_prompt",
          prompt: {
            agent: "analyst",
            model: { providerID, modelID: "tier1" },
            parts: [{ type: "text", text: "Review the alert." }],
          },
        });
      for (const [id, providerID] of [
        ["trg_retired", "omp"],
        ["trg_current", "openai-compatible"],
      ] as const) {
        yield* db.run(sql`
          INSERT INTO trigger
            (id, revision, created_at, updated_at, name, enabled, event_json, target_json)
          VALUES (${id}, 1, 50, 60, 'Existing action', 1,
            '{"kind":"alert","ruleId":"alr_old"}', ${target(providerID)})
        `);
      }
      yield* db.run(sql`
        INSERT INTO trigger
          (id, revision, created_at, updated_at, name, enabled, event_json, target_json)
        VALUES ('trg_notification', 1, 50, 60, 'Existing action', 1,
          '{"kind":"alert","ruleId":"alr_old"}',
          '{"kind":"notification","message":"{message}"}')
      `);

      yield* DatabaseMigration.apply(db);

      expect(
        yield* db.all<{ id: string }>(sql`SELECT id FROM trigger ORDER BY id`),
      ).toEqual([{ id: "trg_current" }, { id: "trg_notification" }]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));
