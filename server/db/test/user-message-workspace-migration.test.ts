// Purpose: Verifies optional workspace selections preserve historical transcript facts.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { agentMessages } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { UserData } from "@openchart/server/agent/session/message/data";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

test("removes null User workspace selections and preserves explicit IDs and other message data", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_optional-user-message-workspace"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db
        .insert(agentSessions)
        .values({ id: "ses_test", kind: "chat", title: "Test" });
      const user = {
        time: { created: 10 },
        agent: "analyst",
        model: { providerID: "openai", modelID: "test" },
      };
      const rows = [
        { role: "user", data: user },
        { role: "user", data: { ...user, workspaceId: "wsp_selected" } },
        { role: "user", data: { ...user, workspaceId: null } },
        {
          role: "assistant",
          data: { path: { cwd: "/old", root: "/old" }, workspaceId: null },
        },
      ];
      for (const [index, row] of rows.entries()) {
        yield* db.run(sql`
          INSERT INTO agent_messages (id, session_id, role, data, created_at, updated_at)
          VALUES (${`msg_${index}`}, 'ses_test', ${row.role}, ${JSON.stringify(row.data)}, 100, 200)
        `);
      }
      const before = yield* db
        .select()
        .from(agentMessages)
        .orderBy(agentMessages.id);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const after = yield* db
        .select()
        .from(agentMessages)
        .orderBy(agentMessages.id);
      expect(after).toEqual(
        before.map((row, index) =>
          index === 2 ? { ...row, data: user } : row,
        ),
      );
      for (const row of after.filter((row) => row.role === "user")) {
        expect(Schema.decodeUnknownSync(UserData)(row.data)).toEqual(row.data);
      }
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
