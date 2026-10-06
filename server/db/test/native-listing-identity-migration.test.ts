// Purpose: Preserve saved listings and drawings while migrating their native identity constraints.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

const at = migrations.findIndex(({ id }) =>
  id.endsWith("_native-listing-identity"),
);
const first = JSON.stringify({
  id: 10244,
  symbol: "SPCX",
  venue: "NASDAQ",
  currency: "USD",
});
const second = JSON.stringify({
  id: 55090,
  symbol: "SPCX",
  venue: "NASDAQ",
  currency: "USD",
});
const data = JSON.stringify({
  id: "gesture",
  type: "horizontal_line",
  anchors: [{ time: 1, price: 100 }],
});

test.each(["fresh", "replay", "upgrade"])(
  "%s retains distinct native listings and preserves saved Resource envelopes",
  (mode) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        expect(at).toBeGreaterThan(0);
        yield* db.run("PRAGMA foreign_keys=ON");
        if (mode === "fresh") yield* DatabaseMigration.apply(db);
        else
          yield* DatabaseMigration.applyOnly(
            db,
            mode === "upgrade" ? migrations.slice(0, at) : migrations,
          );
        yield* db.run(
          sql`INSERT INTO symbology (id, revision, created_at, updated_at, provider, listing) VALUES ('sym_saved', 7, 10, 20, 'openchart', ${first})`,
        );
        yield* db.run(
          'INSERT INTO symbology (id, provider, listing) VALUES (\'sym_yahoo\', \'yfinance\', \'{"symbol":"SPCX","venue":"NMS","currency":"USD"}\')',
        );
        yield* db.run(
          "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Saved')",
        );
        yield* db.run(
          sql`INSERT INTO drawing (id, revision, created_at, updated_at, dashboard_id, provider, listing, data) VALUES ('drw_saved', 7, 10, 20, 'dsh_saved', 'openchart', ${first}, ${data})`,
        );
        const saved = yield* db.all(
          "SELECT id, revision, created_at, updated_at, provider, listing FROM symbology ORDER BY id",
        );
        const drawings = yield* db.all("SELECT * FROM drawing");
        if (mode === "upgrade")
          expect(
            (yield* db
              .run(
                sql`INSERT INTO symbology (id, provider, listing) VALUES ('sym_second', 'openchart', ${second})`,
              )
              .pipe(Effect.result))._tag,
          ).toBe("Failure");
        yield* DatabaseMigration.applyOnly(db, migrations);
        expect(
          yield* db.all(
            "SELECT id, revision, created_at, updated_at, provider, listing FROM symbology ORDER BY id",
          ),
        ).toEqual(saved);
        expect(yield* db.all("SELECT * FROM drawing")).toEqual(drawings);
        yield* db.run(
          sql`INSERT INTO symbology (id, provider, listing) VALUES ('sym_second', 'openchart', ${second})`,
        );
        yield* db.run(
          sql`INSERT INTO drawing (id, dashboard_id, provider, listing, data) VALUES ('drw_second', 'dsh_saved', 'openchart', ${second}, ${data})`,
        );
        const renamed = JSON.stringify({
          id: 10244,
          symbol: "NEW",
          currency: "CAD",
        });
        expect(
          (yield* db
            .run(
              sql`INSERT INTO symbology (id, provider, listing) VALUES ('sym_duplicate', 'openchart', ${renamed})`,
            )
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(
          (yield* db
            .run(
              sql`INSERT INTO drawing (id, dashboard_id, provider, listing, data) VALUES ('drw_duplicate', 'dsh_saved', 'openchart', ${renamed}, ${data})`,
            )
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect((yield* db.all("SELECT id FROM symbology")).length).toBe(3);
        expect((yield* db.all("SELECT id FROM drawing")).length).toBe(2);
        expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
);

test("conflicting historical native identities roll back without discarding saved data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        sql`INSERT INTO symbology (id, provider, listing) VALUES ('sym_first', 'openchart', ${first})`,
      );
      yield* db.run(
        sql`INSERT INTO symbology (id, provider, listing) VALUES ('sym_second', 'openchart', ${JSON.stringify({ id: 10244, symbol: "NEW", currency: "USD" })})`,
      );
      const before = yield* db.all("SELECT * FROM symbology ORDER BY id");
      const ledger = yield* db.all(
        "SELECT * FROM app_schema_migrations ORDER BY version",
      );
      expect(
        (yield* DatabaseMigration.applyOnly(db, migrations).pipe(Effect.result))
          ._tag,
      ).toBe("Failure");
      expect(yield* db.all("SELECT * FROM symbology ORDER BY id")).toEqual(
        before,
      );
      expect(
        yield* db.all("SELECT * FROM app_schema_migrations ORDER BY version"),
      ).toEqual(ledger);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));
