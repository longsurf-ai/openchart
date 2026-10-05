// Purpose: Verifies enabling existing encrypted credentials and persisting explicit inactive state.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

test("upgrades the immediate predecessor without decrypting or losing credentials or unrelated data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const index = migrations.findIndex((migration) =>
        migration.id.endsWith("_credential-active"),
      );
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`INSERT INTO credential
      (id, integration_id, label, value, active, time_created, time_updated)
      VALUES ('cred_key', 'openchart-cloud', 'User', 'encrypted-key-and-profile', NULL, 1, 2),
             ('cred_oauth', 'calendar', 'OAuth', 'encrypted-oauth', 0, 3, 4),
             ('cred_other', 'third-party', 'Other', 'other-ciphertext', 1, 5, 6),
             ('cred_unbound', NULL, 'Legacy', 'opaque-legacy', 42, 7, 8)`);
      yield* db.run(sql`INSERT INTO dashboard (id, name, favorite, revision)
      VALUES ('dsh_active_test', 'Existing', 1, 9)`);
      const before = yield* db.all<Record<string, unknown>>(
        sql`SELECT * FROM credential ORDER BY id`,
      );
      const dashboards = yield* db.all(sql`SELECT * FROM dashboard`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM credential ORDER BY id`)).toEqual(
        before.map((row) => ({ ...row, active: 1 })),
      );
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      const afterLedger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(afterLedger.slice(0, ledger.length)).toEqual(ledger);
      expect(afterLedger).toHaveLength(migrations.length);
      for (const invalid of [null, -1, 2]) {
        expect(
          Exit.isFailure(
            yield* db
              .run(
                sql`UPDATE credential SET active = ${invalid} WHERE id = 'cred_key'`,
              )
              .pipe(Effect.exit),
          ),
        ).toBe(true);
      }
      yield* db.run(
        sql`UPDATE credential SET active = 0 WHERE id = 'cred_key'`,
      );
      const inactive = yield* db.all(sql`SELECT * FROM credential ORDER BY id`);
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM credential ORDER BY id`)).toEqual(
        inactive,
      );
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(afterLedger);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  ));
