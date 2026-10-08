// Purpose: Define the OpenChart client's typed API independently of transport and Datasets.
import {
  Schema,
  type Deferred,
  type Effect,
  type Scope,
  type Stream,
} from "effect";
import { SessionType, type Listing } from "@openchart/market";
import type { OpenChartError } from "./errors";
import type { CalendarData } from "@openchart/server/data/providers/local/market/calendar/data";

/** OpenChart's supported time buckets, including calendar weeks and months. */
export const OpenChartResolution = Schema.Literals([
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1W",
  "1M",
]);
/** Price basis shared by historical pages and live subscriptions. */
export const OpenChartAdjustment = Schema.Literals([
  "raw",
  "split",
  "split_dividend",
]);
/** Decoded observations: millisecond timestamps and ordinary numeric prices/volume. */
export const openchartBar = Schema.Struct({
  time: Schema.Int,
  open: Schema.Finite,
  high: Schema.Finite,
  low: Schema.Finite,
  close: Schema.Finite,
  volume: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  final: Schema.Boolean,
  asOf: Schema.Int,
});
/** A decoded historical or live observation. */
export type Bar = typeof openchartBar.Type;

/** One OpenChart series with explicit trading-session coverage. */
export const BarsSubscription = Schema.Struct({
  listing: Schema.Int.check(Schema.isGreaterThan(0)),
  resolution: OpenChartResolution,
  session: SessionType,
  adjustment: OpenChartAdjustment,
});
/** Typed series selection for the OpenChart client. */
export type BarsSubscription = typeof BarsSubscription.Type;
/** A single historical page within a half-open millisecond interval. */
export const BarsPageRequest = Schema.Struct({
  ...BarsSubscription.fields,
  start: Schema.Int,
  end: Schema.Int,
  limit: Schema.Int,
  order: Schema.Literals(["asc", "desc"]),
});
/** Complete page inputs; Dataset owns pagination across these requests. */
export type BarsPageRequest = typeof BarsPageRequest.Type;
/** Search text and optional result limit; omitted limits use 200. */
export const SearchRequest = Schema.Struct({
  query: Schema.String,
  limit: Schema.optionalKey(Schema.Int),
});
/** Typed listing search inputs. */
export type SearchRequest = typeof SearchRequest.Type;
/** Validated activity for one subscribed series; heartbeats carry no price. */
export const LiveEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("heartbeat") }),
  Schema.Struct({ type: Schema.Literal("bar"), bar: openchartBar }),
]);
/** Decoded updates whose identity has already been checked by the client. */
export type LiveEvent = typeof LiveEvent.Type;
/** Service capabilities; encoding and time-unit metadata remain inside the client. */
export const Capabilities = Schema.Struct({
  resolutions: Schema.Array(OpenChartResolution),
  historyAdjustments: Schema.Array(OpenChartAdjustment),
  liveAdjustments: Schema.Array(OpenChartAdjustment),
  adjustedLiveResolutions: Schema.Array(OpenChartResolution),
  sessions: Schema.Array(SessionType),
  maxHistoryRows: Schema.Int.check(Schema.isGreaterThan(0)),
  maxConnectionSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
});
/** Validated OpenChart service limits and supported selections. */
export type Capabilities = typeof Capabilities.Type;

/** A listing venue's calendar name with the stored rows needed to expand it. */
export type ListingCalendar = CalendarData & { readonly calendar: string };

/** Typed OpenChart API; consumers never handle endpoint paths or encoded responses. */
export interface Client {
  /** Emits on subscription and account reset so consumers reacquire Datasets. @example openchart.changes.pipe(Stream.runDrain); */
  readonly changes: Stream.Stream<void>;
  /** Read validated service capabilities within the request deadline. @example yield* openchart.getCapabilities(); */
  getCapabilities(): Effect.Effect<Capabilities, OpenChartError>;
  /** Search native listings; malformed responses fail explicitly. @example yield* openchart.searchListings({query: "AAPL", limit: 20}); */
  searchListings(
    request: SearchRequest,
  ): Effect.Effect<ReadonlyArray<Listing>, OpenChartError>;
  /** Read the stored calendar rows of a listing's venue; unknown listings are rejected. @example yield* openchart.readCalendar(10244); */
  readCalendar(listing: number): Effect.Effect<ListingCalendar, OpenChartError>;
  /** Read one complete page; times are milliseconds and prices are ordinary numbers. Transport/decode failures never return partial success. @example yield* openchart.readBarsPage({...series, start: 0, end: 1000, limit: 100, order: "asc"}); */
  readBarsPage(
    request: BarsPageRequest,
  ): Effect.Effect<ReadonlyArray<Bar>, OpenChartError>;
  /** Connect and buffer within one deadline. Returns validated events for the requested series; retirement drains buffered updates, failure/caller Scope closes resources. @example const updates = yield* openchart.subscribeBars(series, retired); */
  subscribeBars(
    request: BarsSubscription,
    retired?: Deferred.Deferred<void>,
  ): Effect.Effect<
    Stream.Stream<LiveEvent, OpenChartError>,
    OpenChartError,
    Scope.Scope
  >;
  /** Invalidate pending work and buffered events after account changes. @example yield* openchart.reset(); */
  reset(): Effect.Effect<void>;
}
