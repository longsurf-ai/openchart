// Purpose: Describe Yahoo search results enriched with source-provided currency.

import { Schema } from "effect";
import { defineDataset, Layout } from "@openchart/server/data/dataset";

/** Provider-native observation schema. */
export const yfinanceSymbologyRow = Schema.Struct({
  symbol: Schema.String.check(Schema.isMinLength(1)),
  shortname: Schema.String.check(Schema.isMinLength(1)),
  longname: Schema.optionalKey(Schema.String),
  exchange: Schema.String.check(Schema.isMinLength(1)),
  quoteType: Schema.String.check(Schema.isMinLength(1)),
  currency: Schema.String.check(Schema.isMinLength(1)),
});

/**
 * Search identity stays in Yahoo's symbol/exchange namespace. Currency comes
 * from chart metadata, because Yahoo's search response does not include it.
 * @example const query = {query: 'Tencent', limit: 10};
 */
export const yfinanceSymbology = defineDataset({
  name: "yfinance.symbology",
  keys: Schema.Struct({}),
  schema: yfinanceSymbologyRow,
  layout: Layout.Row,
  access: { search: true },
});
