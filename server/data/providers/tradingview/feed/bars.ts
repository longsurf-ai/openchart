// Purpose: Own TradingView bars capabilities and history/update adaptation.

import { Effect, Stream } from "effect";
import type { SelectResult } from "@openchart/server/data/dataset";
import {
  FeedReasons,
  type Adjustment,
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
import { tradingviewBars } from "@openchart/server/data/providers/tradingview/datasets/definitions";

const resolutions: readonly Resolution[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1W",
  "1M",
];
// Each resolution lists its default first, split adjusted, as other providers do.
const adjustments: readonly Adjustment[] = ["split", "raw", "split_dividend"];

/** TradingView's session selector follows the listing; crypto trades continuously. */
const sessionFor = (request: BarsRequest["listing"]): "regular" | "24h" =>
  request.class === "crypto" ? "24h" : "regular";

/** The full `EXCHANGE:SYMBOL` identity recorded by symbology. Undefined for a
 * listing with neither a venue nor a qualified symbol, whose exchange
 * TradingView would otherwise pick itself.
 * @example symbolFor({symbol: 'AAPL', venue: 'NASDAQ', currency: 'USD'}); // "NASDAQ:AAPL"
 */
export function symbolFor(listing: BarsRequest["listing"]) {
  return listing.symbol.includes(":")
    ? listing.symbol
    : listing.venue
      ? `${listing.venue.toUpperCase()}:${listing.symbol}`
      : undefined;
}

const unqualified = () =>
  feedError(
    new FeedReasons.InvalidRequest({
      detail:
        "A TradingView listing needs its venue or an EXCHANGE:SYMBOL symbol.",
    }),
  );

function capabilities(request: BarsRequest["listing"]): BarsCapabilities {
  const session = sessionFor(request);
  return resolutions.flatMap((resolution) =>
    adjustments.map((adjustment) => ({
      resolution,
      session,
      adjustment,
      // TradingView reports the actual exchange entitlement when subscribing.
      modes: ["history", "live", "delayed"] as const,
    })),
  );
}

/** Adapt exactly the TradingView Bars declaration; unsupported combinations
 * fail, and a listing without its exchange fails `Feed.InvalidRequest`. Live
 * updates end only when the source retires: once its accepted updates drain
 * they fail with retryable `Feed.Reconfigured`, so consumers reopen on the
 * current source instead of waiting on a closed one. Source failures keep
 * their own reasons, and history reads have no updates. Receipt order prevents
 * buffered observations from replacing a later snapshot of the same bar;
 * TradingView supplies no comparable upstream revision across these sockets.
 * @example const bars = tradingviewBarsFeed(dataset, providerId);
 */
export function tradingviewBarsFeed(
  dataset: Dataset<typeof tradingviewBars>,
  providerId: ProviderId,
): IBarsFeedService {
  return {
    getCapabilities: (request) =>
      symbolFor(request.listing) === undefined
        ? Effect.fail(unqualified())
        : Effect.succeed(capabilities(request.listing)),
    observe: Effect.fn("tradingviewBarsFeed.observe")(function* (
      request: BarsRequest,
    ) {
      const symbol = symbolFor(request.listing);
      if (symbol === undefined) return yield* Effect.fail(unqualified());
      if (
        request.session !== sessionFor(request.listing) ||
        !resolutions.includes(request.resolution) ||
        !adjustments.includes(request.adjustment)
      ) {
        return yield* Effect.fail(
          feedError(new FeedReasons.Unsupported({ provider: providerId })),
        );
      }
      const key = {
        symbol,
        resolution: request.resolution,
        session: request.session,
        adjustment: request.adjustment,
      };
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
            ...(bounds.count === undefined ? {} : { count: bounds.count }),
          })
          .pipe(Effect.mapError(datasetFailure(providerId))),
      );
      if (!updates) return { snapshot };
      const version = (
        frame: SelectResult<typeof tradingviewBars>,
        index: number,
      ) => {
        const row = frame.get(index)!;
        return {
          receivedSequence: row.receivedSequence!,
          values: [row.open, row.high, row.low, row.close, row.volume],
        };
      };
      const versions = new Map(
        [...snapshot.data].map(({ time }, index) => [
          time,
          version(snapshot.data, index),
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
                const next = version(frame, index);
                const previous = versions.get(time);
                // The stamp is assigned at socket receipt, before both queues.
                // Price and volume can fall in a valid later correction.
                if (
                  previous &&
                  next.receivedSequence <= previous.receivedSequence
                )
                  return [];
                versions.set(time, next);
                if (
                  previous?.values.every((value, column) =>
                    Object.is(value, next.values[column]),
                  )
                )
                  return [];
                return [index];
              }),
            ),
          ),
          Stream.filter((frame) => frame.numRows > 0),
          Stream.concat(
            Stream.fail(
              feedError(new FeedReasons.Reconfigured({ provider: providerId })),
            ),
          ),
        ),
      };
    }),
  };
}
