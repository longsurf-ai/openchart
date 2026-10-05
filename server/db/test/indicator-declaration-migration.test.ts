// Purpose: Moves saved Indicators' `// @indicator` comments to a leading indicator() declaration once, touching nothing else.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Cause, Effect, Exit, Schema } from "effect";
import { compileToProgram, Errors } from "tea/compiler";
import { expect, test } from "vitest";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { IndicatorEntity } from "@openchart/server/resources/indicator/entity";
import { indicatorTable } from "@openchart/server/resources/indicator/schema";

const at = migrations.findIndex(({ id }) =>
  id.endsWith("_indicator-declaration"),
);
const plot = 'plot("value", close, "Value")\n';
// One spelling of a title as both a JSON string and a Tea string literal.
const quoted = String.raw`"Say \"hi\" \\ 50%"`;
// An imported file is not the entry, so its header comment stays as stored.
const library =
  'library("double")\n// @indicator {"title": "Library", "overlay": true}\nexport twice(float x) => x * 2\n';

// Snapshots before and after the migration, ordered by id like the rows read
// back, with the declaration Tea compiles from each migrated entry.
const indicators = [
  {
    id: "ind_comment",
    path: "edited.tea",
    // The blank line between the comment and the header stays.
    before: {
      "edited.tea": `// Edited by user ✎\n\n// @indicator {"title":"Edited SMA","overlay":false}\nimport ./lib/double\nplot("value", double.twice(close), "Value")\n`,
      "lib/double.tea": library,
    },
    after: {
      "edited.tea": `indicator("Edited SMA", overlay = false)\n// Edited by user ✎\n\nimport ./lib/double\nplot("value", double.twice(close), "Value")\n`,
      "lib/double.tea": library,
    },
    declaration: { title: "Edited SMA", overlay: false },
  },
  {
    // A lone \r ends the regex's line but not Tea's, so the dead text after it
    // was comment and goes too. Control characters in the title stay raw.
    id: "ind_cr_after",
    path: "cr-after.tea",
    before: {
      "cr-after.tea": `// @indicator {"title":"A\\rB\\u0001C","overlay":true}\rplot("debug", open, "Debug")\n${plot}`,
    },
    after: {
      "cr-after.tea": `indicator("A\rB\u0001C", overlay = true)\n${plot}`,
    },
    declaration: { title: "A\rB\u0001C", overlay: true },
  },
  {
    // Code before a lone \r shares the header's Tea line and stays.
    id: "ind_cr_before",
    path: "cr-before.tea",
    before: {
      "cr-before.tea": `len = 2\r// @indicator {"title":"B","overlay":false}\nplot("value", close * len, "Value")\n`,
    },
    after: {
      "cr-before.tea": `indicator("B", overlay = false)\nlen = 2\r\nplot("value", close * len, "Value")\n`,
    },
    declaration: { title: "B", overlay: false },
  },
  {
    id: "ind_first",
    path: "sma.tea",
    before: {
      "sma.tea": `// @indicator {"title": "SMA", "overlay": true}\n${plot}`,
    },
    after: { "sma.tea": `indicator("SMA", overlay = true)\n${plot}` },
    declaration: { title: "SMA", overlay: true },
  },
  {
    // Already declared by Tea: no old header, so nothing changes.
    id: "ind_new",
    path: "new.tea",
    before: { "new.tea": `indicator("New", overlay = false)\n${plot}` },
    after: { "new.tea": `indicator("New", overlay = false)\n${plot}` },
    declaration: { title: "New", overlay: false },
  },
  {
    // A CRLF file: the header line goes with its line break.
    id: "ind_quote",
    path: "quote.tea",
    before: {
      "quote.tea": `// @indicator {"title":${quoted},"overlay":false}\r\nplot("value", close, "Value")\r\n`,
    },
    after: {
      "quote.tea": `indicator(${quoted}, overlay = false)\nplot("value", close, "Value")\r\n`,
    },
    declaration: { title: 'Say "hi" \\ 50%', overlay: false },
  },
];

const seed = Effect.fn("test.seedIndicatorDeclarationPredecessor")(function* (
  rows: readonly { id: string; path: string; before: object }[],
) {
  expect(at).toBeGreaterThan(0);
  expect(migrations[at - 1]?.id).toBe("20261001085000_tea-node-config");
  const db = yield* makeWithDefaults();
  yield* db.run("PRAGMA foreign_keys = ON");
  yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
  yield* db.run(
    sql`INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Charts')`,
  );
  yield* db.run(
    sql`INSERT INTO chart (id, dashboard_id) VALUES ('cht_saved', 'dsh_saved')`,
  );
  for (const { id, path, before } of rows) {
    yield* db.run(sql`
      INSERT INTO indicator (id, revision, created_at, updated_at, chart_id, cell_id,
        workspace_id, script_path, snapshot, parameter_overrides)
      VALUES (${id}, 4, 10, 20, 'cht_saved', 'ccl_saved', 'wsp_saved', ${path},
        ${JSON.stringify(before)}, '{"length":14}')
    `);
  }
  return db;
});

test("moves each entry's @indicator header to a leading indicator() declaration once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* seed(indicators);
      const saved = yield* db
        .select()
        .from(indicatorTable)
        .orderBy(indicatorTable.id);

      yield* DatabaseMigration.apply(db);
      const migrated = yield* db
        .select()
        .from(indicatorTable)
        .orderBy(indicatorTable.id);
      // Only entry texts change; revisions, timestamps and other files stay.
      expect(migrated).toEqual(
        saved.map((row, index) => ({
          ...row,
          snapshot: indicators[index]!.after,
        })),
      );
      for (const [index, row] of migrated.entries()) {
        const { workspaceId, scriptPath, ...fields } = row;
        const entity = { ...fields, source: { workspaceId, path: scriptPath } };
        expect(Schema.decodeUnknownSync(IndicatorEntity)(entity)).toEqual(
          entity,
        );
        // The migrated snapshot compiles as the server compiles it, with the header.
        const errors = new Errors();
        const compiled = compileToProgram(
          [
            {
              filename: scriptPath,
              source: row.snapshot[scriptPath]!,
              imports: row.snapshot,
            },
          ],
          errors,
          { includeSources: true },
        );
        expect(errors.flushErrors()).toEqual([]);
        expect(compiled?.sources).toEqual(row.snapshot);
        // The header's timeframe defaults to "", the chart's bars.
        expect(compiled?.program.declaration).toEqual({
          kind: "indicator",
          timeframe: "",
          ...indicators[index]!.declaration,
        });
      }

      // A complete ledger runs nothing again.
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(ledger).toHaveLength(migrations.length);
      yield* DatabaseMigration.apply(db);
      expect(
        yield* db.select().from(indicatorTable).orderBy(indicatorTable.id),
      ).toEqual(migrated);
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));

test.each([
  [
    "an unknown @indicator header",
    `// @indicator {"title":"Untitled"}\n${plot}`,
  ],
  [
    "more than one @indicator header",
    `// @indicator {"title":"A","overlay":true}\n// @indicator {"title":"B","overlay":true}\n${plot}`,
  ],
])("fails on %s and changes nothing", (problem, text) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* seed([
        ...indicators,
        {
          id: "ind_unknown",
          path: "unknown.tea",
          before: { "unknown.tea": text },
        },
      ]);
      const saved = yield* db.all("SELECT * FROM indicator ORDER BY id");

      const result = yield* DatabaseMigration.apply(db).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        // An Error, so the startup defect keeps a stack and the cause.
        expect(Cause.squash(result.cause)).toBeInstanceOf(Error);
        expect(Cause.pretty(result.cause)).toContain(
          `Indicator ind_unknown has ${problem}`,
        );
      }
      expect(yield* db.all("SELECT * FROM indicator ORDER BY id")).toEqual(
        saved,
      );
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations WHERE id = ${migrations[at]!.id}`,
        ),
      ).toEqual([]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ),
);
