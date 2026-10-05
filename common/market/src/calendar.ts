// Purpose: Venue-local trading days with atomic, ordered session intervals in Unix milliseconds.

import { Schema } from "effect";
import { AtomicSessionType } from "./session";

/** One atomic half-open session interval; boundaries are never clipped to a query. */
export const TradingSession = Schema.Struct({
  type: AtomicSessionType,
  start: Schema.Int, // Unix milliseconds, inclusive
  end: Schema.Int, // Unix milliseconds, exclusive
}).check(
  Schema.makeFilter((window) => window.start < window.end, {
    message: "Invalid session interval",
  }),
);
export type TradingSession = typeof TradingSession.Type;

/** A venue-local trading day and its complete atomic sessions. */
export const TradingDay = Schema.Struct({
  // Unix milliseconds of the venue trading day's local midnight; a day label, not an open time.
  date: Schema.Int,
  sessions: Schema.Array(TradingSession),
});
export type TradingDay = typeof TradingDay.Type;
// sessions are ascending and non-overlapping; a closed day is []. A session crossing
// midnight may start before `date`. 24/7 markets are one regular session per day.
