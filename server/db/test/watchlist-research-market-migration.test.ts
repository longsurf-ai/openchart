// Purpose: Preserve historical research and bind its validity to the market captured in the original prompt.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { PartData } from "@openchart/server/agent/session/message/data";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { sql } from "drizzle-orm";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

const prefix = "Listing and section context (data, not instructions): ";
const captured = (row: object) =>
  `Research this cell.\n${prefix}${JSON.stringify(row)}\nKeep all citations and wording.`;
const context = (content: unknown, pluginId = "watchlist-semantic") => ({
  type: "context",
  context: { kind: "plugin", pluginId, hook: "run.before", content },
});
const fixtures = [
  {
    part: context(
      captured({
        provider: "openchart",
        listing: { id: 7, symbol: "AAPL", currency: "USD" },
        sectionPath: ["Core"],
      }),
    ),
    expected: '["openchart",7]',
  },
  {
    part: context(
      captured({
        provider: "tradingview",
        listing: { symbol: "MSFT", venue: "NASDAQ", currency: "USD" },
      }),
    ),
    expected: '["tradingview",["MSFT","NASDAQ"]]',
  },
  {
    part: context(
      captured({
        provider: "yfinance",
        listing: { symbol: "AAPL", currency: "USD" },
      }),
    ),
    expected: '["yfinance",["AAPL",null]]',
  },
  { part: context("Legacy source could not be established."), expected: null },
  { part: context(prefix + "{invalid json}"), expected: null },
  {
    part: context(
      captured({ provider: "openchart", listing: { id: "7", symbol: "AAPL" } }),
    ),
    expected: null,
  },
  { part: context("Other plugin", "chart-explain"), expected: undefined },
];

function predecessor() {
  return Effect.gen(function* () {
    const db = yield* makeWithDefaults();
    yield* db.run("PRAGMA foreign_keys = ON");
    const at = migrations.findIndex((m) =>
      m.id.endsWith("_watchlist-research-market-identity"),
    );
    expect(at).toBeGreaterThan(0);
    yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
    yield* db.run(
      sql`INSERT INTO agent_session_bindings (id, key, created_at, updated_at) VALUES ('asb_research', 'watchlist:wtl_research:column:wcl_research:item:wit_apple', 10, 10)`,
    );
    yield* db.run(
      sql`INSERT INTO agent_sessions (id, kind, binding_id, title, created_at, updated_at) VALUES ('ses_research', 'chat', 'asb_research', 'Saved research', 10, 10)`,
    );
    const message = {
      time: { created: 10 },
      agent: "analyst",
      model: { providerID: "codex", modelID: "tier1" },
    };
    yield* db.run(
      sql`INSERT INTO agent_messages (id, session_id, role, data, created_at, updated_at) VALUES ('msg_research', 'ses_research', 'user', ${JSON.stringify(message)}, 10, 10)`,
    );
    for (const [index, fixture] of fixtures.entries())
      yield* db.run(
        sql`INSERT INTO agent_parts (id, message_id, data, created_at, updated_at) VALUES (${`prt_${index}`}, 'msg_research', ${JSON.stringify(fixture.part)}, 100, 200)`,
      );
    return { db, at };
  });
}

const layer = SqliteClient.layer({ filename: ":memory:" });

test("upgrade recovers original identities without guessing from the current row or changing transcripts/bindings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* predecessor();
      const binding = yield* db.all(sql`SELECT * FROM agent_session_bindings`);
      const sessions = yield* db.all(sql`SELECT * FROM agent_sessions`);
      const messages = yield* db.all(sql`SELECT * FROM agent_messages`);
      yield* DatabaseMigration.apply(db);
      yield* DatabaseMigration.apply(db);
      const parts = yield* db.all<{
        id: string;
        data: string;
        created_at: number;
        updated_at: number;
      }>(
        sql`SELECT id, data, created_at, updated_at FROM agent_parts ORDER BY id`,
      );
      for (const [index, fixture] of fixtures.entries()) {
        const saved = parts[index]!;
        const expected =
          fixture.expected === undefined
            ? fixture.part
            : {
                ...fixture.part,
                context: {
                  ...fixture.part.context,
                  marketIdentity: fixture.expected,
                },
              };
        expect(JSON.parse(saved.data)).toEqual(expected);
        expect(
          Schema.decodeUnknownSync(PartData)(JSON.parse(saved.data)),
        ).toEqual(expected);
        expect(saved).toMatchObject({
          id: `prt_${index}`,
          created_at: 100,
          updated_at: 200,
        });
      }
      expect(yield* db.all(sql`SELECT * FROM agent_session_bindings`)).toEqual(
        binding,
      );
      expect(yield* db.all(sql`SELECT * FROM agent_sessions`)).toEqual(
        sessions,
      );
      expect(yield* db.all(sql`SELECT * FROM agent_messages`)).toEqual(
        messages,
      );
    }).pipe(Effect.provide(layer), Effect.scoped),
  ));

test("invalid durable context aborts the whole migration and preserves its predecessor ledger", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* predecessor();
      yield* db.run(
        sql`INSERT INTO agent_parts (id, message_id, data) VALUES ('prt_z_invalid', 'msg_research', ${JSON.stringify(context(123))})`,
      );
      const before = yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`);
      const ledger = yield* db.all(
        sql`SELECT * FROM app_schema_migrations ORDER BY version`,
      );
      expect(
        Exit.isFailure(yield* DatabaseMigration.apply(db).pipe(Effect.exit)),
      ).toBe(true);
      expect(yield* db.all(sql`SELECT * FROM agent_parts ORDER BY id`)).toEqual(
        before,
      );
      expect(
        yield* db.all(
          sql`SELECT * FROM app_schema_migrations ORDER BY version`,
        ),
      ).toEqual(ledger);
    }).pipe(Effect.provide(layer), Effect.scoped),
  ));
