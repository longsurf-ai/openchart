// Purpose: Ordinary browser Feed interfaces; subscriptions own snapshot/update continuity.
import type {
  BarsRequest,
  BarsCapabilities,
  CalendarRequest,
  CalendarResult,
  LogoRequest,
  LogoResult,
  SeriesRequest,
  SeriesSnapshot,
  SymbolSearchRequest,
  SymbolSearchResult,
  SymbolIndexRequest,
  SymbolIndexStatus,
} from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import type { Observable } from "rxjs";

import type { BarsView } from "./contracts";

/** Cancellation applies to the entire request. */
export interface RequestOptions {
  readonly signal?: AbortSignal;
}
/** Provider-routed Bars access, independent of React. */
export interface IBarsFeed {
  /**
   * Subscribe to one window. Subscribers share an open live view that covers the
   * request, and it stays open for a few minutes after the last one leaves (see
   * `shareBarsViews` in [bars.ts](./bars.ts)). Unsubscribe to cancel.
   * @example const sub = feed.observe(request).subscribe(show);
   */
  observe(request: BarsRequest): Observable<BarsView>;
  /** Queries supported combinations. @example await feed.getCapabilities({provider, listing}); */
  getCapabilities(
    request: ProviderListing,
    options?: RequestOptions,
  ): Promise<BarsCapabilities>;
}
/** Searches the server's merged view of available sources. */
export interface ISymbologyFeed {
  /** Start backend-owned enumeration. @example await feed.index({providerId: 'binance', filter: {}}); */
  index(
    request: SymbolIndexRequest,
    options?: RequestOptions,
  ): Promise<{ runId: string }>;
  /** Current capability and latest run for each provider. @example await feed.indexStatus(); */
  indexStatus(options?: RequestOptions): Promise<SymbolIndexStatus>;
  /** Preserves each result's provider identity. @example await feed.search({query: 'Apple', limit: 20, indexed: true}); */
  search(
    request: SymbolSearchRequest,
    options?: RequestOptions,
  ): Promise<SymbolSearchResult>;
}
/** Identifier-based server logo resolution. */
export interface ILogosFeed {
  /** Returns one confident match or null. @example await feed.getLogo({identifier: "BTC"}); */
  getLogo(request: LogoRequest, options?: RequestOptions): Promise<LogoResult>;
}
/** Optional server trading-calendar access. */
export interface ICalendarFeed {
  /** Resolves venue dates in consumer timezone. @example await feed.getCalendar(request); */
  getCalendar(
    request: CalendarRequest,
    options?: RequestOptions,
  ): Promise<CalendarResult>;
}
/** Declared timeseries, such as Workspace Datasets, read whole or by range. */
export interface ISeriesFeed {
  /** Every declared column in the range; an id no ready source serves fails unavailable. @example await feed.select({id: "wsd_x"}); */
  select(
    request: SeriesRequest,
    options?: RequestOptions,
  ): Promise<SeriesSnapshot>;
}
/** Stable access to current backend services; availability changes do not replace this client. */
export interface FeedClient {
  readonly bars: IBarsFeed;
  readonly symbology: ISymbologyFeed;
  readonly logos: ILogosFeed;
  readonly calendar: ICalendarFeed;
  readonly series: ISeriesFeed;
  /** Cancels this client's requests and channels; the shared application connection stays open. @example client.close(); */
  close(): void;
}
