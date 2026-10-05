// Purpose: Proves V2 removes self-managed skills while preserving other Agent data.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { agentTodos } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { getTableColumns, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("fresh databases have no application-owned skills table", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.apply(db);
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema WHERE name = 'agent_skills'
        `),
      ).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("removes populated skills while preserving sessions and their todos", async () => {
  const upgradeIndex = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-agent-skills"),
  );
  expect(upgradeIndex).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.run(sql`
        INSERT INTO agent_skills (name, description, content)
        VALUES ('research', 'Research skill', 'Research the company.')
      `);
      yield* db.run(sql`
        INSERT INTO agent_sessions (id, user_id, title)
        VALUES ('session', 'user', 'Research session')
      `);
      yield* db.insert(agentTodos).values({
        sessionId: "session",
        id: "todo",
        content: "Research the company.",
        status: "pending",
        priority: "high",
        position: 0,
      });
      const sessionsBefore = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      const todosBefore = yield* db.select().from(agentTodos);

      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema WHERE name = 'agent_skills'
        `),
      ).toEqual([]);
      expect(yield* db.select().from(agentSessions)).toEqual(
        sessionsBefore.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      expect(yield* db.select().from(agentTodos)).toEqual(todosBefore);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
