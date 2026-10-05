// Purpose: Proves removing legacy Session permission preserves other facts and related rows.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Session } from "@openchart/server/agent/contracts/session";
import { permissionGrants } from "@openchart/server/agent/permission/schema";
import {
  agentMessages,
  agentParts,
  agentPermissions,
  agentRun,
  agentSessionBindings,
  agentTodos,
} from "@openchart/server/agent/schema";
import { sessionsBeforeReadPosition as agentSessions } from "./sessions-before-read-position";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema, Struct } from "effect";
import { expect, test } from "vitest";

test("removes only Session permission from populated predecessor rows", async () => {
  const index = migrations.findIndex((migration) =>
    migration.id.endsWith("_remove-session-permission"),
  );
  expect(index).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.insert(agentSessionBindings).values({
        id: "binding",
        key: "research",
      });
      yield* db.insert(agentSessions).values([
        {
          kind: "chat",
          id: "ses_parent",
          title: "Research",
          bindingId: "binding",
          anchors: [
            {
              partId: "part",
              text: "Selected text",
              startOffset: 0,
              endOffset: 13,
              childSessionId: "ses_child",
            },
          ],
          compactingAt: 150,
          archivedAt: 250,
          createdAt: 100,
          updatedAt: 300,
        },
        {
          id: "ses_child",
          title: "Dig in",
          parentId: "ses_parent",
          kind: "dig_in",
          createdAt: 200,
          updatedAt: 400,
        },
      ]);
      yield* db.run(sql`
        UPDATE agent_sessions SET permission = '{"edit":"ask"}'
        WHERE id = 'ses_parent'
      `);
      expect(
        yield* db.all(sql`SELECT permission FROM agent_sessions ORDER BY id`),
      ).toEqual([{ permission: null }, { permission: '{"edit":"ask"}' }]);
      yield* db.insert(agentMessages).values({
        id: "message",
        sessionId: "ses_parent",
        role: "user",
        data: {
          time: { created: 100 },
          agent: "analyst",
          model: { providerID: "codex" as const, modelID: "tier1" as const },
        },
      });
      yield* db.insert(agentParts).values({
        id: "part",
        messageId: "message",
        data: { type: "text", text: "Selected text" },
      });
      yield* db.insert(agentTodos).values({
        id: "todo",
        sessionId: "ses_parent",
        content: "Research the company.",
        status: "pending",
        priority: "high",
        position: 0,
      });
      yield* db.insert(agentRun).values({
        id: "run",
        sessionId: "ses_parent",
        sessionIntentId: "intent",
        input: {
          agent: "analyst",
          model: { providerID: "codex" as const, modelID: "tier1" as const },
          parts: [{ type: "text", text: "Analyze this." }],
        },
        status: "completed",
        createdAt: 100,
        startedAt: 200,
        finishedAt: 300,
      });
      yield* db.insert(permissionGrants).values({
        id: "grant",
        action: "read",
        resource: "/notes/*",
      });
      yield* db.insert(agentPermissions).values({
        userId: "legacy-user",
        data: { yolo: true },
      });
      const sessions = yield* db
        .select()
        .from(agentSessions)
        .orderBy(agentSessions.id);
      const indexes = yield* db.all(sql`PRAGMA index_list(agent_sessions)`);
      const related = {
        bindings: yield* db.select().from(agentSessionBindings),
        messages: yield* db.select().from(agentMessages),
        parts: yield* db.select().from(agentParts),
        todos: yield* db.select().from(agentTodos),
        runs: yield* db.select().from(agentRun),
        grants: yield* db.select().from(permissionGrants),
        policies: yield* db.select().from(agentPermissions),
      };

      // Seed the historical anchor field without using the current Session contract.
      yield* db.run(sql`UPDATE agent_sessions
        SET anchors = json_set(anchors, '$[0].sessionIntentId', 'branch')
        WHERE id = 'ses_parent'`);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);

      const migrated = yield* db
        .select()
        .from(agentSessions)
        .orderBy(agentSessions.id);
      expect(migrated).toEqual(sessions);
      for (const session of migrated) {
        expect(
          Schema.decodeUnknownSync(
            Session.mapFields(Struct.omit(["lastReadRunId"])),
          )(session),
        ).toEqual(session);
      }
      expect({
        bindings: yield* db.select().from(agentSessionBindings),
        messages: yield* db.select().from(agentMessages),
        parts: yield* db.select().from(agentParts),
        todos: yield* db.select().from(agentTodos),
        runs: yield* db.select().from(agentRun),
        grants: yield* db.select().from(permissionGrants),
        policies: yield* db.select().from(agentPermissions),
      }).toEqual(related);
      expect(
        (yield* db.all<{ name: string }>(
          sql`PRAGMA table_info(agent_sessions)`,
        )).map((column) => column.name),
      ).not.toContain("permission");
      expect(yield* db.all(sql`PRAGMA index_list(agent_sessions)`)).toEqual(
        indexes,
      );
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
        { foreign_keys: 1 },
      ]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(migrations.map(({ id }) => ({ id })));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
