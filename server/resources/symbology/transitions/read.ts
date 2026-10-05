// Purpose: Expose finite saved-listing search and counts without provider I/O.
import { SymbolSearchRequest, compareSymbolListings } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { Transition } from "@openchart/server/lib/resource";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import { Effect, Schema } from "effect";
import { SymbologyEntity } from "@openchart/server/resources/symbology/entity";
import {
  searchListings,
  countListings,
} from "@openchart/server/resources/symbology/store";

/** Local-only search; Feed chooses fallback policy. */
export const search = Transition.make({
  kind: "query",
  input: Schema.Struct({
    request: SymbolSearchRequest,
    providers: Schema.Array(ProviderId),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    searchListings(tx, input.request, input.providers).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          toEntity("symbology", SymbologyEntity, row),
        ),
      ),
      Effect.map((rows) =>
        rows
          .sort(compareSymbolListings(input.request.query))
          .slice(0, input.request.limit),
      ),
    ),
});
/** Counts are derived from saved rows, never a second persisted counter. */
export const counts = Transition.make({
  kind: "query",
  input: Schema.Void,
  resolve: () => Effect.void,
  apply: (tx) => countListings(tx),
});
