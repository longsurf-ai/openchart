// Purpose: Describe searchable native Binance Spot exchange symbols.

import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

/** Provider-native observation schema. */
export const binanceSymbologyRow = Schema.Struct({
  symbol: Schema.String.check(Schema.isMinLength(1)),
  baseAsset: Schema.String.check(Schema.isMinLength(1)),
  quoteAsset: Schema.String.check(Schema.isMinLength(1)),
  status: Schema.String.check(Schema.isMinLength(1)),
});

/**
 * Binance trading pairs retain their native symbol and asset codes.
 * @example const query = {query: 'BTC', limit: 10};
 */
export const binanceSymbology = defineDataset({
  name: "binance.symbology",
  keys: Schema.Struct({
    quoteAsset: k.eq(Schema.optionalKey(Schema.NonEmptyString)),
  }),
  schema: binanceSymbologyRow,
  layout: Layout.Row,
  access: { search: true, select: true },
});
