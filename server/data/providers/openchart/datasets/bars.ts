// Purpose: Paginate decoded OpenChart observations and adapt live activity to Dataset frames.
import { Clock, Deferred, Effect, Stream } from "effect";
import {
  DatasetFailure,
  DatasetReasons,
  type RowOf,
  type SelectQuery,
  type StreamQuery,
} from "@openchart/server/data/dataset";
import { openchartBars } from "@openchart/server/data/providers/openchart/datasets/definitions";
import type { Client } from "@openchart/server/data/providers/openchart/contract";
import { cacheHistory } from "@openchart/server/feed/bar/history-cache";
import { Monitoring } from "@openchart/server/monitoring";
import { openchartError } from "@openchart/server/data/providers/openchart/errors";

type Bar = RowOf<typeof openchartBars>;
/** Share historical spans within one ready Dataset; recent buckets remain source reads.
 * Create inside the Provider activation and install behind makeDataset admission.
 * @example const { select } = yield* cachedSelectBars(client);
 */
export const cachedSelectBars = Effect.fn("OpenChart.cachedSelectBars")(
  function* (client: Client) {
    return yield* cacheHistory(
      (query: SelectQuery<typeof openchartBars>) => selectBars(client, query),
      {
        isFinal: (row) => row.final === true,
        window: (query, now) => {
          // Keep the current and preceding bucket fresh, including calendar/zone margins.
          const duration = {
            "1s": 1000,
            "1m": 60_000,
            "5m": 300_000,
            "15m": 900_000,
            "30m": 1_800_000,
            "1h": 3_600_000,
            "4h": 14_400_000,
            "1d": 86_400_000,
            "1W": 7 * 86_400_000,
            "1M": 32 * 86_400_000,
          }[query.resolution];
          return { from: 0, to: now - 2 * duration };
        },
      },
    );
  },
);

/** Read every page in the requested interval, or the latest actual count. Failures never truncate success. @example yield* selectBars(client, query); */
export const selectBars = Effect.fn("OpenChart.selectBars")(function* (
  client: Client,
  query: SelectQuery<typeof openchartBars>,
) {
  if (query.time.from === undefined && query.count === undefined)
    return yield* Effect.fail(
      new DatasetFailure(
        new DatasetReasons.InvalidQuery({
          detail: "OpenChart bars require a start or count.",
        }),
      ),
    );
  const forward = query.time.from !== undefined;
  const end = query.time.to ?? (yield* Clock.currentTimeMillis);
  // OpenChart history starts at the Unix epoch; wider chart windows intersect it.
  const start = Math.max(0, query.time.from ?? 0);
  let cursor = forward ? start : end;
  const rows: Bar[] = [];
  while (query.count === undefined || rows.length < query.count) {
    if (forward ? cursor >= end : cursor <= start) break;
    const limit = Math.min(
      10000,
      query.count === undefined ? 10000 : query.count - rows.length,
    );
    const page = yield* client
      .readBarsPage({
        listing: query.listing,
        resolution: query.resolution,
        session: query.session,
        adjustment: query.adjustment,
        start: forward ? cursor : start,
        end: forward ? end : cursor,
        limit,
        order: forward ? "asc" : "desc",
      })
      .pipe(Effect.mapError(openchartError));
    if (!page.length) break;
    for (let i = 0; i < page.length; i++) {
      const row = page[i]!;
      if (
        row.time < (forward ? cursor : start) ||
        row.time >= (forward ? end : cursor) ||
        (i > 0 &&
          (forward
            ? row.time <= page[i - 1]!.time
            : row.time >= page[i - 1]!.time))
      )
        return yield* Effect.fail(
          new DatasetFailure(new DatasetReasons.InvalidResult(), {
            cause:
              "OpenChart history is unordered or outside the requested interval.",
          }),
        );
    }
    rows.push(...page);
    cursor = forward
      ? page[page.length - 1]!.time + 1
      : page[page.length - 1]!.time;
    if (page.length < limit) break;
  }
  return openchartBars.frame.create({
    labels: {},
    rows: rows.sort((a, b) => a.time - b.time),
  });
});
/** Subscribe before history; heartbeats prove liveness but never become price data. Retirement drains accepted updates. @example const updates = yield* streamBars(client, query, retired); */
export const streamBars = Effect.fn("OpenChart.streamBars")(function* (
  client: Client,
  query: StreamQuery<typeof openchartBars>,
  retired: Deferred.Deferred<void>,
) {
  const check = yield* Monitoring.check(
    `OpenChart ${query.listing} ${query.resolution} ${query.session}`,
  );
  const updates = yield* client
    .subscribeBars(query, retired)
    .pipe(Effect.mapError(openchartError));
  return updates.pipe(
    Stream.mapError(openchartError),
    // Stream.timeout would end normally; silence is a failure so the consumer reconnects.
    Stream.timeoutOrElse({
      duration: "45 seconds",
      orElse: () =>
        Stream.fail(
          new DatasetFailure(new DatasetReasons.Unavailable(), {
            cause: "OpenChart stopped sending heartbeats.",
          }),
        ),
    }),
    Stream.tap(() =>
      check.report({ state: "healthy" }, { validFor: "45 seconds" }),
    ),
    Stream.filter((event) => event.type === "bar"),
    Stream.map((event) =>
      openchartBars.frame.create({ labels: {}, rows: [event.bar] }),
    ),
  );
});
