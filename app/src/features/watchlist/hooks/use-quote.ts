// Purpose: Derive a listing's live price, change, and volume from its two latest daily bars.
import type { BarsRequest } from "@openchart/feed";
import { barsSeries } from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import { mergeByTime } from "@openchart/timeseries";
import { useObservable, useObservableState } from "observable-hooks";
import { useEffect, useState } from "react";
import {
  catchError,
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
};

const DAY = 86_400_000;

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
  };
}

/**
 * The live daily-bar request for a listing, using the source's first daily
 * session and adjustment. Undefined until capabilities arrive, when the
 * source has no daily bars, or when they fail; failures raise no toast. The window start is fixed per mount so re-renders
 * never reopen the channel.
 * @example const request = useDailyRequest(listing);
 */
export function useDailyRequest(
  listing: ProviderListing,
): BarsRequest | undefined {
  // A row shows its own failure as dashes rather than one toast per row.
  const capabilities = useBarsCapabilities(listing, { silent: true });
  const [from] = useState(() => Date.now() - 14 * DAY);
  const daily = capabilities.data?.find((option) => option.resolution === "1d");
  return daily
    ? { ...barsSeries(listing, daily), from, to: "now", countBack: 2 }
    : undefined;
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
 * shares the channel with any other view of the same series. Publishes each
 * quote to this placement's transient sorting cache under `key`; unmounting
 * removes it. Feed owns shared subscriptions, not this presentation cache.
 * @example const {quote} = useLiveQuote(request, providerListingKey(listing));
 */
export function useLiveQuote(request: BarsRequest, key: string) {
  const { quotes } = useWatchlistPlacement();
  const bars = useBars(request);
  const quote = useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([current]) => (current ? quotesOf(current) : EMPTY)),
        ),
      [bars.current],
    ),
  );
  useEffect(() => {
    if (quote) quotes.setState({ [key]: quote });
  }, [key, quote, quotes]);
  useEffect(
    () => () => {
      quotes.setState((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      }, true);
    },
    [key, quotes],
  );
  return { quote, failed: bars.status === "error" };
}
