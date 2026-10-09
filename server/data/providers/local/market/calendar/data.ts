// Purpose: Reads and parses local calendar rows through their owning Drizzle schema.

import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { CalendarDate } from "@openchart/server/data/providers/local/market/calendar/definition";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema, SchemaGetter } from "effect";

import {
  tradingCalendars,
  tradingSessionRules,
  tradingCalendarOverrides,
} from "./schema";

const Id = Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0));
const Clock = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
);
const Calendar = createSelectSchema(tradingCalendars, {
  calendarId: Id,
  sourceCalendarId: Schema.NullOr(Id),
  name: Schema.String.check(Schema.isMinLength(1)),
  timezone: Schema.String.check(Schema.isMinLength(1)),
});
const Rule = createSelectSchema(tradingSessionRules, {
  calendarId: Id,
  sessionType: Schema.Literals(["pre", "regular", "post", "overnight"]),
  dayOfWeek: Schema.Finite.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(0))
    .check(Schema.isLessThanOrEqualTo(6)),
  openTime: Clock,
  closeTime: Clock,
  crossesMidnight: Schema.NullOr(Schema.Literals([0, 1])).pipe(
    Schema.decodeTo(Schema.Boolean, {
      decode: SchemaGetter.transform((value) => value === 1),
      encode: SchemaGetter.transform((value) => (value ? 1 : 0)),
    }),
  ),
});
const OverrideRow = createSelectSchema(tradingCalendarOverrides, {
  calendarId: Id,
  date: CalendarDate,
  openTime: Schema.NullOr(Clock),
  closeTime: Schema.NullOr(Clock),
});
const Override = Schema.Union([
  Schema.Struct({
    ...OverrideRow.fields,
    ...{ overrideType: Schema.Literal("closed") },
  }),
  Schema.Struct({
    ...OverrideRow.fields,
    ...{
      overrideType: Schema.Literal("early_close"),
      closeTime: Clock,
    },
  }),
  Schema.Struct({
    ...OverrideRow.fields,
    ...{ overrideType: Schema.Literal("late_open"), openTime: Clock },
  }),
]);
// @agent invariant: downloaded calendar rows are untrusted even when their
// shape matches; existing snapshots may not enforce the declared constraints.
const references = Schema.makeFilter(
  (data: {
    calendars: readonly {
      calendarId: number;
      sourceCalendarId: number | null;
      name: string;
    }[];
    rules: readonly {
      calendarId: number;
      sessionType: string;
      dayOfWeek: number;
    }[];
    overrides: readonly { calendarId: number; date: string }[];
  }) => {
    const ids = new Set(data.calendars.map((row) => row.calendarId));
    if (
      ids.size !== data.calendars.length ||
      new Set(data.calendars.map((row) => row.name)).size !==
        data.calendars.length
    )
      return "Calendar IDs and names must be unique";
    if (
      data.calendars.some(
        (row) =>
          row.sourceCalendarId !== null && !ids.has(row.sourceCalendarId),
      ) ||
      [...data.rules, ...data.overrides].some((row) => !ids.has(row.calendarId))
    )
      return "Calendar data references a missing calendar";
    // Mirror the tables' primary keys: a duplicate must fail, not let the last row win.
    const unique = (keys: readonly string[]) =>
      new Set(keys).size === keys.length;
    if (
      !unique(
        data.rules.map(
          (row) => `${row.calendarId}:${row.sessionType}:${row.dayOfWeek}`,
        ),
      ) ||
      !unique(data.overrides.map((row) => `${row.calendarId}:${row.date}`))
    )
      return "Calendar rules and overrides must be unique per key";
    return true;
  },
);
const Source = Schema.Struct({
  calendars: Schema.Array(Calendar).check(Schema.isMinLength(1)),
  rules: Schema.Array(Rule),
  overrides: Schema.Array(Override),
}).check(references);

/**
 * Hosted calendar rows as JSON, as OpenChart Cloud serves them: the same rows
 * the local tables store, with a boolean `crossesMidnight`.
 * @example Schema.decodeUnknownEffect(CalendarRows)(body);
 */
export const CalendarRows = Schema.Struct({
  calendars: Schema.Array(
    Schema.Struct({
      calendarId: Calendar.fields.calendarId,
      sourceCalendarId: Calendar.fields.sourceCalendarId,
      name: Calendar.fields.name,
      timezone: Calendar.fields.timezone,
    }),
  ).check(Schema.isMinLength(1)),
  rules: Schema.Array(
    Schema.Struct({ ...Rule.fields, crossesMidnight: Schema.Boolean }),
  ),
  overrides: Schema.Array(Override),
}).check(references);

/** Parsed calendar rows from either source; the schedule expander reads only these. */
export type CalendarData = typeof CalendarRows.Type;

/**
 * Reads the three calendar tables in one transaction and parses source values
 * before returning them to the schedule expander. The caller owns the connection.
 * @throws DatasetFailure when the local calendar data cannot be read or is invalid.
 * @example
 * const data = readCalendarData(database);
 */
export function readCalendarData(database: NodeSQLiteDatabase): CalendarData {
  try {
    return database.transaction((tx) =>
      Schema.decodeUnknownSync(Source)({
        calendars: tx.select().from(tradingCalendars).all(),
        rules: tx.select().from(tradingSessionRules).all(),
        overrides: tx.select().from(tradingCalendarOverrides).all(),
      }),
    );
  } catch (cause) {
    throw new DatasetFailure(new DatasetReasons.InvalidResult(), { cause });
  }
}
