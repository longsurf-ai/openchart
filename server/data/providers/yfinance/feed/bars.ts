// Purpose: Own yfinance Bars capabilities and history/update adaptation.
import { Effect, Stream } from "effect";
import type { SelectResult } from "@openchart/server/data/dataset";
import {
  FeedReasons,
  type BarsCapabilities,
  type BarsRequest,
  type Resolution,
} from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import { takeRows } from "@openchart/timeseries";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure, feedError } from "@openchart/server/feed/errors";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
import { yfinanceBars } from "@openchart/server/data/providers/yfinance/datasets/definitions/bars";

const intervals = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "1d": "1d",
  "1W": "1wk",
  "1M": "1mo",
} as const;
const resolutions = Object.keys(intervals) as Resolution[];
const intraday = new Set<Resolution>(["1m", "5m", "15m", "30m", "1h"]);

/** Yahoo reports pre/post-market data (`hasPrePostMarketData`) only for US
 * equities: USD stocks and ETFs whose symbols carry no exchange suffix. */
function hasExtendedHours(listing: BarsRequest["listing"]) {
  return (
    (listing.class === "stock" || listing.class === "etf") &&
    listing.currency === "USD" &&
    !listing.symbol.includes(".")
  );
}

/** US equities offer extended before regular at every interval, so new and
 * re-resolved charts keep pre/post-market bars across interval changes. Yahoo's
 * daily and longer bars cover the regular session only, so both sessions read
 * the same bars there, as on TradingView. Other listings offer regular only. */
function yfinanceCapabilities(
  listing: BarsRequest["listing"],
): BarsCapabilities {
  const sessions = hasExtendedHours(listing)
    ? (["extended", "regular"] as const)
    : (["regular"] as const);
  return resolutions.flatMap((resolution) =>
    sessions.map((session) => ({
      resolution,
      session,
      adjustment: "split" as const,
      modes: ["history", "delayed"] as const,
    })),
  );
}

/** Adapt split-adjusted Yahoo OHLCV; polling never claims an exchange tick stream.
 * The extended session reads Yahoo's intraday pre- and post-market bars for US equities.
 * Combinations outside {@link yfinanceCapabilities} fail with `Feed.Unsupported`.
 * @example const bars = yfinanceBarsFeed(dataset, providerId);
 */
export function yfinanceBarsFeed(
  dataset: Dataset<typeof yfinanceBars>,
  providerId: ProviderId,
): IBarsFeedService {
  return {
    getCapabilities: ({ listing }) =>
      Effect.succeed(yfinanceCapabilities(listing)),
    observe: Effect.fn("yfinanceBarsFeed.observe")(function* (
      request: BarsRequest,
    ) {
      const interval = intervals[request.resolution as keyof typeof intervals];
      if (
        !interval ||
        !yfinanceCapabilities(request.listing).some(
          (value) =>
            value.resolution === request.resolution &&
            value.session === request.session &&
            value.adjustment === request.adjustment,
        )
      ) {
        return yield* Effect.fail(
          feedError(new FeedReasons.Unsupported({ provider: providerId })),
        );
      }
      const key = {
        symbol: request.listing.symbol,
        interval,
        // Daily and longer bars ignore pre/post data; share their regular reads.
        includePrePost:
          request.session === "extended" && intraday.has(request.resolution),
      };
      // Yahoo acquisition prepares polling; the first poll runs only after this snapshot.
      const updates =
        request.to === "now"
          ? yield* dataset
              .stream(key)
              .pipe(Effect.mapError(datasetFailure(providerId)))
          : undefined;
      const snapshot = yield* readBarsHistory(request, (bounds) =>
        dataset
          .select({
            ...key,
            time: { from: bounds.from, to: bounds.to },
            count: bounds.count,
          })
          .pipe(Effect.mapError(datasetFailure(providerId))),
      );
      if (!updates) return { snapshot };
      const values = (
        frame: SelectResult<typeof yfinanceBars>,
        index: number,
      ) => {
        const row = frame.get(index)!;
        return [row.open, row.high, row.low, row.close, row.volume];
      };
      const versions = new Map(
        [...snapshot.data].map(({ time }, index) => [
          time,
          values(snapshot.data, index),
        ]),
      );
      return {
        snapshot,
        updates: updates.pipe(
          Stream.mapError(datasetFailure(providerId)),
          Stream.map((frame) =>
            takeRows(
              frame,
              [...frame].flatMap(({ time }, index) => {
                if (time < snapshot.range.from) return [];
                const next = values(frame, index);
                const previous = versions.get(time);
                // A repeated missing value is unchanged, just like a repeated price.
                if (
                  previous?.every((value, column) =>
                    Object.is(value, next[column]),
                  )
                )
                  return [];
                versions.set(time, next);
                return [index];
              }),
            ),
          ),
          Stream.filter((frame) => frame.numRows > 0),
        ),
      };
    }),
  };
}
