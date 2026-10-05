// Purpose: Locks the forward replacement of Tea storage with workspace registrations.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

test("upgrades populated main history to workspaces without changing existing Runs or resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex(({ id }) => id.endsWith("_workspace"));
      expect(index).toBeGreaterThan(0);
      expect(migrations[index - 1]?.id).toBe("20260916223704_agent-run-stop");
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        sql`INSERT INTO dashboard (id, name) VALUES ('dsh_keep', 'Keep')`,
      );
      yield* db.run(sql`INSERT INTO tea_script (id, name, draft_source)
        VALUES ('tea_old', 'Old', 'draft')`);
      yield* db.run(sql`INSERT INTO tea_script_version (script_id, version_id, source)
        VALUES ('tea_old', 'tsv_old', 'published')`);
      yield* db.run(sql`UPDATE tea_script SET current_version_id = 'tsv_old'`);
      yield* db.run(sql`INSERT INTO agent_sessions (id, title)
        VALUES ('session_keep', 'Keep')`);
      yield* db.run(sql`INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, created_at, started_at, finished_at)
        VALUES ('run_keep', 'session_keep', 'intent_keep',
          '{"agent":"analyst","model":{"providerID":"openai","modelID":"gpt-5"},"parts":[{"type":"text","text":"Keep"}]}',
          'stop', 1, 2, 3)`);
      const runs = yield* db.all(sql`SELECT * FROM agent_run`);
      const dashboards = yield* db.all(sql`SELECT * FROM dashboard`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.apply(db);
      expect(
        yield* db.all(sql`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('tea_script', 'tea_script_version')`),
      ).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM workspace`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM agent_run`)).toEqual(runs);
      expect(
        (yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        )).slice(0, ledger.length),
      ).toEqual(ledger);
      yield* db.run(
        sql`INSERT INTO workspace (id, root) VALUES ('wsp_a', '/a')`,
      );
      for (const statement of [
        sql`INSERT INTO workspace (id, root) VALUES ('wsp_b', '/a')`,
        sql`INSERT INTO workspace (id, root) VALUES ('wsp_b', '')`,
        sql`UPDATE workspace SET revision = 0`,
        sql`UPDATE workspace SET created_at = -1`,
        sql`UPDATE workspace SET updated_at = -1`,
      ]) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      }
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  ));
