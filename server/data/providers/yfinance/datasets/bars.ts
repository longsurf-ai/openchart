// Purpose: Fetch complete Yahoo chart bars and poll overlapping windows without Python.

import { Clock, Deferred, Effect, Stream, type Scope } from "effect";
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
import { yfinanceBars } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { Temporal } from "@js-temporal/polyfill";
import { Schema } from "effect";

import { invalidResult } from "@openchart/server/data/providers/yfinance/errors";
import {
  request,
  type YFinanceOptions,
} from "@openchart/server/data/providers/yfinance/client";

const Day = 86_400_000;
const intervals = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "60m": 3_600_000,
  "1d": Day,
  "1wk": 7 * Day,
  "1mo": 31 * Day,
} as const;
const retention = (interval: keyof typeof intervals) =>
  interval === "1m"
    ? 30 * Day
    : interval === "60m"
      ? 729 * Day
      : intervals[interval] < Day
        ? 59 * Day
        : Infinity;
const correctionOverlap = (interval: keyof typeof intervals) =>
  Math.max(2 * Day, 2 * intervals[interval]);
// Yahoo starts weekly bars on the weekday of the request's period1, such as
// Friday for 1 Jan 2021. From 00:00 UTC on a Monday, they start on the
// exchange's Monday, in New York, London and Tokyo alike. 1970-01-05 was a
// Monday.
const mondayAtOrBefore = (time: number) =>
  Math.floor((time - 4 * Day) / (7 * Day)) * 7 * Day + 4 * Day;
const NumberArray = Schema.Array(Schema.NullOr(Schema.Finite));
const Quote = Schema.Struct({
  open: NumberArray,
  high: NumberArray,
  low: NumberArray,
  close: NumberArray,
  volume: Schema.Array(
    Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
});
const Metadata = Schema.Struct({
  symbol: Schema.String.check(Schema.isMinLength(1)),
  // Null for some quotes, such as the XAGAMD=X currency pair.
  currency: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  exchangeName: Schema.String.check(Schema.isMinLength(1)),
  instrumentType: Schema.String.check(Schema.isMinLength(1)),
  longName: Schema.optionalKey(Schema.String),
  shortName: Schema.optionalKey(Schema.String),
  firstTradeDate: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  dataGranularity: Schema.String,
  exchangeTimezoneName: Schema.optionalKey(Schema.String),
  regularMarketTime: Schema.optionalKey(Schema.Finite),
  hasPrePostMarketData: Schema.optionalKey(Schema.Boolean),
  currentTradingPeriod: Schema.optionalKey(
    Schema.Struct({
      regular: Schema.Struct({ start: Schema.Finite, end: Schema.Finite }),
    }),
  ),
});
type Metadata = typeof Metadata.Type;
const Chart = Schema.Struct({
  meta: Metadata,
  timestamp: Schema.optionalKey(
    Schema.Array(Schema.Finite.check(Schema.isInt())),
  ),
  indicators: Schema.Struct({
    quote: Schema.Array(
      Schema.Union([
        Quote,
        Schema.Struct({}).annotate({
          parseOptions: { onExcessProperty: "error" },
        }),
      ]),
    ).check(Schema.isLengthBetween(1, 1)),
  }),
});
const Envelope = Schema.Struct({
  chart: Schema.Struct({
    result: Schema.NullOr(Schema.Array(Chart)),
    error: Schema.NullOr(
      Schema.Struct({ code: Schema.String, description: Schema.String }),
    ),
  }),
});
type Bar = RowOf<typeof yfinanceBars>;

/** No new trade for this long during regular hours means the data may be delayed. */
const staleLimit = 60_000;

/** When the last trade last advanced, carried from poll to poll. */
export interface YahooProgress {
  readonly trade: number | undefined;
  readonly advancedAt: number;
}

/**
 * Judges one poll by progress, not age: during Yahoo's own regular trading
 * period, `regularMarketTime` must advance within {@link staleLimit}. Delayed
 * exchanges still advance, so their fixed delay is never staleness. Outside
 * regular hours, or without that metadata, nothing is expected.
 * @example const {health, progress: next} = yahooFreshness(chart.meta, now, progress);
 */
export function yahooFreshness(
  meta: Metadata | undefined,
  now: number,
  progress: YahooProgress,
): { readonly health: Monitoring.Health; readonly progress: YahooProgress } {
  const regular = meta?.currentTradingPeriod?.regular;
  const trade = meta?.regularMarketTime;
  const open =
    regular !== undefined &&
    now >= regular.start * 1000 &&
    now < regular.end * 1000;
  if (!open || trade === undefined)
    return {
      health: { state: "healthy" },
      progress: { trade, advancedAt: now },
    };
  const next = trade === progress.trade ? progress : { trade, advancedAt: now };
  return {
    health:
      now - next.advancedAt > staleLimit
        ? {
            state: "degraded",
            // Stable text: an age that changes every poll would republish on every poll.
            reason: {
              code: "stale",
              message:
                "Yahoo has reported no new trade for over a minute during trading hours; data may be delayed (estimate from trading hours).",
            },
          }
        : { state: "healthy" },
    progress: next,
  };
}

/** Parse one chart response and retain meaningful source errors, including empty history.
 * @example const chart = yield* readChart({}, 'AAPL', {interval: '1d', range: '1d'});
 */
export const readChart = Effect.fn("YFinance.readChart")(function* (
  options: YFinanceOptions,
  symbol: string,
  parameters: Record<string, string>,
) {
  const body = yield* request(
    options,
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    parameters,
  );
  const parsed = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Envelope)(body).chart,
    catch: invalidResult,
  });
  if (parsed.error) {
    return yield* Effect.fail(
      new DatasetFailure(
        parsed.error.code === "Not Found"
          ? new DatasetReasons.NotFound()
          : new DatasetReasons.Unavailable(),
        { cause: parsed.error },
      ),
    );
  }
  if (parsed.result?.length !== 1 || parsed.result[0]!.meta.symbol !== symbol) {
    return yield* Effect.fail(
      invalidResult("Yahoo Finance returned a different chart."),
    );
  }
  return parsed.result[0]!;
});

function frame(rows: readonly Bar[]): SelectResult<typeof yfinanceBars> {
  return yfinanceBars.frame.create({ labels: {}, rows });
}

const dailyTime = Effect.fn("YFinance.dailyTime")(function* (
  time: number,
  timezone: string | undefined,
) {
  if (!timezone) {
    return yield* Effect.fail(
      invalidResult("Yahoo daily bars require an exchange timezone."),
    );
  }
  return yield* Effect.try({
    try: () =>
      Temporal.Instant.fromEpochMilliseconds(time)
        .toZonedDateTimeISO(timezone)
        .startOfDay().epochMilliseconds,
    catch: invalidResult,
  });
});

/** Share historical spans within one ready Dataset; recent buckets remain source reads.
 * Create inside the Provider activation and install behind makeDataset admission.
 * @example const { select } = yield* cachedSelectBars(options);
 */
export const cachedSelectBars = Effect.fn("YFinance.cachedSelectBars")(
  function* (options: YFinanceOptions) {
    return yield* cacheHistory(
      (query: SelectQuery<typeof yfinanceBars>) => selectBars(options, query),
      {
        window: (query, now) => ({
          from: Math.max(0, now - retention(query.interval)),
          to: now - correctionOverlap(query.interval),
        }),
      },
    );
  },
);

/** Read backwards through actual chart windows until count or available history is exhausted.
 * Yahoo's intraday retention is enforced explicitly. Empty price slots without
 * volume are omitted; partially populated OHLCV fails with Dataset.IncompleteData
 * so history and polling never accept an incomplete window. No values are fabricated.
 * @example const data = yield* selectBars({}, {symbol: 'VOD.L', interval: '1m', includePrePost: false, time: {}, count: 500});
 */
export const selectBars = Effect.fn("YFinance.selectBars")(function* (
  options: YFinanceOptions,
  query: SelectQuery<typeof yfinanceBars>,
) {
  return (yield* readBars(options, query)).data;
});

/** {@link selectBars} plus the newest window's metadata, which judges freshness. */
const readBars = Effect.fn("YFinance.readBars")(function* (
  options: YFinanceOptions,
  query: SelectQuery<typeof yfinanceBars>,
) {
  let meta: Metadata | undefined;
  if (query.time.from === undefined && query.count === undefined) {
    return yield* Effect.fail(
      new DatasetFailure(
        new DatasetReasons.InvalidQuery({
          detail: "Yahoo bars require a start or count.",
        }),
      ),
    );
  }
  const now = yield* Clock.currentTimeMillis;
  const interval = intervals[query.interval];
  const available = retention(query.interval);
  const retentionStart = Math.max(0, now - available);
  if (query.time.from !== undefined && query.time.from < retentionStart) {
    return yield* Effect.fail(
      new DatasetFailure(
        // Report the next whole UTC day: the moving boundary itself is already
        // gone by the time anyone retries, and the wording shows a date.
        new DatasetReasons.OutsideRetention({
          availableFrom: Math.ceil(retentionStart / Day) * Day,
        }),
      ),
    );
  }
  let floor = Math.max(retentionStart, query.time.from ?? 0);
  const end = Math.min(query.time.to ?? now, now);
  let cursor = end;
  // Window estimates affect only request size; actual bars determine count.
  const padding = interval < Day ? interval : 0;
  // Leave room for both boundary bars and whole-second wire rounding within
  // Yahoo's seven-day limit for each one-minute request.
  const maximumWindow =
    query.interval === "1m"
      ? 7 * Day - 2 * padding - 1000
      : Math.min(available, 3650 * Day);
  const window =
    query.count === undefined
      ? maximumWindow
      : Math.min(maximumWindow, Math.max(Day, query.count * interval * 3));
  const rows = new Map<number, Bar>();
  while (
    cursor > floor &&
    (query.count === undefined || rows.size < query.count)
  ) {
    const start = Math.max(floor, cursor - window);
    // Yahoo can zero the first intraday volume and omit the last OHLCV when
    // bounds cut through buckets. Read past both edges, then filter by bar time.
    // Daily keys need the whole boundary day because source times are later.
    const sourceStart =
      query.interval === "1wk"
        ? mondayAtOrBefore(start)
        : Math.max(retentionStart, start - padding);
    const sourceEnd = Math.min(
      now,
      cursor + (query.interval === "1d" ? 2 * Day : padding),
    );
    const chart = yield* readChart(options, query.symbol, {
      interval: query.interval,
      includePrePost: String(query.includePrePost),
      period1: String(Math.floor(sourceStart / 1000)),
      period2: String(Math.ceil(sourceEnd / 1000)),
    }).pipe(
      Effect.catchIf(
        (error) =>
          error.reason._tag === "Dataset.InvalidQuery" &&
          Schema.is(Envelope)(error.cause) &&
          error.cause.chart.result === null &&
          error.cause.chart.error?.code === "Bad Request" &&
          error.cause.chart.error.description.startsWith(
            "Data doesn't exist for startDate = ",
          ),
        () => Effect.succeed(undefined),
      ),
    );
    if (!chart) {
      // An empty window does not rule out older bars.
      cursor = start;
      continue;
    }
    meta ??= chart.meta;
    if (
      chart.meta.dataGranularity !== query.interval &&
      !(query.interval === "60m" && chart.meta.dataGranularity === "1h")
    ) {
      return yield* Effect.fail(
        invalidResult("Yahoo changed the requested bar interval."),
      );
    }
    const asOf = yield* Clock.currentTimeMillis;
    const quote = chart.indicators.quote[0]!;
    const timestamps = chart.timestamp ?? [];
    if (timestamps.length > 0 && !("open" in quote)) {
      return yield* Effect.fail(
        invalidResult("Yahoo chart timestamps have no OHLCV columns."),
      );
    }
    if ("open" in quote) {
      if (
        [quote.open, quote.high, quote.low, quote.close, quote.volume].some(
          (column) => column.length !== timestamps.length,
        )
      ) {
        return yield* Effect.fail(
          invalidResult("Yahoo chart column lengths differ."),
        );
      }
      for (let i = 0; i < timestamps.length; i++) {
        let time = timestamps[i]! * 1000;
        if (i > 0 && time <= timestamps[i - 1]! * 1000) {
          return yield* Effect.fail(
            invalidResult("Yahoo chart timestamps are not ordered."),
          );
        }
        if (query.interval === "1d") {
          // History can use the open time while a single live row uses quote
          // time. Both identify the same local date; asOf is observation time.
          time = yield* dailyTime(time, chart.meta.exchangeTimezoneName);
        }
        // Yahoo may include a tail quote beyond period2; the requested range is authoritative.
        if (time < start || time >= cursor) continue;
        // Yahoo also appends the latest quote inside the preceding intraday
        // bucket, with quote-time and zero volume. It is not another OHLCV bar.
        if (
          interval < Day &&
          i === timestamps.length - 1 &&
          i > 0 &&
          time - timestamps[i - 1]! * 1000 < interval
        )
          continue;
        const open = quote.open[i]!;
        const high = quote.high[i]!;
        const low = quote.low[i]!;
        const close = quote.close[i]!;
        const volume = quote.volume[i]!;
        // Yahoo uses empty slots for periods without trades. A partly populated
        // bar is different: dropping it would silently present an older price.
        if (
          open === null &&
          high === null &&
          low === null &&
          close === null &&
          (volume === null || volume === 0)
        )
          continue;
        if (
          open === null ||
          high === null ||
          low === null ||
          close === null ||
          volume === null
        )
          return yield* Effect.fail(
            new DatasetFailure(new DatasetReasons.IncompleteData(), {
              cause: {
                symbol: query.symbol,
                interval: query.interval,
                time,
                open,
                high,
                low,
                close,
                volume,
              },
            }),
          );
        const row = { time, open, high, low, close, volume, asOf };
        if (interval > Day && i === timestamps.length - 1 && i > 0) {
          const previousTime = timestamps[i - 1]! * 1000;
          const timezone = chart.meta.exchangeTimezoneName;
          if (!timezone) {
            return yield* Effect.fail(
              invalidResult(
                "Yahoo calendar bars require an exchange timezone.",
              ),
            );
          }
          const samePeriod = yield* Effect.try({
            try: () => {
              const date = Temporal.Instant.fromEpochMilliseconds(time)
                .toZonedDateTimeISO(timezone)
                .toPlainDate();
              const previous = Temporal.Instant.fromEpochMilliseconds(
                previousTime,
              )
                .toZonedDateTimeISO(timezone)
                .toPlainDate();
              return query.interval === "1wk"
                ? previous.until(date).days < 7
                : date.year === previous.year && date.month === previous.month;
            },
            catch: invalidResult,
          });
          if (samePeriod) {
            // Yahoo appends today's OHLCV after the prior-days weekly/monthly
            // aggregate. Combine those source parts at the existing bucket.
            const previous = rows.get(previousTime);
            if (previous)
              rows.set(previousTime, {
                ...previous,
                high: Math.max(previous.high, high),
                low: Math.min(previous.low, low),
                close,
                volume: previous.volume + volume,
                asOf,
              });
            continue;
          }
        }
        rows.set(time, row);
      }
    }
    if (
      chart.meta.firstTradeDate !== undefined &&
      chart.meta.firstTradeDate !== null
    ) {
      const firstTradeTime = chart.meta.firstTradeDate * 1000;
      floor = Math.max(
        floor,
        query.interval === "1d"
          ? yield* dailyTime(firstTradeTime, chart.meta.exchangeTimezoneName)
          : firstTradeTime,
      );
    }
    cursor = start;
  }
  const sorted = [...rows.values()].sort((a, b) => a.time - b.time);
  return {
    data: frame(
      query.count === undefined ? sorted : sorted.slice(-query.count),
    ),
    meta,
  };
});

/** Acquire a sequential poller; first consumption follows the session's initial snapshot.
 * Every poll includes previous buckets and all time since the last observed bar.
 * Retirement finishes an in-flight poll and prevents subsequent polls.
 * Each successful poll reports a Monitoring check for 60 seconds (interval,
 * request timeout and slack): healthy, or degraded by {@link yahooFreshness}
 * when trades stop advancing during regular hours.
 * @example const updates = yield* streamBars({}, {symbol: 'VOD.L', interval: '1m', includePrePost: false}, retired);
 */
export const streamBars = Effect.fn("YFinance.streamBars")(function* (
  options: YFinanceOptions,
  query: StreamQuery<typeof yfinanceBars>,
  retired: Deferred.Deferred<void>,
): Effect.fn.Return<
  Stream.Stream<SelectResult<typeof yfinanceBars>, DatasetFailure>,
  DatasetFailure,
  Scope.Scope
> {
  const checker = yield* Monitoring.check(
    `Yahoo ${query.symbol} ${query.interval}`,
  );
  const opened = yield* Clock.currentTimeMillis;
  let progress: YahooProgress = { trade: undefined, advancedAt: opened };
  // ponytail: inspect two days plus two buckets for corrections; expand only if upstream repair coverage requires it.
  const overlap = correctionOverlap(query.interval);
  let start = Math.max(0, opened - overlap);
  const poll = Effect.fn("YFinance.poll")(function* () {
    const end = yield* Clock.currentTimeMillis;
    const { data, meta } = yield* readBars(options, {
      ...query,
      time: { from: start, to: end },
    });
    const freshness = yahooFreshness(
      meta,
      yield* Clock.currentTimeMillis,
      progress,
    );
    progress = freshness.progress;
    yield* checker.report(freshness.health, { validFor: "60 seconds" });
    const tail = data.get(data.numRows - 1)?.time;
    if (tail !== undefined) start = Math.max(0, tail - overlap);
    return data;
  });
  const next = Effect.fn("YFinance.nextPoll")(function* (
    first: boolean,
  ): Effect.fn.Return<
    readonly [SelectResult<typeof yfinanceBars>, boolean] | undefined,
    DatasetFailure
  > {
    if (!first) {
      yield* Effect.raceFirst(
        Effect.sleep(options.pollIntervalMs ?? 15_000),
        Deferred.await(retired),
      );
    }
    if (yield* Deferred.isDone(retired)) return undefined;
    return [yield* poll(), false];
  });
  return Stream.unfold(true, next);
});
