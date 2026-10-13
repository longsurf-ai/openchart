// Purpose: Keeps saved research columns readable after removing their result type.
import * as NodeSqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("removes text and number settings without changing other column data", async () => {
  const at = migrations.findIndex((migration) =>
    migration.id.endsWith("_watchlist-research-text"),
  );
  expect(at).toBeGreaterThan(0);
  const prompt = {
    agent: "analyst",
    model: { providerID: "codex", modelID: "tier1" },
    parts: [{ type: "text", text: "Return a score as text." }],
  };
  const price = { id: "wcl_price", metric: { kind: "price" } };
  const columns = [
    {
      id: "wcl_text",
      title: "Summary",
      visible: false,
      metric: { kind: "semantic", prompt, resultType: "text" },
    },
    price,
    {
      id: "wcl_score",
      metric: { kind: "semantic", prompt, resultType: "number" },
    },
    { id: "wcl_current", metric: { kind: "semantic", prompt } },
  ];
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      for (const [id, values] of [
        ["wtl_research", columns],
        ["wtl_price", [price]],
      ] as const)
        yield* db.run(sql`
          INSERT INTO watchlist (id, name, columns, revision)
          VALUES (${id}, 'Research', ${JSON.stringify(values)}, 7)
        `);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      const read = () =>
        db.all<{ id: string; columns: string; revision: number }>(
          "SELECT id, columns, revision FROM watchlist ORDER BY id",
        );
      const rows = yield* read();
      expect(
        rows.map((row) => ({ ...row, columns: JSON.parse(row.columns) })),
      ).toEqual([
        { id: "wtl_price", columns: [price], revision: 7 },
        {
          id: "wtl_research",
          revision: 8,
          columns: [
            {
              id: "wcl_text",
              title: "Summary",
              visible: false,
              metric: { kind: "semantic", prompt },
            },
            price,
            { id: "wcl_score", metric: { kind: "semantic", prompt } },
            { id: "wcl_current", metric: { kind: "semantic", prompt } },
          ],
        },
      ]);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      expect(yield* read()).toEqual(rows);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
