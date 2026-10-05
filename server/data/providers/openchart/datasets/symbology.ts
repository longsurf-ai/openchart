// Purpose: Search native OpenChart listings through the authenticated Provider client.
import { Effect } from "effect";
import type { SearchQuery } from "@openchart/server/data/dataset";
import type { Client } from "@openchart/server/data/providers/openchart/contract";
import { openchartError } from "@openchart/server/data/providers/openchart/errors";

/** Search at most 200 native listings; transport and decoding failures remain Dataset failures.
 * @example const listings = yield* searchSymbols(client, {query: "AAPL"});
 */
export const searchSymbols = Effect.fn("OpenChart.search")(function* (
  client: Client,
  query: SearchQuery,
) {
  return yield* client
    .searchListings(query)
    .pipe(Effect.mapError(openchartError));
});
