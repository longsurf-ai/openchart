// Purpose: Fetch paginated Binance klines and acquire ready, bounded WebSocket streams.

import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Queue,
  Schedule,
  Stream,
  type Scope,
} from "effect";
import { cacheHistory } from "@openchart/server/feed/bar/history-cache";
import { Monitoring } from "@openchart/server/monitoring";
import {
  DatasetFailure,
  DatasetReasons,
  type RowOf,
  type SelectQuery,
  type SelectResult,
  type StreamQuery,
} from "@openchart/server/data/dataset";
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import WebSocket from "ws";
import { Schema } from "effect";

import {
  binanceError,
  httpReason,
} from "@openchart/server/data/providers/binance/errors";
import {
  defaultHost,
  request,
  type BinanceOptions,
} from "@openchart/server/data/providers/binance/client";

const Decimal = Schema.NonEmptyString.pipe(
  Schema.decodeTo(Schema.FiniteFromString),
);
const Kline = Schema.Tuple([
  Schema.Finite.check(Schema.isInt()),
  Decimal,
  Decimal,
  Decimal,
  Decimal,
  Decimal.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.Finite.check(Schema.isInt()),
  Decimal,
  Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  Decimal,
  Decimal,
  Schema.String,
]);
const Klines = Schema.Array(Kline);
const Event = Schema.Struct({
  e: Schema.Literal("kline"),
  E: Schema.Finite.check(Schema.isInt()),
  s: Schema.String,
  k: Schema.Struct({
    t: Schema.Finite.check(Schema.isInt()),
    s: Schema.String,
    i: Schema.String,
    o: Decimal,
    h: Decimal,
    l: Decimal,
    c: Decimal,
    v: Decimal.check(Schema.isGreaterThanOrEqualTo(0)),
    n: Schema.Finite.check(Schema.isInt()).check(
      Schema.isGreaterThanOrEqualTo(0),
    ),
    x: Schema.Boolean,
  }),
});
const Message = Schema.fromJsonString(Event);
type Bar = RowOf<typeof binanceBars>;

function frame(rows: readonly Bar[]): SelectResult<typeof binanceBars> {
  return binanceBars.frame.create({ labels: {}, rows });
}

/** Share historical spans within one ready Dataset; recent buckets remain source reads.
 * `read` is the native select, such as {@link selectBars} through the activation's host.
 * Create inside the Provider activation and install behind makeDataset admission.
 * @example const { select } = yield* cachedSelectBars((query) => selectBars(options, query));
 */
export const cachedSelectBars = Effect.fn("Binance.cachedSelectBars")(
  function* (
    read: (
      query: SelectQuery<typeof binanceBars>,
    ) => Effect.Effect<SelectResult<typeof binanceBars>, DatasetFailure>,
  ) {
    return yield* cacheHistory(read, {
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
          "1w": 7 * 86_400_000,
          "1M": 32 * 86_400_000,
        }[query.interval];
        return { from: 0, to: now - 2 * duration };
      },
    });
  },
);

/** Read actual klines until count or an exhausted interval, preserving ascending time.
 * @example const data = yield* selectBars({}, {symbol: 'BTCUSDT', interval: '1m', time: {}, count: 500});
 */
export const selectBars = Effect.fn("Binance.selectBars")(function* (
  options: BinanceOptions,
  query: SelectQuery<typeof binanceBars>,
) {
  if (query.time.from === undefined && query.count === undefined) {
    return yield* Effect.fail(
      new DatasetFailure(
        new DatasetReasons.InvalidQuery({
          detail: "Binance bars require a start or count.",
        }),
      ),
    );
  }
  const forward = query.time.from !== undefined;
  const end = query.time.to ?? (yield* Clock.currentTimeMillis);
  let cursor = forward ? query.time.from! : end;
  const rows: Bar[] = [];
  while (query.count === undefined || rows.length < query.count) {
    if (forward && cursor >= end) break;
    const limit = Math.min(
      1000,
      query.count === undefined ? 1000 : query.count - rows.length,
    );
    const body = yield* request(options, "/api/v3/klines", {
      symbol: query.symbol,
      interval: query.interval,
      limit: String(limit),
      endTime: String((forward ? end : cursor) - 1),
      ...(forward ? { startTime: String(cursor) } : {}),
    });
    const page = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Klines)(body),
      catch: binanceError,
    });
    if (page.length === 0) break;
    const asOf = yield* Clock.currentTimeMillis;
    for (let i = 0; i < page.length; i++) {
      const row = page[i]!;
      if (
        row[0] >= end ||
        (forward && row[0] < cursor) ||
        (!forward && row[0] >= cursor) ||
        (i > 0 && row[0] <= page[i - 1]![0])
      ) {
        return yield* Effect.fail(
          new DatasetFailure(new DatasetReasons.InvalidResult(), {
            cause: "Binance returned unordered or out-of-range bars.",
          }),
        );
      }
      rows.push({
        time: row[0],
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
        volume: row[5],
        trades: row[8],
        final: row[6] < asOf,
        asOf,
      });
    }
    cursor = forward ? page[page.length - 1]![0] + 1 : page[0]![0];
    if (page.length < limit) break;
  }
  return frame(rows.sort((a, b) => a.time - b.time));
});

const disconnected = (cause: string) =>
  new DatasetFailure(
    new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
    { cause },
  );

/** Binance pings every 20 seconds, so this much silence means the socket is dead. */
const silenceLimit = 45_000;
/** A kline whose event time trails the local clock by more than this arrives late. */
const lateLimit = 10_000;
/** Lateness is evidence only this long after its kline; idle pairs may send none for hours. */
const lateWindow = 15_000;

/** Acquire an already connected kline subscription; messages buffer before consumption.
 * Closing the scope terminates the socket. Overflow, upstream close and 45 seconds
 * without any frame (kline or ping) are errors, so the consumer reconnects.
 * Retirement stops the producer and drains accepted messages before normal completion.
 * Reports a Monitoring check: starting until the first frame, then healthy while
 * frames arrive, degraded while recent klines arrive late. Klines come only on
 * trades and at bucket open, so kline silence alone is normal.
 * @example const updates = yield* streamBars({}, {symbol: 'BTCUSDT', interval: '1m'}, retired);
 */
export const streamBars = Effect.fn("Binance.streamBars")(function* (
  options: BinanceOptions,
  query: StreamQuery<typeof binanceBars>,
  retired: Deferred.Deferred<void>,
): Effect.fn.Return<
  Stream.Stream<SelectResult<typeof binanceBars>, DatasetFailure>,
  DatasetFailure,
  Scope.Scope
> {
  const checker = yield* Monitoring.check(
    `Binance ${query.symbol} ${query.interval}`,
  );
  const clock = yield* Clock.Clock;
  const queue = yield* Queue.make<
    SelectResult<typeof binanceBars>,
    DatasetFailure | Cause.Done
  >({ capacity: options.bufferCapacity ?? 256 });
  const url = `${options.websocketUrl ?? defaultHost.websocketUrl}/ws/${query.symbol.toLowerCase()}@kline_${query.interval}`;
  const socket = yield* Effect.acquireRelease(
    Effect.try({
      try: () => options.websocket?.(url) ?? new WebSocket(url),
      catch: binanceError,
    }),
    (socket) => Effect.sync(() => socket.terminate()),
  );
  yield* Effect.addFinalizer(() => Queue.shutdown(queue));
  let failure: DatasetFailure | undefined;
  let ending = false;
  let lastFrameAt = clock.currentTimeMillisUnsafe();
  // Opening proves nothing; health starts with the first frame.
  let framed = false;
  let lastKlineAt = 0;
  let lateBy = 0;
  socket.on("ping", () => {
    framed = true;
    lastFrameAt = clock.currentTimeMillisUnsafe();
  });
  // The first failure is the cause; the socket closing after it adds nothing.
  const fail = (error: DatasetFailure) => {
    if (ending || failure) return;
    failure = error;
    Queue.failCauseUnsafe(queue, Cause.fail(error));
    socket.terminate();
  };
  socket.on("message", (raw) => {
    if (ending) return;
    try {
      const event = Schema.decodeUnknownSync(Message)(raw.toString());
      if (
        event.s !== query.symbol ||
        event.k.s !== query.symbol ||
        event.k.i !== query.interval
      ) {
        fail(
          new DatasetFailure(new DatasetReasons.InvalidResult(), {
            cause: "Binance sent a different kline subscription.",
          }),
        );
        return;
      }
      framed = true;
      lastFrameAt = lastKlineAt = clock.currentTimeMillisUnsafe();
      lateBy = lastFrameAt - event.E;
      const row = event.k;
      const value = frame([
        {
          time: row.t,
          open: row.o,
          high: row.h,
          low: row.l,
          close: row.c,
          volume: row.v,
          trades: row.n,
          final: row.x,
          asOf: event.E,
        },
      ]);
      if (!Queue.offerUnsafe(queue, value)) {
        fail(
          new DatasetFailure(
            new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
          ),
        );
      }
    } catch (cause) {
      fail(new DatasetFailure(new DatasetReasons.InvalidResult(), { cause }));
    }
  });
  socket.on("error", (cause) => fail(binanceError(cause)));
  // ws reports a refused upgrade without its status; 403 and 451 deny access.
  socket.once("unexpected-response", (_request, response) =>
    fail(
      new DatasetFailure(httpReason(response.statusCode ?? 0), {
        cause: `Binance refused the stream (${response.statusCode}).`,
      }),
    ),
  );
  socket.on("close", () => fail(disconnected("Binance closed the stream.")));
  yield* Effect.callback<void, DatasetFailure>((resume) => {
    const open = () => resume(Effect.void);
    const error = (cause: unknown) =>
      resume(Effect.fail(failure ?? binanceError(cause)));
    const close = () =>
      resume(Effect.fail(disconnected("Binance closed before subscribing.")));
    socket.once("open", open).once("error", error).once("close", close);
    if (failure) resume(Effect.fail(failure));
    else if (socket.readyState === WebSocket.OPEN) resume(Effect.void);
    return Effect.sync(() => {
      socket.off("open", open).off("error", error).off("close", close);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () =>
        Effect.fail(
          new DatasetFailure(new DatasetReasons.Unavailable(), {
            cause: "Binance subscription timed out.",
          }),
        ),
    }),
  );
  lastFrameAt = clock.currentTimeMillisUnsafe();
  // Renewed every 5 seconds; a stalled watchdog lets the report lapse to unknown.
  yield* Effect.gen(function* () {
    if (ending || failure) return;
    const now = yield* Clock.currentTimeMillis;
    if (now - lastFrameAt > silenceLimit) {
      fail(
        new DatasetFailure(new DatasetReasons.Unavailable(), {
          cause: "Binance stopped sending data.",
        }),
      );
      return;
    }
    if (!framed) return;
    yield* checker.report(
      lateBy > lateLimit && now - lastKlineAt < lateWindow
        ? {
            state: "degraded",
            // Stable text: a changing number would republish on every renewal.
            reason: {
              code: "late",
              message: "Binance data is arriving more than 10 seconds late.",
            },
          }
        : { state: "healthy" },
      { validFor: "15 seconds" },
    );
  }).pipe(Effect.repeat(Schedule.spaced("5 seconds")), Effect.forkScoped);
  yield* Deferred.await(retired).pipe(
    Effect.andThen(
      Effect.sync(() => {
        // Stop callback admission before ending the queue; accepted updates remain readable.
        ending = true;
        Queue.endUnsafe(queue);
        socket.terminate();
      }),
    ),
    Effect.forkScoped,
  );
  return Stream.fromQueue(queue);
});
