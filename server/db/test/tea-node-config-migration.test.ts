// Purpose: Converts stored Tea alert configs to node configs once, keeping revisions and drawing rules.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Cause, Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";
import { BarsSeries } from "@openchart/feed";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { AlertRuleEntity } from "@openchart/server/resources/alert-rule/entity";
import { alertRules } from "@openchart/server/resources/alert-rule/schema";
import * as Tea from "@openchart/tea";

const at = migrations.findIndex(({ id }) => id.endsWith("_tea-node-config"));
const market = {
  provider: "yfinance",
  listing: { symbol: "MSFT", name: "Microsoft", currency: "USD" },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
};
const daily = { ...market, resolution: "1d" };
const weekly = { ...market, resolution: "1W" };

// A market config as stored before the migration, and the node config that
// current code writes for the same market. Only the expected node config uses
// current Tea; its map is the same for every series.
const { map } = Tea.barsInputs(Schema.decodeUnknownSync(BarsSeries)(market));
const marketConfig = (
  series: object,
  parameters: object,
  requests: object = {},
) => ({ parameters, inputs: series, requests });
const nodeConfig = (
  series: object,
  parameters: object,
  requests: object = {},
) => ({
  inputs: {
    bars: {
      _tag: "Bars",
      ...series,
      schema: Schema.encodeSync(Tea.ArrowSchemaJson)(Tea.barsSchema),
    },
  },
  map,
  parameters,
  requests,
});
const tea = (config: object) => ({
  kind: "tea",
  source:
    '// exact saved source\nalertcondition(close > 200, "Above", "Above")',
  config,
});
const drawing = {
  kind: "drawing",
  drawingId: "drw_saved",
  operator: "crossing_up",
  inputs: market,
};
const migratedMarket = nodeConfig(
  market,
  { threshold: 200, src: "close" },
  {
    daily: nodeConfig(
      daily,
      { length: 10 },
      { weekly: nodeConfig(weekly, {}) },
    ),
  },
);
// Ordered by id, like the rows read back.
const rules = [
  { id: "alr_drawing", before: drawing, after: drawing },
  {
    id: "alr_follow",
    before: tea({
      parameters: { level: 70 },
      inputs: { indicatorId: "ind_followed" },
      requests: { daily: marketConfig(daily, {}) },
    }),
    after: tea({
      indicatorId: "ind_followed",
      parameters: { level: 70 },
      requests: { daily: nodeConfig(daily, {}) },
    }),
  },
  {
    id: "alr_market",
    before: tea(
      marketConfig(
        market,
        { threshold: 200, src: "close" },
        {
          daily: marketConfig(
            daily,
            { length: 10 },
            { weekly: marketConfig(weekly, {}) },
          ),
        },
      ),
    ),
    after: tea(migratedMarket),
  },
];

const seed = Effect.fn("test.seedTeaNodeConfigPredecessor")(function* (
  alertables: readonly { id: string; before: object }[],
) {
  expect(at).toBeGreaterThan(0);
  const db = yield* makeWithDefaults();
  yield* db.run("PRAGMA foreign_keys = ON");
  yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
  for (const { id, before } of alertables) {
    yield* db.run(sql`
      INSERT INTO alert_rule (id, revision, created_at, updated_at, name, enabled, repeat, alertable_json)
      VALUES (${id}, 7, 10, 20, 'Saved rule', 1, 0, ${JSON.stringify(before)})
    `);
  }
  return db;
});

test("converts every Tea config once, keeping revisions and drawing rules", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* seed(rules);
      const saved = yield* db.select().from(alertRules).orderBy(alertRules.id);

      yield* DatabaseMigration.apply(db);
      const migrated = yield* db
        .select()
        .from(alertRules)
        .orderBy(alertRules.id);
      expect(migrated).toEqual(
        saved.map((rule, index) => ({
          ...rule,
          alertable: rules[index]!.after,
        })),
      );
      for (const rule of migrated) {
        expect(Schema.decodeUnknownSync(AlertRuleEntity)(rule)).toEqual(rule);
      }
      // The stored config is the canonical JSON of a node config that runs.
      expect(
        Schema.encodeSync(Tea.NodeConfig)(
          Schema.decodeUnknownSync(Tea.NodeConfig)(migratedMarket),
        ),
      ).toEqual(migratedMarket);

      // A complete ledger runs nothing again.
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(ledger).toHaveLength(migrations.length);
      yield* DatabaseMigration.apply(db);
      expect(
        yield* db.select().from(alertRules).orderBy(alertRules.id),
      ).toEqual(migrated);
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));

test("fails on a Tea config of any other shape and changes nothing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* seed([
        ...rules,
        { id: "alr_unknown", before: tea({ parameters: {}, requests: {} }) },
      ]);
      const saved = yield* db.all("SELECT * FROM alert_rule ORDER BY id");

      const result = yield* DatabaseMigration.apply(db).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        // An Error, so the startup defect keeps a stack and the decode issue.
        expect(Cause.squash(result.cause)).toBeInstanceOf(Error);
        expect(Cause.pretty(result.cause)).toContain("Alert rule alr_unknown");
      }
      expect(yield* db.all("SELECT * FROM alert_rule ORDER BY id")).toEqual(
        saved,
      );
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations WHERE id = ${migrations[at]!.id}`,
        ),
      ).toEqual([]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));
