// Purpose: Proves forward grant-table restoration preserves Session and legacy policy data.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { agentPermissions } from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { getTableColumns, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("restores grant storage after its historical removal while preserving policies and Sessions", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((item) =>
        item.id.endsWith("_remove-permission-grants"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`
        INSERT INTO agent_sessions (id, title, permission)
        VALUES ('session', 'Keep me', '{"edit":"ask"}')
      `);
      yield* db.insert(agentPermissions).values([
        {
          userId: "one",
          data: {
            yolo: true,
            rules: [{ permission: "read", pattern: "*", action: "allow" }],
          },
        },
        {
          userId: "two",
          data: {
            yolo: false,
            rules: [{ permission: "edit", pattern: "*", action: "deny" }],
          },
        },
      ]);
      yield* db.run(sql`
        INSERT INTO agent_permission_grants (id, action, resource)
        VALUES ('first', 'read', '/notes/*'), ('second', 'edit', '/notes/private')
      `);
      expect(
        yield* db.all(sql`SELECT id FROM agent_permission_grants ORDER BY id`),
      ).toEqual([{ id: "first" }, { id: "second" }]);
      const policies = yield* db.select().from(agentPermissions);
      const sessions = yield* db
        .select({
          ...getTableColumns(agentSessions),
          kind: sql<string | null>`kind`,
        })
        .from(agentSessions);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(yield* db.select().from(agentPermissions)).toEqual(policies);
      expect(yield* db.select().from(agentSessions)).toEqual(sessions);
      expect(
        yield* db.all(sql`
          SELECT name FROM sqlite_schema
          WHERE name IN (
            'agent_permission_grants',
            'uniq_agent_permission_grants_action_resource'
          )
        `),
      ).toEqual([]);
      yield* DatabaseMigration.apply(db);
      expect(
        yield* db.all(sql`SELECT id FROM agent_permission_grants`),
      ).toEqual([]);
      yield* db.run(sql`
        INSERT INTO agent_permission_grants (id, action, resource)
        VALUES ('restored', 'read', '/notes/*')
      `);
      yield* DatabaseMigration.apply(db);
      expect(
        yield* db.all(
          sql`SELECT id, action, resource FROM agent_permission_grants`,
        ),
      ).toEqual([{ id: "restored", action: "read", resource: "/notes/*" }]);
      expect(yield* db.select().from(agentPermissions)).toEqual(policies);
      expect(yield* db.select().from(agentSessions)).toEqual(
        sessions.map((session) => ({
          ...session,
          kind: session.kind ?? "chat",
        })),
      );
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
