// Purpose: Preserves rule/event history while admitting drawing-linked alert definitions.

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { DrawingAlertDefinition } from "@openchart/server/resources/alert-rule";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const inputs = {
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
};
const tea = (config: object) =>
  JSON.stringify({
    kind: "tea",
    source: '// keep exact text\nalertcondition(close > 200, "Above", "Above")',
    config,
  });
// A Tea config as stored before the tea-node-config migration, and one in the current shape.
const historicalTea = { parameters: {}, inputs, requests: {} };
const currentTea = { indicatorId: "ind_saved", parameters: {}, requests: {} };
const drawing = {
  kind: "drawing",
  drawingId: "drw_missing",
  operator: "crossing_up",
  inputs,
};

test.each(["upgrade", "fresh"])(
  "%s schema accepts drawing rules and preserves independent Tea rules",
  (mode) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        const at = migrations.findIndex((migration) =>
          migration.id.endsWith("_drawing-alerts"),
        );
        if (mode === "upgrade") {
          expect(at).toBeGreaterThan(0);
          expect(migrations[at - 1]?.id).toBe("20260923052528_alertable");
          yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
        } else {
          yield* DatabaseMigration.apply(db);
        }
        yield* db.run(sql`
          INSERT INTO alert_rule (id, revision, created_at, updated_at, name, enabled, repeat, alertable_json)
          VALUES ('alr_standalone', 7, 10, 20, 'Existing Tea', 1, 1, ${tea(mode === "upgrade" ? historicalTea : currentTea)})
        `);
        yield* db.run(sql`
          INSERT INTO alert_event (id, revision, created_at, updated_at, rule_id, condition, time, detail_json)
          VALUES ('ale_saved', 3, 30, 40, 'alr_standalone', 'above', 60000,
            '{"title":"Above","message":"Saved fire","data":{"price":201}}')
        `);
        yield* db.run(sql`
          INSERT INTO trigger (id, revision, created_at, updated_at, name, enabled, event_json, target_json)
          VALUES ('trg_saved', 4, 50, 60, 'Existing action', 1,
            '{"kind":"alert","ruleId":"alr_standalone"}',
            '{"kind":"notification","message":"{message}"}')
        `);
        const before = {
          rules: yield* db.all("SELECT * FROM alert_rule"),
          events: yield* db.all("SELECT * FROM alert_event"),
          triggers: yield* db.all("SELECT * FROM trigger"),
        };
        // Later migrations convert Tea configs; compare right after this one.
        yield* DatabaseMigration.applyOnly(
          db,
          mode === "upgrade" ? migrations.slice(0, at + 1) : migrations,
        );
        expect(yield* db.all("SELECT * FROM alert_rule")).toEqual(before.rules);
        expect(yield* db.all("SELECT * FROM alert_event")).toEqual(
          before.events,
        );
        expect(yield* db.all("SELECT * FROM trigger")).toEqual(before.triggers);
        expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
        yield* DatabaseMigration.applyOnly(db, migrations);

        for (const operator of DrawingAlertDefinition.fields.operator
          .literals) {
          const value = { ...drawing, operator };
          expect(
            Schema.decodeUnknownSync(DrawingAlertDefinition)(value),
          ).toEqual(value);
          yield* db.run(sql`
            INSERT INTO alert_rule (id, name, alertable_json)
            VALUES (${`alr_${operator}`}, 'Drawing alert', ${JSON.stringify(value)})
          `);
        }
        for (const change of [
          { kind: undefined },
          { kind: "file" },
          { drawingId: undefined },
          { drawingId: null },
          { drawingId: 12 },
          { drawingId: "" },
          { drawingId: "chart_wrong" },
          { operator: undefined },
          { operator: 12 },
          { operator: "unsupported" },
          { inputs: undefined },
          { inputs: [] },
          { inputs: { ...inputs, provider: "" } },
          { inputs: { ...inputs, listing: {} } },
          { inputs: { ...inputs, resolution: undefined } },
          { inputs: { ...inputs, resolution: "2m" } },
          { inputs: { ...inputs, session: null } },
          { inputs: { ...inputs, adjustment: "adjusted" } },
        ]) {
          const invalid = { ...drawing, ...change };
          expect(Schema.is(DrawingAlertDefinition)(invalid)).toBe(false);
          const result = yield* db
            .run(
              sql`
              INSERT INTO alert_rule (id, name, alertable_json)
              VALUES ('alr_invalid', 'Invalid', ${JSON.stringify(invalid)})
            `,
            )
            .pipe(Effect.exit);
          expect(result._tag).toBe("Failure");
        }
        expect(
          yield* db.all(
            "SELECT name FROM sqlite_temp_master WHERE name = 'drawing_alert_event_backup'",
          ),
        ).toEqual([]);
        yield* db.run("DELETE FROM alert_rule WHERE id = 'alr_standalone'");
        expect(yield* db.all("SELECT * FROM alert_event")).toEqual([]);
        expect(yield* db.all("SELECT * FROM trigger")).toEqual(before.triggers);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
);
