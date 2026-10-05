// Purpose: Shared consumer calendar request and result contracts.

import { Schema } from "effect";
import { Listing, TradingDay } from "@openchart/market";

/** Calendar request */
export const CalendarRequest = Schema.Struct({
  listing: Listing, // listing to query calendar for. calendars are usually provider-agnostic.
  start: Schema.Int, // unix milliseconds, inclusive
  end: Schema.Int, // unix milliseconds, exclusive
  timezone: Schema.String.check(Schema.isMinLength(1)), // consumer's IANA view timezone, e.g. Asia/Shanghai
}).check(
  Schema.makeFilter((q) => q.start < q.end, {
    message: "start must precede end",
  }),
);
export type CalendarRequest = typeof CalendarRequest.Type;

/** Resolved venue/calendar with epoch timestamps in the requested timezone. */
export const CalendarResult = Schema.Struct({
  venue: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))), // venue parsed from the listing's source
  calendar: Schema.String.check(Schema.isMinLength(1)), // calendar actually used
  timezone: Schema.String.check(Schema.isMinLength(1)), // must equal the requested consumer timezone
  days: Schema.Array(TradingDay), // nondecreasing trading days in the requested timezone
});
export type CalendarResult = typeof CalendarResult.Type;
