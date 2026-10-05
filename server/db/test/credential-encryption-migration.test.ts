// Purpose: Verifies retiring plaintext grants preserves unrelated data, history, and later encrypted values.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

const index = migrations.findIndex((migration) =>
  migration.id.endsWith("_credential-encryption"),
);

test("removes only predecessor credentials and never repeats the reset", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
        VALUES ('cred_key', 'marketfeed', 'Key', '{"type":"key","key":"secret"}', 1, 1),
               ('cred_oauth', 'openchart-cloud', 'OAuth', '{"type":"oauth","access":"a","refresh":"r","expires":10,"methodID":"browser"}', 2, 2),
               ('cred_unbound', NULL, 'Legacy', 'old-secret', 3, 3)`);
      yield* db.run(sql`INSERT INTO dashboard (id, name, favorite, revision)
        VALUES ('dsh_encryption_test', 'Existing', 1, 9)`);
      const dashboard = yield* db.all(sql`SELECT * FROM dashboard`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM credential`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboard);
      const after = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(after.slice(0, ledger.length)).toEqual(ledger);
      expect(after).toHaveLength(migrations.length);
      yield* db.run(sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
        VALUES ('cred_new', 'marketfeed', 'New', 'opaque-ciphertext', 4, 4)`);
      const saved = yield* db.all(sql`SELECT * FROM credential`);
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all(sql`SELECT * FROM credential`)).toEqual(saved);
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(after);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  ));
