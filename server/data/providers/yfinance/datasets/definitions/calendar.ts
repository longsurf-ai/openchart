// Purpose: Declare a Yahoo listing's trading days from its chart trading periods.

import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";
import { calendarRow } from "@openchart/server/data/providers/local/market/calendar/definition";

/**
 * Exchange-local trading days of one Yahoo symbol, built from the pre, regular
 * and post periods Yahoo reports with its hourly chart. One row per exchange
 * date from the first date Yahoo covers through its current trading period;
 * dates without periods in between are closed. Yahoo publishes no future
 * schedule, so rows end at the current (or next) trading date.
 * @example const query = { symbol: "AAPL", time: { from: 0, to: 86_400_000 } };
 */
export const yfinanceCalendar = defineDataset({
  name: "yfinance.calendar",
  keys: Schema.Struct({
    symbol: k.eq(Schema.NonEmptyString),
    time: k.range(Schema.Finite.check(Schema.isInt())),
  }),
  schema: calendarRow,
  layout: Layout.Row,
  access: { select: true },
});
