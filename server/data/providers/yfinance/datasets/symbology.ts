// Purpose: Search Yahoo symbols and obtain missing currency from the same source.

import { Effect } from "effect";
import { type SearchQuery } from "@openchart/server/data/dataset";
import { Schema } from "effect";

import {
  request,
  type YFinanceOptions,
} from "@openchart/server/data/providers/yfinance/client";
import { readChart } from "./bars";
import { invalidResult } from "@openchart/server/data/providers/yfinance/errors";

const YahooQuote = Schema.Struct({
  isYahooFinance: Schema.Literal(true),
  symbol: Schema.String.check(Schema.isMinLength(1)),
  shortname: Schema.optionalKey(Schema.String),
  longname: Schema.optionalKey(Schema.String),
  exchange: Schema.String.check(Schema.isMinLength(1)),
  quoteType: Schema.String.check(Schema.isMinLength(1)),
});
const Search = Schema.Struct({
  quotes: Schema.Array(
    Schema.Union([
      YahooQuote,
      Schema.Struct({ isYahooFinance: Schema.Literal(false) }),
    ]),
  ),
});

/** Search and enrich requested results without inventing currency from symbol suffixes.
 * A quote whose chart has no currency is left out, since a listing needs one.
 * @example const results = yield* searchSymbols({}, {query: 'Tencent', limit: 10});
 */
export const searchSymbols = Effect.fn("YFinance.searchSymbols")(function* (
  options: YFinanceOptions,
  query: SearchQuery,
) {
  const body = yield* request(options, "/v1/finance/search", {
    q: query.query,
    quotesCount: String(query.limit ?? 10),
    newsCount: "0",
    enableFuzzyQuery: "false",
  });
  const parsed = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Search)(body),
    catch: invalidResult,
  });
  const quotes = parsed.quotes
    .filter((quote): quote is typeof YahooQuote.Type => quote.isYahooFinance)
    .slice(0, query.limit);
  const enriched = yield* Effect.forEach(
    quotes,
    Effect.fn("YFinance.enrichSymbol")(function* (quote) {
      const { currency } = (yield* readChart(options, quote.symbol, {
        interval: "1d",
        range: "1d",
      })).meta;
      return currency === null
        ? []
        : [
            {
              symbol: quote.symbol,
              shortname: quote.shortname ?? quote.longname ?? quote.symbol,
              ...(quote.longname === undefined
                ? {}
                : { longname: quote.longname }),
              exchange: quote.exchange,
              quoteType: quote.quoteType,
              currency,
            },
          ];
    }),
    { concurrency: 4 },
  );
  return enriched.flat();
});
