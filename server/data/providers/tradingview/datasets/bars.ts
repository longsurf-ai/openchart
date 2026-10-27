// Purpose: Adapt TradingView history and live bars to the Dataset declaration.

import { Effect, Stream, type Deferred, type Scope } from "effect";
import { resolutionMs } from "@openchart/feed";
import { cacheHistory } from "@openchart/server/feed/bar/history-cache";
import { Monitoring } from "@openchart/server/monitoring";
import type {
  DatasetFailure,
  SelectQuery,
  SelectResult,
  StreamQuery,
} from "@openchart/server/data/dataset";
import { tradingviewBars } from "@openchart/server/data/providers/tradingview/datasets/definitions";
import type {
  Bar,
  Client,
} from "@openchart/server/data/providers/tradingview/client";

const frame = (bars: readonly Bar[]): SelectResult<typeof tradingviewBars> =>
  tradingviewBars.frame.create({
    labels: {},
    rows: [...new Map(bars.map((bar) => [bar.time, bar])).values()].sort(
      (left, right) => left.time - right.time,
    ),
  });

/** Read complete history; the client owns validation, paging and range filtering.
 * @example const data = yield* selectBars(client, query);
 */
export const selectBars = Effect.fn("TradingView.selectBars")(function* (
  client: Client,
  query: SelectQuery<typeof tradingviewBars>,
): Effect.fn.Return<
  SelectResult<typeof tradingviewBars>,
  DatasetFailure,
  Scope.Scope
> {
  return frame(
    yield* client.history({
      symbol: query.symbol,
      resolution: query.resolution,
      adjustment: query.adjustment,
      ...(query.time.from === undefined ? {} : { from: query.time.from }),
      ...(query.time.to === undefined ? {} : { to: query.time.to }),
      ...(query.count === undefined ? {} : { count: query.count }),
    }),
  );
});

/** Share proven historical spans within one ready Dataset; recent bars stay fresh.
 * Create inside the Provider activation.
 * @example const { select } = yield* cachedSelectBars(client);
 */
export const cachedSelectBars = Effect.fn("TradingView.cachedSelectBars")(
  function* (client: Client) {
    return yield* cacheHistory(
      (query: SelectQuery<typeof tradingviewBars>) =>
        Effect.scoped(selectBars(client, query)),
      {
        window: (query, now) => ({
          from: 0,
          to: now - 2 * resolutionMs[query.resolution],
        }),
      },
    );
  },
);

/** Acquire live candles before returning; the socket buffers until consumption.
 * Retirement ends the subscription normally so accepted updates can drain.
 * Source status and heartbeats renew Monitoring in the caller's Scope; an
 * explicit exchange delay remains degraded until the source changes its mode.
 * Protocol and transport failures fail the stream, and Scope closure stops I/O.
 * @example const updates = yield* streamBars(client, query, retired);
 */
export const streamBars = Effect.fn("TradingView.streamBars")(function* (
  client: Client,
  query: StreamQuery<typeof tradingviewBars>,
  retired: Deferred.Deferred<void>,
): Effect.fn.Return<
  Stream.Stream<SelectResult<typeof tradingviewBars>, DatasetFailure>,
  DatasetFailure,
  Scope.Scope
> {
  const check = yield* Monitoring.check(
    `TradingView ${query.symbol} ${query.resolution} ${query.session}`,
  );
  const updates = yield* client.live(
    {
      symbol: query.symbol,
      resolution: query.resolution,
      adjustment: query.adjustment,
    },
    retired,
  );
  const unknown: Monitoring.Health = {
    state: "unknown",
    reason: {
      code: "data-mode",
      message: "TradingView has not reported this series' data delay.",
    },
  };
  let health: Monitoring.Health = unknown;
  return updates.pipe(
    Stream.tap((event) => {
      if (event.type === "status") {
        health =
          event.status.mode === "live"
            ? { state: "healthy" }
            : event.status.mode === "delayed"
              ? {
                  state: "degraded",
                  reason: {
                    code: "delayed",
                    message: `TradingView reports a ${event.status.delaySeconds}-second delay for this series.`,
                  },
                }
              : unknown;
      }
      return check.report(health, { validFor: "30 seconds" });
    }),
    Stream.filter((event) => event.type === "bars"),
    Stream.map((event) => frame(event.bars)),
  );
});
