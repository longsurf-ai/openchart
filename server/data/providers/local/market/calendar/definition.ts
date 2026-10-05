// Purpose: Calendar-by-id day rows and trading-session intervals shared by all consumers.

import { Schema } from "effect";
import { Temporal } from "@js-temporal/polyfill";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

/** Exact ISO calendar dates; impossible dates fail at the boundary. */
export const CalendarDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter(
    (value) => {
      try {
        Temporal.PlainDate.from(value);
        return true;
      } catch (cause) {
        if (cause instanceof RangeError) return false;
        throw cause;
      }
    },
    { message: "Invalid ISO date" },
  ),
);

/** Trading time categories; closed time is the gap between windows. */
export const SessionKind = Schema.Literals([
  "premarket",
  "regular",
  "postmarket",
]);

/** A complete trading interval; boundaries are not clipped to the query. */
export const SessionWindow = Schema.Struct({
  kind: SessionKind,
  start: Schema.Finite.check(Schema.isInt()),
  end: Schema.Finite.check(Schema.isInt()),
})
  .check(
    Schema.makeFilter((window) => window.start < window.end, {
      message: "Session start must precede end",
    }),
  )
  // @agent invariant: annotate after check; `.check` rebuilds the node and drops parseOptions.
  .annotate({ parseOptions: { onExcessProperty: "error" } });
/** Provider-native observation schema. */
export const calendarRow = Schema.Struct({
  date: CalendarDate,
  timezone: Schema.String.check(Schema.isMinLength(1)),
  holiday: Schema.NullOr(Schema.String),
  sessions: Schema.Array(SessionWindow).check(
    Schema.makeFilter(
      (windows) =>
        windows.every(
          (window, i) => i === 0 || windows[i - 1]!.end <= window.start,
        ),
      { message: "Sessions must be ordered and non-overlapping" },
    ),
  ),
});

/**
 * One row per exchange-local date, including closed dates. Selection includes
 * dates overlapping the time range and any day whose session overlaps it.
 * Providers resolve omitted query bounds from their stored data, failing if
 * they cannot produce a finite selection. Without count, the matching range is
 * complete. With count, the earliest matching dates are returned.
 * Listing-to-calendar resolution is outside this contract.
 *
 * @example
 * ```ts
 * import {calendar} from '@openchart/server/data/providers/local/market/calendar/definition';
 * import {Schema} from 'effect';
 * const query = Schema.decodeUnknownSync(calendar.access.select.input)( {calendar: 'NYSE', time: {from: 0}, count: 14});
 * ```
 */
export const calendar = defineDataset({
  name: "openchart.market.calendar",
  keys: Schema.Struct({
    calendar: k.eq(Schema.NonEmptyString),
    time: k.range(Schema.Finite.check(Schema.isInt())),
  }),
  schema: calendarRow,
  layout: Layout.Row,
  access: { select: true },
});
