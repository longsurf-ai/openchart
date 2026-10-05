// Purpose: Proves the Credential migration preserves populated predecessor data and ledger history.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("adds empty credential storage without changing existing Resources or migration history", async () => {
  const index = migrations.findIndex((migration) =>
    migration.id.endsWith("_credential"),
  );
  expect(index).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`INSERT INTO dashboard (id, name, favorite, revision)
      VALUES ('dsh_preserved', 'Existing dashboard', 1, 7)`);
      const before = yield* db.all(sql`SELECT * FROM dashboard`);
      const ledgerBefore = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(before);
      expect(yield* db.all(sql`SELECT * FROM credential`)).toEqual([]);
      const ledgerAfter = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(ledgerAfter.slice(0, ledgerBefore.length)).toEqual(ledgerBefore);
      expect(ledgerAfter).toHaveLength(migrations.length);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
