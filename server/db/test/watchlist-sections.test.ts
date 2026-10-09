// Purpose: Verifies nested section ownership, sibling ordering, and subtree deletion in SQLite.

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Exit } from "effect";
import { expect, test } from "vitest";

test.each(["fresh", "migrated"] as const)(
  "%s database supports nested sections with sibling ordering and subtree deletion",
  async (mode) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        yield* db.run("PRAGMA foreign_keys = ON");
        if (mode === "fresh") yield* DatabaseMigration.apply(db);
        else yield* DatabaseMigration.applyOnly(db, migrations);

        yield* db.run(sql`
          INSERT INTO watchlist (id, name) VALUES
          ('wtl_one', 'First'), ('wtl_two', 'Second')
        `);
        const columns = [
          { id: "wcl_price", metric: { kind: "price" } },
          { id: "wcl_volume", metric: { kind: "volume" } },
        ];
        yield* db.run(sql`
          UPDATE watchlist SET columns = ${JSON.stringify(columns)} WHERE id = 'wtl_one'
        `);
        expect(
          yield* db.all(sql`SELECT id, columns FROM watchlist ORDER BY id`),
        ).toEqual([
          { id: "wtl_one", columns: JSON.stringify(columns) },
          { id: "wtl_two", columns: "[]" },
        ]);
        // The same position is valid under different parents and watchlists.
        yield* db.run(sql`
          INSERT INTO watchlist_section (id, watchlist_id, parent_section_id, position, name) VALUES
          ('wsc_root', 'wtl_one', NULL, 0, 'Root'),
          ('wsc_sibling', 'wtl_one', NULL, 1, 'Sibling'),
          ('wsc_other', 'wtl_two', NULL, 0, 'Other'),
          ('wsc_child', 'wtl_one', 'wsc_root', 0, 'Child'),
          ('wsc_grandchild', 'wtl_one', 'wsc_child', 0, 'Grandchild'),
          ('wsc_cousin', 'wtl_one', 'wsc_sibling', 0, NULL)
        `);
        yield* db.run(sql`
          INSERT INTO watchlist_item (id, watchlist_id, section_id, position, provider, listing) VALUES
          ('wit_root', 'wtl_one', 'wsc_root', 0, 'yfinance', '{"symbol":"AAPL","currency":"USD"}'),
          ('wit_child', 'wtl_one', 'wsc_child', 0, 'yfinance', '{"symbol":"MSFT","currency":"USD"}'),
          ('wit_grandchild', 'wtl_one', 'wsc_grandchild', 0, 'yfinance', '{"symbol":"NVDA","currency":"USD"}'),
          ('wit_cousin', 'wtl_one', 'wsc_cousin', 0, 'yfinance', '{"symbol":"AMD","currency":"USD"}')
        `);

        const invalidWrites = [
          // Root positions must be unique despite their NULL parent.
          sql`INSERT INTO watchlist_section (id, watchlist_id, position) VALUES ('wsc_duplicate_root', 'wtl_one', 0)`,
          sql`INSERT INTO watchlist_section (id, watchlist_id, parent_section_id, position) VALUES ('wsc_duplicate_child', 'wtl_one', 'wsc_root', 0)`,
          sql`UPDATE watchlist_section SET parent_section_id = 'wsc_root' WHERE id = 'wsc_cousin'`,
          sql`INSERT INTO watchlist_section (id, watchlist_id, parent_section_id, position) VALUES ('wsc_foreign', 'wtl_two', 'wsc_root', 1)`,
          sql`UPDATE watchlist_section SET parent_section_id = 'wsc_other' WHERE id = 'wsc_child'`,
          sql`INSERT INTO watchlist_section (id, watchlist_id, parent_section_id, position) VALUES ('wsc_missing', 'wtl_one', 'wsc_unknown', 0)`,
          sql`INSERT INTO watchlist_section (id, watchlist_id, parent_section_id, position) VALUES ('wsc_self', 'wtl_one', 'wsc_self', 0)`,
          sql`UPDATE watchlist_section SET parent_section_id = id WHERE id = 'wsc_child'`,
          // Listing uniqueness still spans the entire tree.
          sql`INSERT INTO watchlist_item (id, watchlist_id, section_id, position, provider, listing) VALUES ('wit_duplicate', 'wtl_one', 'wsc_cousin', 1, 'yfinance', '{"symbol":"NVDA","currency":"USD"}')`,
        ];
        for (const statement of invalidWrites) {
          expect(Exit.isFailure(yield* Effect.exit(db.run(statement)))).toBe(
            true,
          );
        }

        yield* db.run(sql`DELETE FROM watchlist_section WHERE id = 'wsc_root'`);
        expect(
          yield* db.all(sql`SELECT id FROM watchlist_section ORDER BY id`),
        ).toEqual([
          { id: "wsc_cousin" },
          { id: "wsc_other" },
          { id: "wsc_sibling" },
        ]);
        expect(
          yield* db.all(sql`SELECT id FROM watchlist_item ORDER BY id`),
        ).toEqual([{ id: "wit_cousin" }]);

        yield* db.run(sql`DELETE FROM watchlist WHERE id = 'wtl_one'`);
        expect(yield* db.all(sql`SELECT id FROM watchlist_section`)).toEqual([
          { id: "wsc_other" },
        ]);
        expect(yield* db.all(sql`SELECT id FROM watchlist_item`)).toEqual([]);
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    );
  },
);
