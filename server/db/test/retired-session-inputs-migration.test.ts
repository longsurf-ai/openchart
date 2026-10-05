// Purpose: Retired sessions in Tea alert configs and Chart Explain inputs become current ones, and changed alerts wait for review.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { ChartExplainPluginInputSchema } from "@openchart/server/agent/contracts/part";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import * as Tea from "@openchart/tea";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

const stock = { id: 42, symbol: "AAPL", currency: "USD", class: "stock" };
const crypto = { id: 7, symbol: "BTCUSD", currency: "USD", class: "crypto" };
const unclassed = { id: 9, symbol: "SPY", currency: "USD" };
// A complete Bars schema as Tea stores it; literal so the test never decodes rows with current schemas.
const barsSchema = {
  fields: ["open", "high", "low", "close", "volume"].map((name) => ({
    name,
    nullable: true,
    type: { name: "floatingpoint", precision: "DOUBLE" },
    children: [],
  })),
};
const bars = (session: string, listing: object = stock) => ({
  _tag: "Bars",
  provider: "openchart",
  listing,
  resolution: "1m",
  session,
  adjustment: "raw",
  schema: barsSchema,
});
const node = (inputs: object, requests: object = {}) => ({
  inputs,
  map: { close: ["bars", ["close"]] },
  parameters: {},
  requests,
});
const tea = (config: object) => ({
  kind: "tea",
  source: "plot(close)",
  config,
});
const chartExplain = (drawingId: string, session: string) => ({
  type: "chart_explain",
  drawingId,
  resolution: "1m",
  session,
  adjustment: "raw",
});
const prompt = (parts: object[]) => ({
  agent: "analyst",
  model: { providerID: "codex", modelID: "tier1" },
  parts: [{ type: "text", text: "Explain the selection" }, ...parts],
});
const json = (value: unknown) => JSON.stringify(value);

test("predecessor upgrade maps retired sessions, keeps current ones, and disables changed Tea alerts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      yield* db.run("PRAGMA foreign_keys=ON");
      const at = migrations.findIndex((m) =>
        m.id.endsWith("_retired-session-inputs"),
      );
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));

      // Tea configs: nested requests, a followed Indicator, and per-input listing classes.
      const nested = node(
        { bars: bars("provider", crypto), other: bars("provider", unclassed) },
        {
          higher: node(
            { bars: bars("pre") },
            { deeper: node({ bars: bars("overnight") }) },
          ),
        },
      );
      const follow = {
        indicatorId: "ind_followed",
        parameters: {},
        requests: { daily: node({ bars: bars("post") }) },
      };
      const current = node({ bars: bars("extended") });
      yield* db.run(sql`INSERT INTO alert_rule(id,revision,enabled,name,alertable_json) VALUES
        ('alr_nested',4,1,'Nested',${json(tea(nested))}),
        ('alr_follow',2,1,'Follow',${json(tea(follow))}),
        ('alr_current',1,1,'Current',${json(tea(current))})`);

      // Chart Explain inputs: the crypto rule reads the explained drawing's listing.
      yield* db.run("INSERT INTO dashboard(id,name) VALUES('dsh_a','Charts')");
      yield* db.run(sql`INSERT INTO drawing(id,dashboard_id,provider,listing,data) VALUES
        ('drw_crypto','dsh_a','openchart',${json(crypto)},'{}'),
        ('drw_stock','dsh_a','openchart',${json(stock)},'{}')`);
      yield* db.run(sql`INSERT INTO agent_sessions (id, title, kind, created_at, updated_at)
        VALUES ('ses_explain', 'Explain', 'chart_explain', 10, 20)`);
      yield* db.run(sql`INSERT INTO agent_messages (id, session_id, role, data)
        VALUES ('msg_user', 'ses_explain', 'user', '{"time":{"created":10}}')`);
      yield* db.run(sql`INSERT INTO agent_parts (id, message_id, data) VALUES
        ('prt_crypto', 'msg_user', ${json({ type: "plugin_input", input: chartExplain("drw_crypto", "provider") })}),
        ('prt_stock', 'msg_user', ${json({ type: "plugin_input", input: chartExplain("drw_stock", "provider") })}),
        ('prt_deleted', 'msg_user', ${json({ type: "plugin_input", input: chartExplain("drw_gone", "provider") })}),
        ('prt_post', 'msg_user', ${json({ type: "plugin_input", input: chartExplain("drw_crypto", "post") })}),
        ('prt_current', 'msg_user', ${json({ type: "plugin_input", input: chartExplain("drw_stock", "24h") })}),
        ('prt_text', 'msg_user', '{"type":"text","text":"session provider"}')`);
      const run = prompt([
        { type: "plugin_input", input: chartExplain("drw_crypto", "provider") },
        { type: "plugin_input", input: chartExplain("drw_stock", "overnight") },
      ]);
      yield* db.run(sql`INSERT INTO agent_run
        (id, session_id, session_intent_id, input, status, queue_position, created_at)
        VALUES ('run_explain', 'ses_explain', 'intent', ${json(run)}, 'queued', 0, 10)`);

      yield* DatabaseMigration.applyOnly(db, migrations);
      // A second run finds nothing left to change.
      yield* DatabaseMigration.applyOnly(db, migrations);

      const rules = new Map(
        (yield* db.all<{
          id: string;
          revision: number;
          enabled: number;
          alertable_json: string;
        }>(
          sql`SELECT id, revision, enabled, alertable_json FROM alert_rule`,
        )).map((row) => [row.id, row]),
      );
      const rule = (id: string) => {
        const row = rules.get(id)!;
        return {
          revision: row.revision,
          enabled: row.enabled,
          alertable: JSON.parse(row.alertable_json) as unknown,
        };
      };
      expect(rule("alr_nested")).toEqual({
        revision: 5,
        enabled: 0,
        alertable: tea(
          node(
            { bars: bars("24h", crypto), other: bars("regular", unclassed) },
            {
              higher: node(
                { bars: bars("extended") },
                { deeper: node({ bars: bars("24h") }) },
              ),
            },
          ),
        ),
      });
      expect(rule("alr_follow")).toEqual({
        revision: 3,
        enabled: 0,
        alertable: tea({
          ...follow,
          requests: { daily: node({ bars: bars("extended") }) },
        }),
      });
      expect(rule("alr_current")).toEqual({
        revision: 1,
        enabled: 1,
        alertable: tea(current),
      });
      // Current schemas accept every migrated copy.
      Schema.decodeUnknownSync(Schema.toEncoded(Tea.Bars))(bars("24h", crypto));

      const parts = yield* db.all<{ id: string; data: string }>(
        sql`SELECT id, data FROM agent_parts ORDER BY id`,
      );
      expect(parts.map((part) => [part.id, JSON.parse(part.data)])).toEqual([
        [
          "prt_crypto",
          { type: "plugin_input", input: chartExplain("drw_crypto", "24h") },
        ],
        [
          "prt_current",
          { type: "plugin_input", input: chartExplain("drw_stock", "24h") },
        ],
        [
          "prt_deleted",
          { type: "plugin_input", input: chartExplain("drw_gone", "regular") },
        ],
        [
          "prt_post",
          {
            type: "plugin_input",
            input: chartExplain("drw_crypto", "extended"),
          },
        ],
        [
          "prt_stock",
          { type: "plugin_input", input: chartExplain("drw_stock", "regular") },
        ],
        ["prt_text", { type: "text", text: "session provider" }],
      ]);
      Schema.decodeUnknownSync(ChartExplainPluginInputSchema)(
        chartExplain("drw_stock", "regular"),
      );

      const [stored] = yield* db.all<{ input: string }>(
        sql`SELECT input FROM agent_run`,
      );
      expect(JSON.parse(stored!.input)).toEqual(
        prompt([
          { type: "plugin_input", input: chartExplain("drw_crypto", "24h") },
          { type: "plugin_input", input: chartExplain("drw_stock", "24h") },
        ]),
      );
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
      Effect.scoped,
    ),
  ));
