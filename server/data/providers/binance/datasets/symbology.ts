// Purpose: Search active Binance Spot pairs using exchangeInfo source data.

import { Effect } from "effect";
import {
  type SearchQuery,
  type SelectQuery,
} from "@openchart/server/data/dataset";
import type { binanceSymbology } from "@openchart/server/data/providers/binance/datasets/definitions";
import { binanceSymbologyRow } from "@openchart/server/data/providers/binance/datasets/definitions/symbology";
import { Schema } from "effect";

import {
  request,
  type BinanceOptions,
} from "@openchart/server/data/providers/binance/client";
import { binanceError } from "@openchart/server/data/providers/binance/errors";

const ExchangeInfo = Schema.Struct({
  symbols: Schema.Array(
    Schema.Struct({
      ...binanceSymbologyRow.fields,
      ...{ isSpotTradingAllowed: Schema.Boolean },
    }),
  ),
});

/** Search active pairs; source order is normalized by exact/prefix/symbol match.
 * @example const rows = yield* searchSymbols({}, {query: 'BTC', limit: 10});
 */
const readSymbols = Effect.fn("Binance.readSymbols")(function* (
  options: BinanceOptions,
) {
  const body = yield* request(options, "/api/v3/exchangeInfo", {
    permissions: "SPOT",
  });
  const source = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(ExchangeInfo)(body),
    catch: binanceError,
  });
  return source.symbols
    .filter((row) => row.status === "TRADING" && row.isSpotTradingAllowed)
    .map(({ symbol, baseAsset, quoteAsset, status }) => ({
      symbol,
      baseAsset,
      quoteAsset,
      status,
    }));
});

/** Enumerate the complete active Spot scope unless an explicit Dataset count is supplied.
 * @example yield* selectSymbols({}, {quoteAsset: 'USDT'});
 */
export const selectSymbols = Effect.fn("Binance.selectSymbols")(function* (
  options: BinanceOptions,
  query: SelectQuery<typeof binanceSymbology>,
) {
  const rows = yield* readSymbols(options);
  return rows
    .filter(
      (row) =>
        query.quoteAsset === undefined || row.quoteAsset === query.quoteAsset,
    )
    .slice(0, query.count);
});

/** Search the same catalog parser used by complete enumeration. @example yield* searchSymbols({}, {query: 'BTC'}); */
export const searchSymbols = Effect.fn("Binance.searchSymbols")(function* (
  options: BinanceOptions,
  query: SearchQuery,
) {
  const source = yield* readSymbols(options);
  const text = query.query.trim().toUpperCase();
  const rank = (symbol: string) =>
    symbol === text ? 0 : symbol.startsWith(text) ? 1 : 2;
  const rows = source.filter((row) =>
    `${row.symbol} ${row.baseAsset} ${row.quoteAsset}`.includes(text),
  );
  rows.sort(
    (a, b) =>
      rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol),
  );
  return rows
    .slice(0, query.limit)
    .map(({ symbol, baseAsset, quoteAsset, status }) => ({
      symbol,
      baseAsset,
      quoteAsset,
      status,
    }));
});
