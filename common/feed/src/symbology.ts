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
 * Reads a query's search conveniences without rewriting any listing identity.
 * `VENUE:SYMBOL` names an uppercase venue, ignoring spaces around the colon. An
 * unnumbered continuous future such as `NQ!` also names `NQ1!`; numbered
 * contracts, repeated `!` and other text stay literal. Sources and ranking
 * share this one grammar.
 * @example parseSymbolQuery("cme_mini : nq!"); // {venue: "CME_MINI", symbol: "nq!", continuous: "nq1!"}
 */
export function parseSymbolQuery(query: string): {
  readonly venue?: string;
  readonly symbol: string;
  readonly continuous?: string;
} {
  const text = query.trim();
  const qualified = /^([^:\s]+)\s*:\s*([^:\s]+)$/.exec(text);
  const symbol = qualified?.[2] ?? text;
  const root = /^([^\s:!]*[^\d\s:!])!$/.exec(symbol)?.[1];
  return {
    ...(qualified ? { venue: qualified[1]!.toUpperCase() } : {}),
    symbol,
    ...(root === undefined ? {} : { continuous: `${root}1!` }),
  };
}

/**
 * Stable search order shared by saved and live results: the exact symbol, then
 * symbols and then names starting with the query, then other matches. Within a
 * rank, a source's primary listing comes first, then symbols sort by symbol,
 * provider, venue and name. Ranks come from the query alone; source scores are
 * never compared. A {@link parseSymbolQuery} venue also ranks the symbol at
 * that venue, and a continuous alias also matches its first contract. Literal
 * matches remain eligible and listing identities are never rewritten.
 * @example hits.sort(compareSymbolListings(request.query));
 */
export function compareSymbolListings(query: string) {
  const text = query.trim().toUpperCase();
  const { venue, symbol: symbolText, continuous } = parseSymbolQuery(text);
  const rank = ({ listing }: ProviderListing) => {
    const symbol = listing.symbol.toUpperCase();
    const name = listing.name?.toUpperCase();
    const match = (value: string) => {
      if (symbol === value) return 0;
      if (symbol.startsWith(value)) return 1;
      if (name?.startsWith(value)) return 2;
      return 3;
    };
    const literal = match(text);
    if (venue && listing.venue?.toUpperCase() !== venue) return literal;
    return Math.min(
      literal,
      match(symbolText),
      continuous ? match(continuous) : 3,
    );
  };
  const key = ({ provider, listing }: ProviderListing) =>
    `${listing.symbol.toUpperCase()}\0${provider}\0${listing.primary === true ? "0" : "1"}\0${listing.venue}\0${listing.name}`;
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
