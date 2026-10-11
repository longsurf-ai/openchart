// Purpose: Derive a listing's live price, change, and volume from its two latest daily bars.
import type { BarsRequest } from "@openchart/feed";
import { barsSeries } from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import { mergeByTime } from "@openchart/timeseries";
import {
  useObservable,
  useObservableState,
  useSubscription,
} from "observable-hooks";
import { useEffect, useState } from "react";
import {
  catchError,
  auditTime,
  distinctUntilChanged,
  of,
  EMPTY,
  map,
  scan,
  startWith,
  switchMap,
  type Observable,
} from "rxjs";

import {
  useBars,
  useBarsCapabilities,
  type BarsView,
} from "@openchart/app/hooks/use-bars";
import { useWatchlistPlacement } from "../components/context";

/** What a row shows; a missing value renders as a dash. */
export type Quote = {
  readonly price?: number;
  readonly change?: number;
  readonly changePercent?: number;
  readonly volume?: number;
  /** The baseline Price History draws against. */
  readonly previousClose?: number;
};

/** One session's transient quotes; Feed owns channel sharing. */
export type Quotes = Readonly<Record<string, Quote>>;
const NO_QUOTES: Quotes = {};

/** Sample sorting values at most four times a second; unsorted trees ignore ticks. Subscriptions and timers end on unmount. @example const quotes = useSortQuotes(sort !== null); */
export function useSortQuotes(enabled: boolean): Quotes {
  const { quotes } = useWatchlistPlacement();
  return useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([enabled, quotes]) =>
            enabled
              ? quotes.pipe(auditTime(250), startWith(quotes.value))
              : of(NO_QUOTES),
          ),
        ),
      [enabled, quotes],
    ),
    NO_QUOTES,
  );
}

const DAY = 86_400_000;

/**
 * The quote as of an earlier `close` this session: price and change follow it
 * against the previous close; volume stays live. Returns `quote` unchanged
 * without a close or a previous close.
 * @example quoteAt({ price: 110, previousClose: 100 }, 105); // change 5, changePercent 5
 */
export function quoteAt(
  quote: Quote | undefined,
  close: number | undefined,
): Quote | undefined {
  const previous = quote?.previousClose;
  if (close === undefined || !previous) return quote;
  const change = close - previous;
  return {
    ...quote,
    price: close,
    change,
    changePercent: (change / previous) * 100,
  };
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function quoteOf(frame: BarsView["data"]): Quote {
  const last = frame.get(frame.numRows - 1);
  const previous = frame.numRows > 1 ? frame.get(frame.numRows - 2) : null;
  const price = finite(last?.close);
  const close = finite(previous?.close);
  const change =
    price !== undefined && close !== undefined ? price - close : undefined;
  return {
    price,
    change,
    changePercent:
      change !== undefined && close ? (change / close) * 100 : undefined,
    volume: finite(last?.volume),
    previousClose: close,
  };
}

/**
 * The live daily-bar request for a listing, using the source's first daily
 * session and adjustment. The request is undefined until capabilities arrive
 * or when daily bars are unavailable. The caller owns the returned error and
 * retry action. The window start stays fixed per mount.
 * @example const { request, error, retry } = useDailyRequest(listing);
 */
export function useDailyRequest(listing: ProviderListing) {
  // The row owns its failure and retry action.
  const capabilities = useBarsCapabilities(listing, { silent: true });
  const [from] = useState(() => Date.now() - 14 * DAY);
  const daily = capabilities.data?.find((option) => option.resolution === "1d");
  const request: BarsRequest | undefined = daily
    ? { ...barsSeries(listing, daily), from, to: "now", countBack: 2 }
    : undefined;
  return { request, error: capabilities.error, retry: capabilities.refetch };
}

/** One quote from the snapshot, then one per merged update. */
function quotesOf(view: BarsView): Observable<Quote> {
  return view.updates.pipe(
    // The hook exposes this failure through bars.status.
    catchError(() => EMPTY),
    scan((ohlcv, tickUpdate) => mergeByTime(ohlcv, tickUpdate), view.data),
    startWith(view.data),
    map(quoteOf),
  );
}

/**
 * Follow one listing's two latest daily bars: price is the last close, change
 * compares it with the previous close, and volume is the last bar's. Feed
 * may reuse a covering channel for the same series. Publishes each
 * quote to this placement's transient sorting cache under `key`; unmounting
 * removes it. Feed owns shared subscriptions, not this presentation cache.
 * @example const {quote} = useLiveQuote(request, providerListingKey(listing));
 */
export function useLiveQuote(request: BarsRequest, key: string) {
  const { quotes } = useWatchlistPlacement();
  const bars = useBars(request);
  useSubscription(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([current, status]) =>
            current && status !== "error" ? quotesOf(current) : of(undefined),
          ),
        ),
      [bars.current, bars.status],
    ),
    (quote) => quotes.next({ ...quotes.value, [key]: quote ?? {} }),
  );
  const quote = useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([quotes, key]) =>
            quotes.pipe(
              map((values) => values[key]),
              distinctUntilChanged(),
            ),
          ),
        ),
      [quotes, key],
    ),
  );
  useEffect(
    () => () => {
      const next = { ...quotes.value };
      delete next[key];
      quotes.next(next);
    },
    [key, quotes],
  );
  const error = bars.status === "error" ? bars.error : undefined;
  return {
    quote: error ? undefined : quote,
    error,
    retry: bars.retry,
  };
}
