// Purpose: Verify scoped Drawing identity constraints on fresh, replayed and upgraded databases.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

const at = migrations.findIndex(({ id }) =>
  id.endsWith("_drawing-state-constraints"),
);
const data = JSON.stringify({
  id: "gesture",
  type: "trend_line",
  anchors: [
    { time: 1, price: 100 },
    { time: 2, price: 110 },
  ],
});
const listing = JSON.stringify({ symbol: "AAPL", currency: "USD" });

test.each(["fresh", "replay", "upgrade"])(
  "%s enforces Drawing identity without changing existing rows",
  (mode) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        expect(at).toBeGreaterThan(0);
        if (mode === "fresh") yield* DatabaseMigration.apply(db);
        else
          yield* DatabaseMigration.applyOnly(
            db,
            mode === "upgrade" ? migrations.slice(0, at) : migrations,
          );
        yield* db.run(
          "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Saved')",
        );
        yield* db.run(
          sql`INSERT INTO drawing (id, revision, created_at, updated_at, dashboard_id, provider, listing, data) VALUES ('drw_saved', 7, 10, 20, 'dsh_saved', 'yfinance', ${listing}, ${data})`,
        );
        const before = yield* db.all("SELECT * FROM drawing");
        yield* DatabaseMigration.applyOnly(db, migrations);
        expect(yield* db.all("SELECT * FROM drawing")).toEqual(before);
        const duplicate = yield* db
          .run(
            sql`INSERT INTO drawing (id, dashboard_id, provider, listing, data) VALUES ('drw_duplicate', 'dsh_saved', 'yfinance', ${JSON.stringify({ currency: "USD", name: "Apple", symbol: "AAPL" })}, ${data})`,
          )
          .pipe(Effect.exit);
        expect(duplicate._tag).toBe("Failure");
        yield* db.run(
          sql`INSERT INTO drawing (id, dashboard_id, provider, listing, data) VALUES ('drw_other', 'dsh_saved', 'yfinance', ${JSON.stringify({ symbol: "AAPL", currency: "USD", venue: "" })}, ${data})`,
        );
        const collision = yield* db
          .run(
            sql`UPDATE drawing SET listing = ${listing} WHERE id = 'drw_other'`,
          )
          .pipe(Effect.exit);
        expect(collision._tag).toBe("Failure");
        expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
);

test("conflicting historical identities fail migration atomically without deleting or renaming drawings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Saved')",
      );
      for (const id of ["drw_first", "drw_second"])
        yield* db.run(
          sql`INSERT INTO drawing (id, dashboard_id, provider, listing, data) VALUES (${id}, 'dsh_saved', 'yfinance', ${listing}, ${data})`,
        );
      const before = yield* db.all("SELECT * FROM drawing ORDER BY id");
      const ledger = yield* db.all(
        "SELECT * FROM app_schema_migrations ORDER BY version",
      );
      const result = yield* DatabaseMigration.applyOnly(db, migrations).pipe(
        Effect.exit,
      );
      expect(result._tag).toBe("Failure");
      expect(yield* db.all("SELECT * FROM drawing ORDER BY id")).toEqual(
        before,
      );
      expect(
        yield* db.all("SELECT * FROM app_schema_migrations ORDER BY version"),
      ).toEqual(ledger);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));
