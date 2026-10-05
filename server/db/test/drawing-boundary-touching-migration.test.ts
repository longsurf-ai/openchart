// Purpose: Admit Touch without changing saved drawing rules, events, actions or migration history.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { DrawingAlertDefinition } from "@openchart/server/resources/alert-rule";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const inputs = {
  provider: "binance",
  listing: { symbol: "BTCUSDT", currency: "USDT" },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
};
// A Tea config as stored before the tea-node-config migration, and one in the current shape.
const historicalTea = { parameters: {}, inputs, requests: {} };
const currentTea = { indicatorId: "ind_saved", parameters: {}, requests: {} };
const touching = {
  kind: "drawing",
  drawingId: "drw_saved",
  operator: "touching",
  inputs,
};

test.each(["upgrade", "replay", "fresh"])(
  "%s admits touching and retains exact rule/event/action rows",
  (mode) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        const at = migrations.findIndex(({ id }) =>
          id.endsWith("_drawing-boundary-touching"),
        );
        expect(at).toBeGreaterThan(0);
        expect(migrations[at - 1]!.id).toBe("20260924050749_post-feed");
        if (mode === "fresh") yield* DatabaseMigration.apply(db);
        else
          yield* DatabaseMigration.applyOnly(
            db,
            mode === "upgrade" ? migrations.slice(0, at) : migrations,
          );
        const previous = DrawingAlertDefinition.fields.operator.literals.filter(
          (operator) => operator !== "touching",
        );
        const definitions = [
          JSON.stringify({
            kind: "tea",
            source:
              '// exact text\nalertcondition(close > 1, "Above", "Above")',
            config: mode === "upgrade" ? historicalTea : currentTea,
          }),
          ...previous.map((operator) =>
            JSON.stringify({ ...touching, operator }),
          ),
        ];
        for (const [index, definition] of definitions.entries()) {
          const ruleId = `alr_${index}`;
          yield* db.run(sql`INSERT INTO alert_rule (id, revision, created_at, updated_at, name, enabled, repeat, alertable_json)
        VALUES (${ruleId}, 7, 10, 20, 'Saved rule', 1, 1, ${definition})`);
          yield* db.run(sql`INSERT INTO alert_event (id, revision, created_at, updated_at, rule_id, condition, time, detail_json)
        VALUES (${`ale_${index}`}, 3, 30, 40, ${ruleId}, 'alert', 60000, '{"title":"Saved","message":"Fire","data":{"price":201}}')`);
          yield* db.run(sql`INSERT INTO trigger (id, revision, created_at, updated_at, name, enabled, event_json, target_json)
        VALUES (${`trg_${index}`}, 4, 50, 60, 'Saved action', 1, ${JSON.stringify({ kind: "alert", ruleId })}, '{"kind":"notification","message":"{message}"}')`);
        }
        const before = {
          rules: yield* db.all("SELECT * FROM alert_rule ORDER BY id"),
          events: yield* db.all("SELECT * FROM alert_event ORDER BY id"),
          triggers: yield* db.all("SELECT * FROM trigger ORDER BY id"),
          ledger: yield* db.all(
            "SELECT * FROM app_schema_migrations ORDER BY version",
          ),
        };
        if (mode === "upgrade") {
          const rejected = yield* db
            .run(
              sql`INSERT INTO alert_rule (id, name, alertable_json) VALUES ('alr_touch_before', 'Touch', ${JSON.stringify(touching)})`,
            )
            .pipe(Effect.exit);
          expect(rejected._tag).toBe("Failure");
        }
        // Later migrations convert Tea configs; compare right after this one.
        yield* DatabaseMigration.applyOnly(
          db,
          mode === "upgrade" ? migrations.slice(0, at + 1) : migrations,
        );
        expect(yield* db.all("SELECT * FROM alert_rule ORDER BY id")).toEqual(
          before.rules,
        );
        expect(yield* db.all("SELECT * FROM alert_event ORDER BY id")).toEqual(
          before.events,
        );
        expect(yield* db.all("SELECT * FROM trigger ORDER BY id")).toEqual(
          before.triggers,
        );
        expect(
          (yield* db.all(
            "SELECT * FROM app_schema_migrations ORDER BY version",
          )).slice(0, before.ledger.length),
        ).toEqual(before.ledger);
        expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
        expect(
          Schema.decodeUnknownSync(DrawingAlertDefinition)(touching),
        ).toEqual(touching);
        yield* db.run(
          sql`INSERT INTO alert_rule (id, name, alertable_json) VALUES ('alr_touch', 'Touch', ${JSON.stringify(touching)})`,
        );
        const invalid = { ...touching, operator: "touch" };
        expect(Schema.is(DrawingAlertDefinition)(invalid)).toBe(false);
        expect(
          (yield* db
            .run(
              sql`INSERT INTO alert_rule (id, name, alertable_json) VALUES ('alr_invalid', 'Invalid', ${JSON.stringify(invalid)})`,
            )
            .pipe(Effect.exit))._tag,
        ).toBe("Failure");
        expect(
          yield* db.all(
            "SELECT name FROM sqlite_temp_master WHERE name = 'drawing_boundary_event_backup'",
          ),
        ).toEqual([]);
        yield* db.run("DELETE FROM alert_rule WHERE id = 'alr_0'");
        expect((yield* db.all("SELECT * FROM alert_event")).length).toBe(
          before.events.length - 1,
        );
        expect(yield* db.all("SELECT * FROM trigger ORDER BY id")).toEqual(
          before.triggers,
        );
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
);
