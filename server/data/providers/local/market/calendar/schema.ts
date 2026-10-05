// Purpose: Owns the SQLite storage schema for the local calendar dataset.

import { inArray, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/** Named calendars with an optional parent schedule, preserving hosted IDs. */
export const tradingCalendars = sqliteTable(
  "trading_calendars",
  {
    calendarId: integer("calendar_id").primaryKey(),
    sourceCalendarId: integer("source_calendar_id").references(
      (): AnySQLiteColumn => tradingCalendars.calendarId,
    ),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [unique("uq_trading_calendars_name").on(table.name)],
);

/** Weekly source sessions; day zero is Monday and times are calendar-local. */
export const tradingSessionRules = sqliteTable(
  "trading_session_rules",
  {
    calendarId: integer("calendar_id")
      .notNull()
      .references(() => tradingCalendars.calendarId),
    sessionType: text("session_type", {
      enum: ["regular", "pre", "post", "early_close", "late_open"],
    }).notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    openTime: text("open_time").notNull(),
    closeTime: text("close_time").notNull(),
    // Keep the stored integer visible to boundary parsing: boolean decoding
    // would silently turn a corrupt value such as 2 into false.
    crossesMidnight: integer("crosses_midnight").default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.calendarId, table.sessionType, table.dayOfWeek],
    }),
    check(
      "chk_trading_session_rules_session_type",
      inArray(table.sessionType, table.sessionType.enumValues).inlineParams(),
    ),
    check(
      "chk_trading_session_rules_weekday",
      sql`${table.dayOfWeek} BETWEEN 0 AND 6`,
    ),
    check(
      "chk_trading_session_rules_overnight",
      sql`${table.crossesMidnight} IN (0, 1)`,
    ),
  ],
);

/** One date-specific closure, changed-hours rule, or annotation per calendar. */
export const tradingCalendarOverrides = sqliteTable(
  "trading_calendar_overrides",
  {
    calendarId: integer("calendar_id")
      .notNull()
      .references(() => tradingCalendars.calendarId),
    date: text("date").notNull(),
    overrideType: text("override_type", {
      enum: ["closed", "early_close", "late_open", "special"],
    }).notNull(),
    name: text("name"),
    openTime: text("open_time"),
    closeTime: text("close_time"),
  },
  (table) => [
    primaryKey({ columns: [table.calendarId, table.date] }),
    check(
      "chk_trading_calendar_overrides_type",
      inArray(table.overrideType, table.overrideType.enumValues).inlineParams(),
    ),
  ],
);
