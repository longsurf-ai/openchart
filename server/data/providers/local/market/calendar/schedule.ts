// Purpose: Expand parsed calendar rules into complete day rows using timezone-aware date arithmetic.

import { Temporal } from "@js-temporal/polyfill";
import {
  DatasetFailure,
  DatasetReasons,
  type RowOf,
  type SelectQuery,
} from "@openchart/server/data/dataset";
import { calendar } from "@openchart/server/data/providers/local";

import type { CalendarData } from "./data";

type Day = RowOf<typeof calendar>;
type Rule = CalendarData["rules"][number];
type Override = CalendarData["overrides"][number];
type Schedule = {
  timezone: string;
  rules: Map<string, Rule>;
  overrides: Map<string, Override>;
};

/** Resolves inheritance using source keys; no market-specific calendar classes. */
function resolve(
  data: CalendarData,
  id: number,
  seen = new Set<number>(),
): Schedule {
  const row = data.calendars.find((row) => row.calendarId === id);
  if (!row || seen.has(id))
    throw new DatasetFailure(new DatasetReasons.InvalidResult(), {
      cause: "Calendar inheritance is missing a parent or contains a cycle",
    });
  seen.add(id);
  const parent =
    row.sourceCalendarId === null
      ? undefined
      : resolve(data, row.sourceCalendarId, seen);
  const rules = new Map(parent?.rules);
  const overrides = new Map(parent?.overrides);
  for (const rule of data.rules) {
    if (rule.calendarId === id)
      rules.set(`${rule.dayOfWeek}:${rule.sessionType}`, rule);
  }
  for (const override of data.overrides) {
    if (override.calendarId === id) overrides.set(override.date, override);
  }
  if (rules.size === 0)
    throw new DatasetFailure(new DatasetReasons.InvalidResult(), {
      cause: "Calendar has no weekly session rules",
    });
  return { timezone: row.timezone, rules, overrides };
}

/** Converts a source local clock time without guessing through DST ambiguity. */
function instant(
  date: Temporal.PlainDate,
  clock: string,
  timezone: string,
): number {
  return date
    .toPlainDateTime(Temporal.PlainTime.from(clock))
    .toZonedDateTime(timezone, { disambiguation: "reject" }).epochMilliseconds;
}

/** Produces the actual source schedule for one local rule date. */
function day(schedule: Schedule, date: Temporal.PlainDate): Day {
  const label = date.toString();
  const override = schedule.overrides.get(label);
  const sessions: Day["sessions"][number][] = [];
  const result: Day = {
    date: label,
    timezone: schedule.timezone,
    holiday: override?.name ?? null,
    sessions,
  };
  if (override?.overrideType === "closed") return result;
  const rules = [...schedule.rules.values()].filter(
    (rule) => rule.dayOfWeek === date.dayOfWeek - 1,
  );
  const regular = rules.find((rule) => rule.sessionType === "regular");
  for (const rule of rules) {
    let open = rule.openTime;
    let close = rule.closeTime;
    if (override?.overrideType === "early_close") {
      if (rule.sessionType === "regular") close = override.closeTime;
      if (
        rule.sessionType === "post" &&
        regular &&
        Temporal.PlainTime.compare(open, regular.closeTime) === 0
      )
        open = override.closeTime;
    }
    if (override?.overrideType === "late_open") {
      if (rule.sessionType === "regular") open = override.openTime;
      if (
        rule.sessionType === "pre" &&
        regular &&
        Temporal.PlainTime.compare(close, regular.openTime) === 0
      )
        close = override.openTime;
    }
    const start = instant(date, open, schedule.timezone);
    const end = instant(
      rule.crossesMidnight ? date.add({ days: 1 }) : date,
      close,
      schedule.timezone,
    );
    if (start >= end)
      throw new DatasetFailure(new DatasetReasons.InvalidResult(), {
        cause: `Invalid session interval on ${label}`,
      });
    sessions.push({
      kind:
        rule.sessionType === "pre"
          ? "premarket"
          : rule.sessionType === "post"
            ? "postmarket"
            : "regular",
      start,
      end,
    });
  }
  sessions.sort((left, right) => left.start - right.start);
  return result;
}

/**
 * Selects complete matching calendar days, optionally capped by count.
 * Stored weekly rules recur without date bounds; exceptions apply on their dates.
 * Selection needs a start and either an end or count to produce a finite result.
 * Adjacent source days are expanded to retain overlapping sessions.
 * @example
 * const rows = selectDays(data, {
 *   calendar: 'NYSE', time: {from: Date.UTC(2026, 10, 26)}, count: 3,
 * });
 */
export function selectDays(
  data: CalendarData,
  query: SelectQuery<typeof calendar>,
): Day[] {
  const record = data.calendars.find((row) => row.name === query.calendar);
  if (!record)
    throw new DatasetFailure(new DatasetReasons.NotFound(), {
      cause: `Calendar "${query.calendar}" was not found`,
    });
  const schedule = resolve(data, record.calendarId);
  // @agent invariant: available dates come from the stored data. Weekly rules
  // have no validity interval; holiday extrema cannot supply missing bounds.
  const from = query.time.from;
  const to = query.time.to ?? Infinity;
  if (from === undefined || (to === Infinity && query.count === undefined)) {
    throw new DatasetFailure(
      new DatasetReasons.InvalidQuery({
        detail:
          "Recurring calendar rules require time.from and either time.to or count",
      }),
    );
  }
  if (from > to)
    throw new DatasetFailure(
      new DatasetReasons.InvalidQuery({
        detail: "Calendar range start must not follow its end",
      }),
    );
  if (from === to) return [];
  const first = Temporal.Instant.fromEpochMilliseconds(from)
    .toZonedDateTimeISO(schedule.timezone)
    .toPlainDate()
    .subtract({ days: 1 });
  const last =
    to === Infinity
      ? undefined
      : Temporal.Instant.fromEpochMilliseconds(to - 1)
          .toZonedDateTimeISO(schedule.timezone)
          .toPlainDate()
          .add({ days: 1 });
  const rows: Day[] = [];
  let previousEnd = -Infinity;
  for (
    let date = first;
    last === undefined || Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const row = day(schedule, date);
    for (const session of row.sessions) {
      if (session.start < previousEnd)
        throw new DatasetFailure(new DatasetReasons.InvalidResult(), {
          cause: "Calendar sessions overlap within or between dates",
        });
      previousEnd = session.end;
    }
    const start = date.toZonedDateTime(schedule.timezone).epochMilliseconds;
    const end = date
      .add({ days: 1 })
      .toZonedDateTime(schedule.timezone).epochMilliseconds;
    if (
      (start < to && end > from) ||
      row.sessions.some((session) => session.start < to && session.end > from)
    )
      rows.push(row);
    if (query.count !== undefined && rows.length === query.count) break;
  }
  return rows;
}
