// Purpose: Shared consumer symbology request and result contracts.

import { Schema, SchemaGetter } from "effect";
import { AssetClass, ProviderListing } from "@openchart/market";
import { FeedReason } from "./errors";

/** Finite merged search; limit applies after global ordering. */
export const SymbolSearchRequest = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1)),
  indexed: Schema.Boolean,
  assetClass: Schema.optionalKey(AssetClass),
  limit: Schema.Int.check(Schema.isGreaterThan(0)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type SymbolSearchRequest = typeof SymbolSearchRequest.Type;
/** Each hit retains its source; identical symbols from different providers remain distinct. */
export const SymbolSearchResult = Schema.Array(ProviderListing);
export type SymbolSearchResult = typeof SymbolSearchResult.Type;

/**
 * Stable search order shared by saved and live results: the exact symbol, then
 * symbols and then names starting with the query, then other matches; ties sort
 * by symbol. Ranks come from the query alone; source scores are never compared.
 * @example hits.sort(compareSymbolListings(request.query));
 */
export function compareSymbolListings(query: string) {
  const text = query.trim().toUpperCase();
  const rank = ({ listing }: ProviderListing) => {
    const symbol = listing.symbol.toUpperCase();
    if (symbol === text) return 0;
    if (symbol.startsWith(text)) return 1;
    if (listing.name?.toUpperCase().startsWith(text)) return 2;
    return 3;
  };
  const key = ({ provider, listing }: ProviderListing) =>
    `${listing.symbol.toUpperCase()}\0${provider}\0${listing.venue}\0${listing.name}`;
  return (a: ProviderListing, b: ProviderListing): number => {
    const left = key(a);
    const right = key(b);
    return rank(a) - rank(b) || (left < right ? -1 : left > right ? 1 : 0);
  };
}

/** Complete active Spot scope; omission of quoteAsset selects all quote assets. */
export const SymbolIndexFilter = Schema.Struct({
  quoteAsset: Schema.optionalKey(
    Schema.String.pipe(
      Schema.decodeTo(
        Schema.NonEmptyString.check(Schema.isTrimmed(), Schema.isUppercased()),
        {
          decode: SchemaGetter.transform((value) => value.trim().toUpperCase()),
          encode: SchemaGetter.transform((value) => value),
        },
      ),
    ),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
/** Indexable providers own their filter shapes; search-only providers cannot start a run. */
export const SymbolIndexRequest = Schema.Struct({
  providerId: Schema.Literal("binance"),
  filter: SymbolIndexFilter,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type SymbolIndexRequest = typeof SymbolIndexRequest.Type;
/** Acceptance does not imply completion; jobs belong to the backend lifetime. */
export const SymbolIndexAccepted = Schema.Struct({
  runId: Schema.NonEmptyString,
});
/** Latest runtime run only; durable listings survive restart, job history does not. */
export const SymbolIndexState = Schema.Union([
  Schema.Struct({ state: Schema.Literal("idle") }),
  Schema.Struct({
    state: Schema.Literal("running"),
    runId: Schema.NonEmptyString,
    filter: SymbolIndexFilter,
    phase: Schema.Literals(["fetching", "saving"]),
  }),
  Schema.Struct({
    state: Schema.Literal("succeeded"),
    runId: Schema.NonEmptyString,
    filter: SymbolIndexFilter,
    listingCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    state: Schema.Literal("failed"),
    runId: Schema.NonEmptyString,
    filter: SymbolIndexFilter,
    /** The public reason; absent when the failure has none, such as local index storage. */
    reason: Schema.optionalKey(FeedReason),
  }),
]);
export type SymbolIndexState = typeof SymbolIndexState.Type;
/** Capabilities stay visible for disabled providers. */
export const SymbolIndexStatus = Schema.Array(
  Schema.Struct({
    providerId: Schema.NonEmptyString,
    indexable: Schema.Boolean,
    available: Schema.Boolean,
    job: SymbolIndexState,
  }),
);
export type SymbolIndexStatus = typeof SymbolIndexStatus.Type;
