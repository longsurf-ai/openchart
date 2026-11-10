// Purpose: Build Yahoo trading days from the pre, regular and post periods of its hourly chart.

import { Temporal } from "@js-temporal/polyfill";
import { Cache, Clock, Effect, Exit } from "effect";
import type { AtomicSessionType } from "@openchart/market";
import {
  DatasetFailure,
  DatasetReasons,
  type RowOf,
  type SelectQuery,
} from "@openchart/server/data/dataset";
import type { yfinanceCalendar } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { readChart } from "@openchart/server/data/providers/yfinance/datasets/bars";
import { invalidResult } from "@openchart/server/data/providers/yfinance/errors";
import type { YFinanceOptions } from "@openchart/server/data/providers/yfinance/client";

const Hour = 3_600_000;
const Day = 24 * Hour;
/** Yahoo keeps hourly bars, and so their trading periods, for about two years. */
const hourlyRetention = 729 * Day;

type Row = RowOf<typeof yfinanceCalendar>;
type Session = Row["sessions"][number];
type Periods = Readonly<
  Partial<Record<AtomicSessionType, readonly number[][]>>
>;

/** Yahoo's periods for one read: the exchange timezone and sessions in milliseconds. */
interface Schedule {
  readonly timezone: string;
  readonly sessions: readonly Session[];
}

/** Read one hourly chart and collect its per-day and current trading periods.
 * Duplicates (the current day appears in both) are kept once.
 */
const readSchedule = Effect.fn("YFinance.readSchedule")(function* (
  options: YFinanceOptions,
  symbol: string,
  period1: number,
  period2: number,
) {
  const chart = yield* readChart(options, symbol, {
    interval: "60m",
    includePrePost: "true",
    period1: String(Math.floor(period1 / 1000)),
    period2: String(Math.ceil(period2 / 1000)),
  });
  const {
    exchangeTimezoneName: timezone,
    tradingPeriods,
    currentTradingPeriod,
  } = chart.meta;
  if (!timezone)
    return yield* Effect.fail(
      invalidResult("Yahoo trading periods require an exchange timezone."),
    );
  const periods: Periods =
    tradingPeriods === undefined
      ? {}
      : "regular" in tradingPeriods
        ? {
            pre: flatten(tradingPeriods.pre),
            regular: flatten(tradingPeriods.regular),
            post: flatten(tradingPeriods.post),
          }
        : { regular: flatten(tradingPeriods) };
  const seen = new Set<string>();
  const sessions: Session[] = [];
  const add = (type: AtomicSessionType, start: number, end: number) => {
    const key = `${type}:${start}`;
    if (end <= start || seen.has(key)) return;
    seen.add(key);
    sessions.push({ type, start: start * 1000, end: end * 1000 });
  };
  for (const [type, list] of Object.entries(periods))
    for (const [start, end] of list ?? [])
      add(type as AtomicSessionType, start!, end!);
  for (const type of ["pre", "regular", "post"] as const) {
    const period = currentTradingPeriod?.[type];
    if (period) add(type, period.start, period.end);
  }
  sessions.sort((left, right) => left.start - right.start);
  return { timezone, sessions } satisfies Schedule;
});

function flatten(
  days: readonly (readonly { start: number; end: number }[])[],
): number[][] {
  return days.flat().map(({ start, end }) => [start, end]);
}

/**
 * Group sessions by the exchange-local date they start on, then emit every date
 * from the first through the last date with a session; dates in between
 * without one are closed. Only dates overlapping `[from, to)` are returned.
 * @example toRows(schedule, Date.UTC(2026, 10, 9), Date.UTC(2026, 10, 11));
 */
export function toRows(schedule: Schedule, from: number, to: number): Row[] {
  const { timezone, sessions } = schedule;
  if (!sessions.length) return [];
  const dateOf = (time: number) =>
    Temporal.Instant.fromEpochMilliseconds(time)
      .toZonedDateTimeISO(timezone)
      .toPlainDate();
  const byDate = new Map<string, Session[]>();
  for (const session of sessions) {
    const date = dateOf(session.start).toString();
    byDate.set(date, [...(byDate.get(date) ?? []), session]);
  }
  const rows: Row[] = [];
  const last = dateOf(sessions.at(-1)!.start);
  for (
    let date = dateOf(sessions[0]!.start);
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const daySessions = byDate.get(date.toString()) ?? [];
    const start = date.toZonedDateTime(timezone).epochMilliseconds;
    const end = date
      .add({ days: 1 })
      .toZonedDateTime(timezone).epochMilliseconds;
    const overlaps =
      (start < to && end > from) ||
      daySessions.some((session) => session.start < to && session.end > from);
    if (overlaps)
      rows.push({
        date: date.toString(),
        timezone,
        holiday: null,
        sessions: daySessions,
      });
  }
  return rows;
}

/** Select a symbol's trading days, reading each hourly window at most once an
 * hour per Provider activation; failed reads are not kept. Requires both time
 * bounds. Windows older than Yahoo's hourly retention return fewer dates.
 * Create inside the Provider activation.
 * @example const select = yield* cachedSelectCalendar(options);
 */
export const cachedSelectCalendar = Effect.fn("YFinance.cachedSelectCalendar")(
  function* (options: YFinanceOptions) {
    const schedules = yield* Cache.makeWith(
      (key: string) => {
        const [symbol, period1, period2] = JSON.parse(key) as [
          string,
          number,
          number,
        ];
        return readSchedule(options, symbol, period1, period2);
      },
      {
        capacity: 256,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 hour" : 0),
      },
    );
    return (query: SelectQuery<typeof yfinanceCalendar>) =>
      Effect.gen(function* () {
        const { from, to } = query.time;
        if (from === undefined || to === undefined)
          return yield* Effect.fail(
            new DatasetFailure(
              new DatasetReasons.InvalidQuery({
                detail: "Yahoo calendars require a start and an end.",
              }),
            ),
          );
        const now = yield* Clock.currentTimeMillis;
        // Whole days and hours keep cache keys stable for a while; the day
        // before the window covers sessions that start there and run into it.
        const period2 = Math.ceil(now / Hour) * Hour;
        const period1 =
          Math.floor(
            Math.max(
              now - hourlyRetention,
              Math.min(from, now - 7 * Day) - Day,
            ) / Day,
          ) * Day;
        const schedule = yield* Cache.get(
          schedules,
          JSON.stringify([query.symbol, period1, period2]),
        );
        return yield* Effect.try({
          try: () => {
            const rows = toRows(schedule, from, to);
            return query.count === undefined
              ? rows
              : rows.slice(0, query.count);
          },
          catch: invalidResult,
        });
      });
  },
);
