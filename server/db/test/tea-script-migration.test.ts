// Purpose: Verifies Tea script migration preserves existing resources and constrains version ownership.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("upgrades populated resources and enforces Tea script version ownership", async () => {
  const upgradeIndex = migrations.findIndex(
    (migration) => migration.id === "20260906005122_tea-script",
  );
  expect(upgradeIndex).toBeGreaterThan(0);

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, upgradeIndex));
      yield* db.run(sql`
        INSERT INTO dashboard (id, revision, created_at, updated_at, name, favorite)
        VALUES ('dsh_old', 7, 100, 200, 'Historical', 1)
      `);
      yield* db.run(sql`
        INSERT INTO chart (id, dashboard_id, revision, created_at, updated_at)
        VALUES ('cht_old', 'dsh_old', 3, 100, 200)
      `);
      const dashboards = yield* db.all(sql`SELECT * FROM dashboard`);
      const charts = yield* db.all(sql`SELECT * FROM chart`);

      const history = migrations.slice(0, upgradeIndex + 1);
      yield* DatabaseMigration.applyOnly(db, history);
      yield* DatabaseMigration.applyOnly(db, history);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM chart`)).toEqual(charts);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(history.map(({ id }) => ({ id })));
      expect(yield* db.all(sql`SELECT * FROM tea_script`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM tea_script_version`)).toEqual([]);

      yield* db.run(sql`
        INSERT INTO tea_script (id, name, draft_source)
        VALUES ('tea_a', 'First', ''), ('tea_b', 'Second', 'unfinished (')
      `);
      expect(
        yield* db.all(sql`SELECT current_version_id FROM tea_script`),
      ).toEqual([{ current_version_id: null }, { current_version_id: null }]);
      yield* db.run(sql`
        INSERT INTO tea_script_version (script_id, version_id, source)
        VALUES ('tea_a', 'tsv_a', 'first source'), ('tea_b', 'tsv_b', 'second source')
      `);
      yield* db.run(sql`
        UPDATE tea_script SET current_version_id = 'tsv_a' WHERE id = 'tea_a'
      `);
      const invalidWrites = [
        sql`UPDATE tea_script SET draft_source = NULL WHERE id = 'tea_a'`,
        sql`UPDATE tea_script SET name = '' WHERE id = 'tea_a'`,
        sql`UPDATE tea_script SET current_version_id = '' WHERE id = 'tea_a'`,
        sql`UPDATE tea_script SET current_version_id = 'tsv_b' WHERE id = 'tea_a'`,
        sql`UPDATE tea_script SET current_version_id = 'tsv_missing' WHERE id = 'tea_a'`,
        sql`INSERT INTO tea_script_version (script_id, version_id, source)
            VALUES ('tea_missing', 'tsv_orphan', 'orphan')`,
        sql`INSERT INTO tea_script_version (script_id, version_id, source)
            VALUES ('tea_a', 'tsv_a', 'duplicate')`,
        sql`DELETE FROM tea_script_version WHERE script_id = 'tea_a'`,
      ];
      for (const statement of invalidWrites) {
        expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
          true,
        );
      }
      yield* db.run(sql`DELETE FROM tea_script WHERE id = 'tea_a'`);
      expect(
        yield* db.all(
          sql`SELECT script_id, version_id FROM tea_script_version`,
        ),
      ).toEqual([{ script_id: "tea_b", version_id: "tsv_b" }]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM chart`)).toEqual(charts);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
