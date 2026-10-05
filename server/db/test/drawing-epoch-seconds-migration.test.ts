// Purpose: Preserve saved drawing content while upgrading only chart time coordinates.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const at = migrations.findIndex(({ id }) =>
  id.endsWith("_drawing-epoch-seconds"),
);
const instant = 1775534400;
const annotation = Drawing.create("annotation", [], {
  id: "annotation",
  time: instant,
  title: "PANW catalyst",
  body: "Keep the research.",
  sources: [{ title: "Source", url: "https://example.com/news" }],
  sentiment: 0.5,
  labelAnchor: { time: instant, price: 190 },
});

test("migrates legacy dates, calendar objects and milliseconds once; preserves resource identity and content", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect(at).toBeGreaterThan(0);
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Saved')",
      );
      const fixtures = [
        {
          ...annotation,
          time: "2026-04-07T00:00:00-04:00",
          labelAnchor: { time: instant * 1000, price: 190 },
        },
        {
          ...annotation,
          id: "date",
          time: "2026-04-07",
          labelAnchor: { time: { year: 2026, month: 4, day: 10 }, price: 138 },
        },
        Drawing.create(
          "trend_line",
          [
            { time: instant, price: 100 },
            { time: instant + 60.125, price: 110 },
          ],
          { id: "line" },
        ),
        {
          ...Drawing.create(
            "trend_line",
            [
              { time: instant, price: 100 },
              { time: instant + 60, price: 110 },
            ],
            { id: "old-line" },
          ),
          anchors: [
            { time: "2026-04-07T04:00:00Z", price: 100 },
            { time: (instant + 60) * 1000, price: 110 },
          ],
        },
        {
          ...Drawing.create("trend_line", [], { id: "session" }),
          type: "agent_session",
          range: { from: instant * 1000, to: (instant + 60) * 1000 },
        },
      ];
      for (const [index, data] of fixtures.entries())
        yield* db.run(sql`INSERT INTO drawing (id, revision, created_at, updated_at, dashboard_id, provider, listing, data)
        VALUES (${`drw_${index}`}, 4, 10, 20, 'dsh_saved', 'yfinance', '{"symbol":"PANW","currency":"USD"}', ${JSON.stringify(data)})`);
      const before = yield* db.all<{ id: string; data: string }>(
        "SELECT * FROM drawing ORDER BY id",
      );
      yield* DatabaseMigration.apply(db);
      const after = yield* db.all<{ id: string; data: string }>(
        "SELECT * FROM drawing ORDER BY id",
      );
      const expected = [
        annotation,
        {
          ...fixtures[1],
          time: 1775520000,
          labelAnchor: { time: 1775779200, price: 138 },
        },
        fixtures[2],
        {
          ...fixtures[3],
          anchors: [
            { time: instant, price: 100 },
            { time: instant + 60, price: 110 },
          ],
        },
        fixtures[4],
      ];
      expect(after).toEqual(
        before.map((row, index) => ({
          ...row,
          data: JSON.stringify(expected[index]),
        })),
      );
      for (const row of after)
        expect(Schema.is(Drawing.SavedItem)(JSON.parse(row.data))).toBe(true);
      const ledger = yield* db.all(
        "SELECT * FROM app_schema_migrations ORDER BY version",
      );
      yield* DatabaseMigration.apply(db);
      expect(yield* db.all("SELECT * FROM drawing ORDER BY id")).toEqual(after);
      expect(
        yield* db.all("SELECT * FROM app_schema_migrations ORDER BY version"),
      ).toEqual(ledger);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));

test("invalid stored times fail atomically without deleting drawings or advancing the ledger", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard (id, name) VALUES ('dsh_saved', 'Saved')",
      );
      for (const [id, time] of [
        ["valid", "2026-04-07"],
        ["invalid", "not-a-date"],
      ])
        yield* db.run(sql`INSERT INTO drawing (id, dashboard_id, provider, listing, data)
        VALUES (${id}, 'dsh_saved', 'yfinance', '{"symbol":"PANW","currency":"USD"}', ${JSON.stringify({ ...annotation, id, time })})`);
      const before = yield* db.all("SELECT * FROM drawing ORDER BY id");
      const ledger = yield* db.all(
        "SELECT * FROM app_schema_migrations ORDER BY version",
      );
      expect((yield* DatabaseMigration.apply(db).pipe(Effect.exit))._tag).toBe(
        "Failure",
      );
      expect(yield* db.all("SELECT * FROM drawing ORDER BY id")).toEqual(
        before,
      );
      expect(
        yield* db.all("SELECT * FROM app_schema_migrations ORDER BY version"),
      ).toEqual(ledger);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));
