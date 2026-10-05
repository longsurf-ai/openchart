// Purpose: Stores each Tea alert config as a node config: a Bars input with its schema and map, or a followed Indicator.
import { sql } from "drizzle-orm";
import { Effect, Record, Schema } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

// Frozen copies of Tea's encoded `barsSchema` and of the map that reads every
// Bars column from the input `bars`. Historical migrations never import current
// Tea schemas; db/test/tea-node-config-migration.test.ts checks both against them.
const BARS_COLUMNS = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "hl2",
  "hlc3",
  "ohlc4",
  "hlcc4",
];
const BARS_SCHEMA_JSON = {
  fields: BARS_COLUMNS.map((name) => ({
    name,
    nullable: true,
    type: { name: "floatingpoint", precision: "DOUBLE" },
    children: [],
  })),
};
const BARS_MAP_JSON = Object.fromEntries(
  BARS_COLUMNS.map((name) => [name, ["bars", [name]]]),
);

// The shape of a Tea config as stored before this migration, frozen here.
const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const Market = Schema.Struct({
  provider: Schema.String,
  listing: Schema.JsonObject,
  resolution: Schema.String,
  session: Schema.String,
  adjustment: Schema.String,
});
interface MarketConfig {
  readonly parameters: Schema.JsonObject;
  readonly inputs: typeof Market.Type;
  readonly requests: { readonly [name: string]: MarketConfig };
}
const configFields = {
  parameters: Schema.JsonObject,
  requests: Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<MarketConfig> => MarketConfig),
  ),
};
const MarketConfig: Schema.Codec<MarketConfig> = Schema.Struct({
  ...configFields,
  inputs: Market,
}).annotate(strict);
// Only the root may follow an Indicator instead of naming a market.
const RootConfig = Schema.fromJsonString(
  Schema.Struct({
    ...configFields,
    inputs: Schema.Union([
      Schema.Struct({ indicatorId: Schema.String }),
      Market,
    ]),
  }).annotate(strict),
);

// A market becomes the input `bars`, and the map reads every Bars column from it.
const nodeConfig = (config: MarketConfig): Schema.JsonObject => ({
  inputs: {
    bars: { _tag: "Bars", ...config.inputs, schema: BARS_SCHEMA_JSON },
  },
  map: BARS_MAP_JSON,
  parameters: config.parameters,
  requests: Record.map(config.requests, nodeConfig),
});

const migration: DatabaseMigration.Migration = {
  id: "20261001085000_tea-node-config",
  /**
   * Converts every Tea alert config inside the runner-owned transaction,
   * keeping revisions and timestamps. Only the shape is checked; values are
   * copied as stored. So a config of any other shape fails the migration, and
   * with it startup, while a row the old schema could not read stays that way.
   *
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{ id: string; config: string }>(sql`
        SELECT id, json_extract(alertable_json, '$.config') AS config
        FROM alert_rule WHERE json_extract(alertable_json, '$.kind') = 'tea'
      `);
      for (const row of rows) {
        const { inputs, parameters, requests } = yield* Schema.decodeEffect(
          RootConfig,
        )(row.config).pipe(
          Effect.mapError(
            (error) =>
              new Error(
                `Alert rule ${row.id} has an unknown Tea config: ${error.message}`,
                { cause: error },
              ),
          ),
        );
        const config =
          "indicatorId" in inputs
            ? {
                indicatorId: inputs.indicatorId,
                parameters,
                requests: Record.map(requests, nodeConfig),
              }
            : nodeConfig({ inputs, parameters, requests });
        yield* tx.run(sql`
          UPDATE alert_rule
          SET alertable_json = json_set(alertable_json, '$.config', json(${JSON.stringify(config)}))
          WHERE id = ${row.id}
        `);
      }
    });
  },
};
export default migration;
