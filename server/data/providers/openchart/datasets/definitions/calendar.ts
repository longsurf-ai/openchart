// Purpose: Declare the venue trading days of an OpenChart listing.

import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";
import { calendarRow } from "@openchart/server/data/providers/local/market/calendar/definition";

/**
 * The local calendar's day rows, addressed by OpenChart listing instead of
 * calendar name and labelled with the calendar Cloud assigned to its venue.
 * One row per venue date, including closed dates; the same selection rules apply.
 * @example openchartCalendar.access.select.input;
 */
export const openchartCalendar = defineDataset({
  name: "openchart.calendar",
  keys: Schema.Struct({
    listing: k.eq(Schema.Int.check(Schema.isGreaterThan(0))),
    time: k.range(Schema.Finite.check(Schema.isInt())),
  }),
  schema: Schema.Struct({
    calendar: Schema.NonEmptyString,
    ...calendarRow.fields,
  }),
  layout: Layout.Row,
  access: { select: true },
});
