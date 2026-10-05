// Purpose: Verify adding Drawing Resources preserves populated dashboard/chart data.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

test("adds drawing storage without replacing existing dashboard or chart rows", async () => {
  const index = migrations.findIndex(
    (migration) => migration.id === "20260917065129_drawing_resource",
  );
  expect(index).toBeGreaterThan(0);
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys = ON");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index));
      yield* db.run(
        sql`INSERT INTO dashboard (id, name) VALUES ('dsh_existing', 'Research')`,
      );
      yield* db.run(
        sql`INSERT INTO chart (id, dashboard_id) VALUES ('cht_existing', 'dsh_existing')`,
      );
      const dashboards = yield* db.all(sql`SELECT * FROM dashboard`);
      const charts = yield* db.all(sql`SELECT * FROM chart`);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, index + 1));
      expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
      expect(yield* db.all(sql`SELECT * FROM chart`)).toEqual(charts);
      expect(yield* db.all(sql`SELECT * FROM drawing`)).toEqual([]);
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  );
});
