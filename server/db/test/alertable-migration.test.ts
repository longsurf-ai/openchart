// Purpose: Preserves populated pre-Alertable rules, history, and prompt semantics through the forward migration.

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { alertRules } from "@openchart/server/resources/alert-rule/schema";
import { AlertEventEntity } from "@openchart/server/resources/alert-event";
import { alertEvents } from "@openchart/server/resources/alert-event/schema";
import { TriggerEntity } from "@openchart/server/resources/trigger";
import { triggers } from "@openchart/server/resources/trigger/schema";
import { HistoricalPromptTarget } from "./historical-prompt-target";
import {
  alertTokens,
  renderPrompt,
  renderTemplate,
} from "@openchart/server/trigger/serialize";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const at = migrations.findIndex((migration) =>
  migration.id.endsWith("_alertable"),
);
const inputs = {
  provider: "yfinance",
  listing: { symbol: "MSFT", currency: "USD" },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
};
const child = { parameters: { window: 10 }, inputs, requests: {} };
const config = {
  parameters: { threshold: 200, symbol: "incorrect parameter" },
  inputs,
  requests: { daily: child },
};
const source =
  '// exact saved source\nalertcondition(close > 200, "Above", "Threshold")';
const detail = {
  inputs,
  parameters: config.parameters,
  alert: { title: "Above", message: "Threshold" },
  values: { close: 201.5 },
};
const oldTemplate = String.raw`{symbol}|{threshold}|{close}|{unknown}|{{symbol}}|\{symbol}|\\|{a-b}|{}`;
const prompt = {
  agent: "analyst",
  workspaceId: "workspace-{symbol}",
  model: { providerID: "codex", modelID: "tier1", selectedVariant: "default" },
  parts: [
    {
      type: "text",
      id: "prt_literal",
      text: String.raw`literal {symbol}, \{threshold}, \\ and {} {{title}}`,
    },
    {
      type: "file",
      mime: "text/plain",
      filename: "{symbol}.txt",
      url: "file:///{symbol}.txt",
    },
  ],
};
const originalAgent = {
  kind: "agent_prompt",
  prompt,
  binding: { key: "binding-{symbol}" },
};

const seed = Effect.fn("test.seedAlertablePredecessor")(function* () {
  expect(at).toBeGreaterThan(0);
  expect(migrations[at - 1]?.id).toBe("20260922024059_alert-trigger");
  const db = yield* makeWithDefaults();
  yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
  yield* db.run(sql`INSERT INTO alert_rule (id,revision,created_at,updated_at,name,enabled,repeat,source,config_json)
    VALUES ('alr_old',7,10,20,'Existing',1,1,${source},${JSON.stringify(config)})`);
  for (const id of ["ale_first", "ale_duplicate"]) {
    yield* db.run(sql`INSERT INTO alert_event (id,revision,created_at,updated_at,rule_id,condition,time,detail_json)
      VALUES (${id},3,30,40,'alr_old','above',60000,${JSON.stringify(detail)})`);
  }
  for (const [id, target] of [
    ["trg_notification", { kind: "notification" }],
    ["trg_agent", originalAgent],
  ] as const) {
    yield* db.run(sql`INSERT INTO trigger (id,revision,created_at,updated_at,name,enabled,event_json,target_json,template)
      VALUES (${id},4,50,60,'Existing action',1,${JSON.stringify({ kind: "alert", ruleId: "alr_old" })},${JSON.stringify(target)},${oldTemplate})`);
  }
  return db;
});

test("upgrades populated predecessor rows, keeps FK/indexes, and preserves old prompt/template meaning", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* seed();
      // Later migrations reshape the config; check this migration's rows alone.
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at + 1));
      const rule = (yield* db.select().from(alertRules))[0]!;
      expect(rule).toEqual({
        id: "alr_old",
        revision: 7,
        createdAt: 10,
        updatedAt: 20,
        name: "Existing",
        enabled: true,
        repeat: true,
        alertable: { kind: "tea", source, config },
      });
      const events = (yield* db.select().from(alertEvents)).map((row) =>
        Schema.decodeUnknownSync(AlertEventEntity)(row),
      );
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        revision: 3,
        createdAt: 30,
        updatedAt: 40,
        ruleId: rule.id,
        condition: "above",
        time: 60_000,
        detail: {
          title: detail.alert.title,
          message: detail.alert.message,
          data: {
            inputs,
            parameters: config.parameters,
            values: detail.values,
            symbol: "MSFT",
            provider: "yfinance",
            resolution: "1m",
          },
        },
      });
      const tokens = alertTokens(events[0]!, rule.name);
      const expectedMessage = oldTemplate.replace(
        /\{(\w+)\}/g,
        (part, key: string) => tokens.get(key) ?? part,
      );
      const historicalAgentTrigger = TriggerEntity.mapFields((fields) => ({
        ...fields,
        target: HistoricalPromptTarget,
      }));
      const targets = (yield* db.select().from(triggers)).map((row) =>
        row.target.kind === "agent_prompt"
          ? Schema.decodeUnknownSync(historicalAgentTrigger)(row)
          : Schema.decodeUnknownSync(TriggerEntity)(row),
      );
      for (const target of targets) {
        expect(target).toMatchObject({
          revision: 4,
          createdAt: 50,
          updatedAt: 60,
          name: "Existing action",
          enabled: true,
        });
        if (target.target.kind === "notification") {
          expect(renderTemplate(target.target.message, tokens)).toBe(
            expectedMessage,
          );
        } else {
          expect(target.target.binding).toEqual(originalAgent.binding);
          expect(renderPrompt(target.target.prompt, tokens)).toEqual({
            ...prompt,
            parts: [...prompt.parts, { type: "text", text: expectedMessage }],
          });
        }
      }
      expect(
        (yield* db.all<{ name: string }>("PRAGMA index_list(alert_event)")).map(
          (row) => row.name,
        ),
      ).toEqual(
        expect.arrayContaining([
          "idx_alert_events_created",
          "idx_alert_events_rule",
        ]),
      );
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      yield* db.run("DELETE FROM alert_rule WHERE id = 'alr_old'");
      expect(yield* db.select().from(alertEvents)).toEqual([]);
      expect(yield* db.select().from(triggers)).toHaveLength(2);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));

test("failed data conversion rolls back table rebuilds, event copies, and ledger together", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* seed();
      yield* db.run(
        `UPDATE trigger SET target_json = '{"kind":"unsupported"}' WHERE id = 'trg_agent'`,
      );
      const before = yield* db.all("SELECT * FROM alert_rule");
      const events = yield* db.all("SELECT * FROM alert_event");
      const result = yield* DatabaseMigration.applyOnly(db, migrations).pipe(
        Effect.exit,
      );
      expect(result._tag).toBe("Failure");
      expect(yield* db.all("SELECT * FROM alert_rule")).toEqual(before);
      expect(yield* db.all("SELECT * FROM alert_event")).toEqual(events);
      expect(
        yield* db.all(
          "SELECT name FROM sqlite_temp_master WHERE name = 'alertable_event_backup'",
        ),
      ).toEqual([]);
      expect(
        yield* db.all(
          sql`SELECT id FROM app_schema_migrations WHERE id = ${migrations[at]!.id}`,
        ),
      ).toEqual([]);
      yield* db.run(
        sql`UPDATE trigger SET target_json = ${JSON.stringify(originalAgent)} WHERE id = 'trg_agent'`,
      );
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.select().from(alertEvents)).toHaveLength(2);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));
