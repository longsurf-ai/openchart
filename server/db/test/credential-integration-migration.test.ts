// Purpose: Proves restoring integration credential identities preserves tokens and migration history.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

const index = migrations.findIndex((migration) =>
  migration.id.endsWith("_credential-integration"),
);

test("restores integration and OAuth method identities while preserving credentials and unrelated data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(index).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      const key = {
        type: "key",
        key: "api-secret",
        metadata: { account: "work" },
      };
      const oauth = {
        type: "oauth",
        access: "access-secret",
        refresh: "refresh-secret",
        expires: 1900000000000,
        metadata: { methodID: "browser", user: { email: "user@example.com" } },
      };
      yield* db.run(sql`INSERT INTO credential
        (id, owner, label, value, connector_id, method_id, active, time_created, time_updated)
        VALUES ('cred_key', 'integration:marketfeed', 'Work', ${JSON.stringify(key)}, 'legacy', 'key', 1, 10, 20),
               ('cred_oauth', 'integration:openchart-cloud', 'Account', ${JSON.stringify(oauth)}, NULL, NULL, NULL, 30, 40),
               ('cred_unbound', NULL, 'Unbound', 'not-json', NULL, NULL, NULL, 50, 60)`);
      yield* db.run(sql`INSERT INTO dashboard (id, name, favorite, revision)
        VALUES ('dsh_integration_test', 'Existing', 1, 9)`);
      const dashboard = yield* db.all(sql`SELECT * FROM dashboard`);
      const before = yield* db.all<Record<string, unknown>>(
        sql`SELECT * FROM credential ORDER BY time_created`,
      );
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      const rows = yield* db.all<Record<string, unknown>>(
        sql`SELECT * FROM credential ORDER BY time_created`,
      );
      expect(rows).toEqual(
        before.map(({ owner, ...row }) => ({
          ...row,
          integration_id:
            typeof owner === "string"
              ? owner.slice("integration:".length)
              : owner,
          value:
            row.id === "cred_oauth"
              ? JSON.stringify({
                  type: "oauth",
                  access: oauth.access,
                  refresh: oauth.refresh,
                  expires: oauth.expires,
                  methodID: "browser",
                  metadata: { user: oauth.metadata.user },
                })
              : row.value,
        })),
      );
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboard);
      const after = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(after.slice(0, ledger.length)).toEqual(ledger);
      expect(after).toHaveLength(index + 1);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  ));

test.each([
  { owner: "auth:openchart", value: { type: "key", key: "secret" } },
  {
    owner: "integration:openchart-cloud",
    value: {
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: 10,
      metadata: {},
    },
  },
])(
  "invalid predecessor rolls back schema, credentials, and ledger: $owner",
  (input) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
        yield* db.run(sql`INSERT INTO credential
        (id, owner, label, value, time_created, time_updated)
        VALUES ('cred_good', 'integration:marketfeed', 'Good', '{"type":"key","key":"secret"}', 1, 1),
               ('cred_bad', ${input.owner}, 'Bad', ${JSON.stringify(input.value)}, 2, 2)`);
        const before = yield* db.all(sql`SELECT * FROM credential ORDER BY id`);
        const ledger = yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        );
        const columns = yield* db.all(sql`PRAGMA table_info(credential)`);
        const result = yield* DatabaseMigration.apply(db).pipe(Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
        expect(
          yield* db.all(sql`SELECT * FROM credential ORDER BY id`),
        ).toEqual(before);
        expect(yield* db.all(sql`PRAGMA table_info(credential)`)).toEqual(
          columns,
        );
        expect(
          yield* db.all(
            sql`SELECT * FROM app_schema_migrations ORDER BY version`,
          ),
        ).toEqual(ledger);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
    ),
);
