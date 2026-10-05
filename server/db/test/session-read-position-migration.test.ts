// Purpose: Upgrade populated Sessions without inventing read receipts or changing history.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import {
  makeWithDefaults,
  type EffectSQLiteNodeDatabase,
} from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

const sessionStructure = Effect.fn(function* (db: EffectSQLiteNodeDatabase) {
  return {
    columns: yield* db.all(`SELECT name, type, "notnull", dflt_value, pk
      FROM pragma_table_info('agent_sessions') ORDER BY name`),
    foreignKeys:
      yield* db.all(`SELECT "table", "from", "to", on_update, on_delete, match
      FROM pragma_foreign_key_list('agent_sessions') ORDER BY "from"`),
    indexes: yield* db.all(`SELECT name, sql FROM sqlite_schema
      WHERE type = 'index' AND tbl_name IN ('agent_sessions', 'agent_run') ORDER BY name`),
  };
});

test("upgrades existing Sessions with an unread position, preserving Run and message facts", async () => {
  const upgraded = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const index = migrations.findIndex(({ id }) =>
        id.endsWith("_session-read-position"),
      );
      expect(index).toBeGreaterThan(0);
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        "INSERT INTO agent_sessions (id, kind, title, created_at, updated_at) VALUES ('ses_old', 'chat', 'Existing', 10, 20)",
      );
      yield* db.run(`INSERT INTO agent_run (id, session_id, session_intent_id, input, status, created_at, started_at, finished_at)
      VALUES ('agr_old', 'ses_old', 'intent', '{"agent":"analyst","model":{"providerID":"codex","modelID":"tier1"},"parts":[{"type":"text","text":"Hello"}]}', 'completed', 10, 11, 12)`);
      yield* db.run(
        `INSERT INTO agent_messages (id, session_id, role, data) VALUES ('msg_old', 'ses_old', 'assistant', '{"time":{"created":10,"completed":12}}')`,
      );
      const before = yield* db.all<Record<string, unknown>>(
        "SELECT * FROM agent_sessions",
      );
      const runs = yield* db.all("SELECT * FROM agent_run");
      const messages = yield* db.all("SELECT * FROM agent_messages");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      // Prepare a fresh statement after ALTER TABLE so the driver's cached column list is refreshed.
      expect(
        yield* db.all("SELECT agent_sessions.* FROM agent_sessions"),
      ).toEqual(before.map((row) => ({ ...row, last_read_run_id: null })));
      expect(yield* db.all("SELECT * FROM agent_run")).toEqual(runs);
      expect(yield* db.all("SELECT * FROM agent_messages")).toEqual(messages);
      yield* db.run(
        "UPDATE agent_sessions SET last_read_run_id = 'agr_old' WHERE id = 'ses_old'",
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(
        yield* db.all(
          "SELECT last_read_run_id, updated_at FROM agent_sessions",
        ),
      ).toEqual([{ last_read_run_id: "agr_old", updated_at: 20 }]);
      expect(
        Exit.isFailure(
          yield* db
            .run("UPDATE agent_sessions SET last_read_run_id = 'agr_missing'")
            .pipe(Effect.exit),
        ),
      ).toBe(true);
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(
        Exit.isFailure(
          yield* db
            .run("UPDATE agent_sessions SET kind = 'invalid'")
            .pipe(Effect.exit),
        ),
      ).toBe(true);
      return yield* sessionStructure(db);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
  const fresh = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.apply(db);
      return yield* sessionStructure(db);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
  expect(upgraded).toEqual(fresh);
});
