// Purpose: Own the symbology Feed service contract.
import type { Effect } from "effect";
import type {
  SymbolSearchRequest,
  SymbolSearchResult,
  FeedError,
  SymbolIndexRequest,
  SymbolIndexStatus,
} from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import type { SymbolIndexUnavailable } from "./errors";

/** Merged searches retain provider identity and apply a global result limit. */
export interface ISymbologyFeedService {
  /** Accept one backend-owned job; disconnect does not stop accepted work. @example yield* symbols.index({providerId: 'binance', filter: {}}); */
  index(
    request: SymbolIndexRequest,
  ): Effect.Effect<{ runId: string }, FeedError>;
  /** Read capability, availability and latest runtime status. @example yield* symbols.indexStatus(); */
  indexStatus(): Effect.Effect<SymbolIndexStatus>;
  /** Indexed hits return locally; a miss or live request queries all sources and requires success.
   * SymbolIndexUnavailable is a local storage failure without a public reason.
   * @example yield* symbols.search({query: 'Apple', limit: 20, indexed: true});
   */
  search(
    request: SymbolSearchRequest,
  ): Effect.Effect<SymbolSearchResult, FeedError | SymbolIndexUnavailable>;
}

/** Exact Dataset adaptation, without persistence or job ownership. */
export interface SymbologySource {
  readonly providerId: ProviderId;
  readonly search: (
    request: SymbolSearchRequest,
  ) => Effect.Effect<SymbolSearchResult, FeedError>;
  readonly select?: (
    filter: SymbolIndexRequest["filter"],
  ) => Effect.Effect<SymbolSearchResult, FeedError>;
}
