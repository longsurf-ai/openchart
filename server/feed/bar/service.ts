// Purpose: Own the bar Feed service contract.
import type { Effect, Scope, Stream } from "effect";
import type {
  BarsRequest,
  BarsSnapshot,
  BarsCapabilities,
  FeedError,
} from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";

/** Snapshot and optional updates share the caller's open session scope. */
export interface IBarsFeedService {
  /** Observe a snapshot and, for to: 'now', its updates in the caller's Scope.
   * Keep that Scope open until consumption ends; closing it stops the source.
   * @example const session = yield* bars.observe(request);
   */
  observe(request: BarsRequest): Effect.Effect<
    {
      readonly snapshot: BarsSnapshot;
      readonly updates?: Stream.Stream<BarsSnapshot["data"], FeedError>;
    },
    FeedError,
    Scope.Scope
  >;
  /** Report only combinations available for this source and listing.
   * @example yield* bars.getCapabilities({provider, listing});
   */
  getCapabilities(
    request: ProviderListing,
  ): Effect.Effect<BarsCapabilities, FeedError>;
}
