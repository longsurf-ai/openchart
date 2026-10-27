// Purpose: Search TradingView instruments and retain their native identities.

import { Effect } from "effect";
import type { SearchQuery } from "@openchart/server/data/dataset";
import type { Client } from "@openchart/server/data/providers/tradingview/client";

/** Search without indexing; TradingView answers with its own symbol vocabulary.
 * @example const rows = yield* searchSymbols(client, {query: 'AAPL', limit: 10});
 */
export const searchSymbols = Effect.fn("TradingView.searchSymbols")(function* (
  client: Client,
  query: SearchQuery,
) {
  const rows = yield* client.search(query.query);
  return query.limit === undefined ? rows : rows.slice(0, query.limit);
});
