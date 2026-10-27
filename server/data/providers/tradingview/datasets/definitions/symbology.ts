// Purpose: Describe searchable TradingView instruments without provider I/O.

import { Schema } from "effect";
import { defineDataset, Layout } from "@openchart/server/data/dataset";

/** Provider-native search observation; `exchange` is TradingView's exchange code. */
export const tradingviewSymbologyRow = Schema.Struct({
  symbol: Schema.String.check(Schema.isMinLength(1)),
  exchange: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1)),
  type: Schema.String.check(Schema.isMinLength(1)),
  /** Empty when the source has no quote currency, including yield series. */
  currency: Schema.String,
  primary: Schema.optionalKey(Schema.Boolean),
  typespecs: Schema.optionalKey(Schema.Array(Schema.String)),
});

/**
 * Results retain TradingView symbols, exchange codes and instrument types.
 * @example const query = {query: 'AAPL', limit: 10};
 */
export const tradingviewSymbology = defineDataset({
  name: "tradingview.symbology",
  keys: Schema.Struct({}),
  schema: tradingviewSymbologyRow,
  layout: Layout.Row,
  access: { search: true },
});
