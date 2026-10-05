// Purpose: Search Yahoo symbols and obtain missing currency from the same source.

import { Cache, Effect, Exit } from "effect";
import {
  type DatasetFailure,
  type SearchQuery,
} from "@openchart/server/data/dataset";
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

type ChartMeta = Effect.Success<ReturnType<typeof readChart>>["meta"];

const chartMeta = (options: YFinanceOptions) => (symbol: string) =>
  readChart(options, symbol, { interval: "1d", range: "1d" }).pipe(
    Effect.map(({ meta }) => meta),
  );

/** Reasons a chart read gives for a query that names no Yahoo symbol. */
const notASymbol = new Set([
  "Dataset.NotFound",
  "Dataset.InvalidQuery",
  "Dataset.InvalidResult",
]);

/** Search and enrich requested results without inventing currency from symbol suffixes.
 * A quote whose chart has no currency is left out, since a listing needs one.
 * Yahoo's search sometimes answers a valid ticker with no quotes at all; the
 * query is then read as a symbol from its own chart, so an exact ticker still
 * resolves, and a query that names no symbol finds nothing. `meta` reads a
 * symbol's chart metadata; the Provider passes a cached reader.
 * @example const results = yield* searchSymbols({}, {query: 'Tencent', limit: 10});
 */
export const searchSymbols = Effect.fn("YFinance.searchSymbols")(function* (
  options: YFinanceOptions,
  query: SearchQuery,
  meta: (
    symbol: string,
  ) => Effect.Effect<ChartMeta, DatasetFailure> = chartMeta(options),
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
  if (quotes.length === 0)
    return yield* meta(query.query.trim().toUpperCase()).pipe(
      Effect.map((chart) =>
        chart.currency === null
          ? []
          : [
              {
                symbol: chart.symbol,
                shortname: chart.shortName ?? chart.longName ?? chart.symbol,
                ...(chart.longName === undefined
                  ? {}
                  : { longname: chart.longName }),
                exchange: chart.exchangeName,
                quoteType: chart.instrumentType,
                currency: chart.currency,
              },
            ],
      ),
      Effect.catchIf(
        (failure) => notASymbol.has(failure.reason._tag),
        () => Effect.succeed([]),
      ),
    );
  const enriched = yield* Effect.forEach(
    quotes,
    Effect.fn("YFinance.enrichSymbol")(function* (quote) {
      const { currency } = yield* meta(quote.symbol);
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

/** Searches that read each symbol's chart once per Provider activation, so
 * a repeated search, including every `request.security` lookup, costs one Yahoo
 * call rather than a search plus a chart read per quote. A failed read is not
 * kept. Create inside the Provider activation.
 * @example const { search } = yield* cachedSearchSymbols(options);
 */
export const cachedSearchSymbols = Effect.fn("YFinance.cachedSearchSymbols")(
  function* (options: YFinanceOptions) {
    const charts = yield* Cache.makeWith(chartMeta(options), {
      capacity: 4096,
      // A listing's currency and names rarely change within a day.
      timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 day" : 0),
    });
    return {
      search: (query: SearchQuery) =>
        searchSymbols(options, query, (symbol) => Cache.get(charts, symbol)),
    };
  },
);
