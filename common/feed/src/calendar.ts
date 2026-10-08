// Purpose: Shared consumer calendar request and result contracts.

import { Schema } from "effect";
import { ProviderListing, TradingDay } from "@openchart/market";

/**
 * Trading days of one provider's listing that overlap `[start, end)`.
 *
 * - `provider`/`listing`: the same pair Bars uses; the provider resolves its
 *   listing's venue calendar and never falls back to another provider's.
 * - `start`/`end`: inclusive/exclusive Unix milliseconds, `start < end`.
 * - `timezone`: the consumer's IANA view zone for day labels, e.g. Asia/Shanghai.
 *
 * @example
 * const request: CalendarRequest = {
 *   provider, listing, start: Date.UTC(2026, 9, 5), end: Date.UTC(2026, 9, 10),
 *   timezone: "America/New_York",
 * };
 */
export const CalendarRequest = Schema.Struct({
  ...ProviderListing.fields,
  start: Schema.Int,
  end: Schema.Int,
  timezone: Schema.String.check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((q) => q.start < q.end, {
    message: "start must precede end",
  }),
);
export type CalendarRequest = typeof CalendarRequest.Type;

/**
 * Resolved calendar. Every venue date in the window has a day, including closed
 * dates with no sessions; a day's `date` is that venue date's midnight in the
 * requested timezone. Session bounds are instants and never clipped to the window.
 */
export const CalendarResult = Schema.Struct({
  venue: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))), // venue parsed from the listing's source
  calendar: Schema.String.check(Schema.isMinLength(1)), // calendar actually used
  timezone: Schema.String.check(Schema.isMinLength(1)), // must equal the requested consumer timezone
  days: Schema.Array(TradingDay), // nondecreasing trading days in the requested timezone
});
export type CalendarResult = typeof CalendarResult.Type;
