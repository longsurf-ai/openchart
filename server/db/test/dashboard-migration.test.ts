// Purpose: Proves the dashboard JSON-to-tables upgrade preserves data and rolls back on invalid child rows.

import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";

const upgradeIndex = migrations.findIndex(
  (migration) => migration.id === "20260905185237_dashboard_tables",
);
if (upgradeIndex < 1)
  throw new Error("Dashboard upgrade must have a predecessor");
const predecessor = migrations.slice(0, upgradeIndex);

const schemaSql = sql`
  SELECT type, name,
    -- SQLite quotes renamed tables and columns differently from Drizzle's DDL.
    -- Generated DDL uses single quotes for string literals.
    replace(sql, char(34), char(96)) AS sql
  FROM sqlite_master
  -- ADD COLUMN and fresh DDL differ textually for Sessions. Its upgrade test
  -- compares column/foreign-key metadata and constraints instead.
  WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('app_schema_migrations', 'agent_sessions')
  ORDER BY type, name
`;

test("upgrades populated JSON rows with the same schema as a fresh database", async () => {
  const program = Effect.gen(function* () {
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, predecessor);
    const value = JSON.stringify({
      name: "Rates",
      favorite: true,
      widgets: [
        { id: "wdg_z", kind: "watchlist", resourceId: "wl_missing" },
        { id: "wdg_a", kind: "feed" },
      ],
    });
    const empty = JSON.stringify({
      name: "Empty",
      favorite: false,
      widgets: [],
    });
    yield* db.run(sql`
      INSERT INTO dashboard (id, revision, created_at, updated_at, value) VALUES
      ('dsh_old', 7, 100, 200, ${value}), ('dsh_empty', 1, 300, 300, ${empty})
    `);

    yield* DatabaseMigration.apply(db);
    // A second startup must neither duplicate child rows nor replay the upgrade.
    yield* DatabaseMigration.apply(db);
    return {
      dashboards: yield* db.all(
        sql`SELECT * FROM dashboard ORDER BY created_at`,
      ),
      widgets: yield* db.all(
        sql`SELECT * FROM dashboard_widget ORDER BY position`,
      ),
      foreignKeys: yield* db.all(sql`PRAGMA foreign_keys`),
      violations: yield* db.all(sql`PRAGMA foreign_key_check`),
      ledger: yield* db.all(
        sql`SELECT id FROM app_schema_migrations ORDER BY version`,
      ),
      schema: yield* db.all(schemaSql),
    };
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  );

  expect(result.dashboards).toEqual([
    {
      id: "dsh_old",
      revision: 8,
      created_at: 100,
      updated_at: expect.any(Number),
      name: "Rates",
      favorite: 1,
    },
    {
      id: "dsh_empty",
      revision: 1,
      created_at: 300,
      updated_at: 300,
      name: "Empty",
      favorite: 0,
    },
  ]);
  expect(result.widgets).toEqual([
    {
      id: "wdg_z",
      dashboard_id: "dsh_old",
      position: 0,
      kind: "watchlist",
      resource_id: "wl_missing",
      x: 0,
      y: 0,
      w: 12,
      h: 16,
    },
    {
      id: "wdg_a",
      dashboard_id: "dsh_old",
      position: 1,
      kind: "feed",
      resource_id: null,
      x: 0,
      y: 16,
      w: 12,
      h: 16,
    },
  ]);
  expect(result.foreignKeys).toEqual([{ foreign_keys: 1 }]);
  expect(result.violations).toEqual([]);
  expect(result.ledger).toEqual(migrations.map(({ id }) => ({ id })));

  const freshSchema = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.apply(db);
      return yield* db.all(schemaSql);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
  expect(result.schema).toEqual(freshSchema);
});

test("a failed child conversion preserves the original JSON rows and ledger", async () => {
  const value = JSON.stringify({
    name: "Duplicate widgets",
    favorite: false,
    widgets: [
      { id: "wdg_same", kind: "feed" },
      { id: "wdg_same", kind: "watchlist" },
    ],
  });
  const program = Effect.gen(function* () {
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, predecessor);
    yield* db.run(sql`
      INSERT INTO dashboard (id, revision, created_at, updated_at, value)
      VALUES ('dsh_old', 7, 100, 200, ${value})
    `);
    const before = yield* db.all(schemaSql);
    const exit = yield* Effect.exit(DatabaseMigration.apply(db));
    return {
      failed: Exit.isFailure(exit),
      before,
      after: yield* db.all(schemaSql),
      rows: yield* db.all(sql`SELECT * FROM dashboard`),
      ledger: yield* db.all(
        sql`SELECT id FROM app_schema_migrations ORDER BY version`,
      ),
    };
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  );

  expect(result.failed).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.rows).toEqual([
    { id: "dsh_old", revision: 7, created_at: 100, updated_at: 200, value },
  ]);
  expect(result.ledger).toEqual(predecessor.map(({ id }) => ({ id })));
});

test("adds DB timestamp defaults without changing existing timestamps or widget rows", async () => {
  const timestampIndex = migrations.findIndex(
    (migration) => migration.id === "20260905190404_resource_timestamps",
  );
  if (timestampIndex < 1)
    throw new Error("Timestamp migration must have a predecessor");
  const startedAt = new Date().getTime();
  const program = Effect.gen(function* () {
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, timestampIndex));
    yield* db.run(sql`
      INSERT INTO dashboard (id, revision, created_at, updated_at, name, favorite)
      VALUES ('dsh_old', 7, 100, 200, 'Historical', 1)
    `);
    yield* db.run(sql`
      INSERT INTO dashboard_widget (id, dashboard_id, position, kind, resource_id)
      VALUES ('wdg_old', 'dsh_old', 0, 'watchlist', 'wl_missing')
    `);
    const dashboards = yield* db.all(sql`SELECT * FROM dashboard`);
    const widgets = yield* db.all(sql`SELECT * FROM dashboard_widget`);
    yield* DatabaseMigration.applyOnly(
      db,
      migrations.slice(0, timestampIndex + 1),
    );
    expect(yield* db.all(sql`SELECT * FROM dashboard`)).toEqual(dashboards);
    expect(yield* db.all(sql`SELECT * FROM dashboard_widget`)).toEqual(widgets);
    expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(yield* db.all(sql`PRAGMA foreign_keys`)).toEqual([
      { foreign_keys: 1 },
    ]);

    // Raw SQL omits timestamps, proving they are persisted DB defaults.
    return yield* db.all<{ created_at: number; updated_at: number }>(sql`
      INSERT INTO dashboard (id, name) VALUES ('dsh_new', 'DB defaults')
      RETURNING created_at, updated_at
    `);
  });
  const rows = await Effect.runPromise(
    program.pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  );
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Insert must return its generated timestamps");
  expect(row.created_at).toBeGreaterThanOrEqual(startedAt);
  expect(row.created_at).toBeLessThanOrEqual(new Date().getTime());
  expect(Number.isInteger(row.created_at)).toBe(true);
  expect(row.updated_at).toBe(row.created_at);
});
