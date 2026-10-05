// Purpose: Owns the dashboard tables, columns, constraints, and widget ordering.

import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/** Minimum persisted dashboard name length. */
export const DASHBOARD_NAME_MIN_LENGTH = 1;

/** Maximum persisted dashboard name length. */
export const DASHBOARD_NAME_MAX_LENGTH = 200;

/** The canonical dashboard grid width; responsive views do not change it. */
export const DASHBOARD_COLUMNS = 12;

/** Dashboard metadata and its server-managed revision and timestamps. */
export const dashboardTable = sqliteTable(
  "dashboard",
  {
    ...resourceEnvelopeColumns(),
    name: text("name").notNull(),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    ...resourceEnvelopeChecks("dashboard", table),
    check(
      "dashboard_name_check",
      sql`length(${table.name}) BETWEEN ${DASHBOARD_NAME_MIN_LENGTH} AND ${DASHBOARD_NAME_MAX_LENGTH}`.inlineParams(),
    ),
    check("dashboard_favorite_check", sql`${table.favorite} IN (0, 1)`),
  ],
);

/**
 * Ordered widget placements owned by a dashboard, sharing its revision.
 * `resourceId` is a reference only; the placement does not own its target.
 */
export const dashboardWidgetTable = sqliteTable(
  "dashboard_widget",
  {
    id: text("id").primaryKey().notNull(),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboardTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    resourceId: text("resource_id"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    w: integer("w").notNull(),
    h: integer("h").notNull(),
  },
  (table) => [
    check("dashboard_widget_id_check", sql`${table.id} IS NOT NULL`),
    // @agent invariant: Each dashboard position holds at most one placement.
    unique("dashboard_widget_position_unique").on(
      table.dashboardId,
      table.position,
    ),
    check("dashboard_widget_position_check", sql`${table.position} >= 0`),
    check("dashboard_widget_kind_check", sql`length(${table.kind}) > 0`),
    check(
      "dashboard_widget_resource_id_check",
      sql`${table.resourceId} IS NULL OR length(${table.resourceId}) > 0`,
    ),
    check(
      "dashboard_widget_x_check",
      sql`typeof(${table.x}) = 'integer' AND ${table.x} >= 0`,
    ),
    check(
      "dashboard_widget_y_check",
      sql`typeof(${table.y}) = 'integer' AND ${table.y} >= 0`,
    ),
    check(
      "dashboard_widget_w_check",
      sql`typeof(${table.w}) = 'integer' AND ${table.w} >= 1`,
    ),
    check(
      "dashboard_widget_h_check",
      sql`typeof(${table.h}) = 'integer' AND ${table.h} >= 1`,
    ),
    check(
      "dashboard_widget_width_check",
      sql`${table.x} + ${table.w} <= ${DASHBOARD_COLUMNS}`.inlineParams(),
    ),
  ],
);
