// Purpose: Own binance Bars capabilities and history/update adaptation.
import { Effect, Stream } from "effect";
import type { SelectResult, StreamQuery } from "@openchart/server/data/dataset";
import {
  FeedReasons,
  type BarsCapabilities,
  type BarsRequest,
} from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import { takeRows } from "@openchart/timeseries";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure, feedError } from "@openchart/server/feed/errors";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions/bars";

const resolutions = [
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
] as const;
const binanceCapabilities: BarsCapabilities = resolutions.map((resolution) => ({
  resolution,
  session: "24h",
  adjustment: "raw",
  modes: ["history", "live"],
}));

/** Adapt exactly the Binance Bars declaration, never a similarly shaped Dataset.
 * Failures name `providerId`.
 * @example const feed = binanceBarsFeed(dataset, providerId);
 */
export function binanceBarsFeed(
  dataset: Dataset<typeof binanceBars>,
  providerId: ProviderId,
): IBarsFeedService {
  return {
    getCapabilities: (request) =>
      Effect.succeed(
        request.listing.class === "crypto" ? binanceCapabilities : [],
      ),
    observe: Effect.fn("binanceBarsFeed.observe")(function* (
      request: BarsRequest,
    ) {
      if (
        request.listing.class !== "crypto" ||
        request.session !== "24h" ||
        request.adjustment !== "raw"
      ) {
        return yield* Effect.fail(
          feedError(new FeedReasons.Unsupported({ provider: providerId })),
        );
      }
      const interval: StreamQuery<typeof binanceBars>["interval"] =
        request.resolution === "1W" ? "1w" : request.resolution;
      const key = { symbol: request.listing.symbol, interval };
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
      const version = (
        frame: SelectResult<typeof binanceBars>,
        index: number,
      ) => {
        const row = frame.get(index)!;
        return { trades: row.trades!, asOf: row.asOf!, final: row.final! };
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
                // Older buffered observations cannot roll the snapshot backward.
                if (
                  previous &&
                  (next.trades < previous.trades ||
                    (next.trades === previous.trades &&
                      next.asOf <= previous.asOf) ||
                    (previous.final && !next.final))
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
