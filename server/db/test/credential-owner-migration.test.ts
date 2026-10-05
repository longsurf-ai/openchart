// Purpose: Verifies credential owner and OAuth metadata upgrades preserve existing data.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

const index = migrations.findIndex((migration) =>
  migration.id.endsWith("_credential-owner"),
);

test("preserves credentials, metadata, unrelated rows, and ledger through the owner upgrade", async () => {
  expect(index).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      const key = {
        type: "key",
        key: "api-secret",
        metadata: { account: "work" },
      };
      const oauth = {
        type: "oauth",
        methodID: "browser",
        access: "access-secret",
        refresh: "refresh-secret",
        expires: 1900000000000,
        metadata: {
          organization: "work",
          nested: { enabled: true },
          methodID: "provider-value",
        },
      };
      yield* db.run(sql`INSERT INTO credential
        (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated)
        VALUES ('cred_key', 'marketfeed', 'Work', ${JSON.stringify(key)}, 'legacy', 'key', 1, 10, 20),
               ('cred_oauth', 'calendar', 'Calendar', ${JSON.stringify(oauth)}, NULL, NULL, NULL, 30, 40),
               ('cred_unbound', NULL, 'Unbound', 'not-json', NULL, NULL, NULL, 50, 60)`);
      yield* db.run(sql`INSERT INTO dashboard (id, name, favorite, revision)
        VALUES ('dsh_owner_test', 'Existing', 1, 9)`);
      const dashboard = yield* db.all(sql`SELECT * FROM dashboard`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      const rows = yield* db.all<{
        id: string;
        owner: string | null;
        label: string;
        value: string;
        connector_id: string | null;
        method_id: string | null;
        active: number | null;
        time_created: number;
        time_updated: number;
      }>(sql`SELECT * FROM credential ORDER BY time_created`);
      expect(rows).toEqual([
        {
          id: "cred_key",
          owner: "integration:marketfeed",
          label: "Work",
          value: JSON.stringify(key),
          connector_id: "legacy",
          method_id: "key",
          active: 1,
          time_created: 10,
          time_updated: 20,
        },
        {
          id: "cred_oauth",
          owner: "integration:calendar",
          label: "Calendar",
          value: JSON.stringify({
            type: "oauth",
            access: oauth.access,
            refresh: oauth.refresh,
            expires: oauth.expires,
            metadata: { ...oauth.metadata, methodID: "browser" },
          }),
          connector_id: null,
          method_id: null,
          active: null,
          time_created: 30,
          time_updated: 40,
        },
        {
          id: "cred_unbound",
          owner: null,
          label: "Unbound",
          value: "not-json",
          connector_id: null,
          method_id: null,
          active: null,
          time_created: 50,
          time_updated: 60,
        },
      ]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboard);
      const after = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(after.slice(0, ledger.length)).toEqual(ledger);
      expect(after).toHaveLength(index + 1);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

test("invalid predecessor credentials roll back the entire migration", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(sql`INSERT INTO credential
        (id, integration_id, label, value, time_created, time_updated)
        VALUES ('cred_good', 'marketfeed', 'Good', '{"type":"key","key":"secret"}', 1, 1),
               ('cred_broken', 'calendar', 'Broken', '{"type":"oauth"}', 2, 2)`);
      const before = yield* db.all(sql`SELECT * FROM credential ORDER BY id`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      const exit = yield* DatabaseMigration.applyOnly(
        db,
        migrations.slice(0, index + 1),
      ).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* db.all(sql`SELECT * FROM credential ORDER BY id`)).toEqual(
        before,
      );
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
