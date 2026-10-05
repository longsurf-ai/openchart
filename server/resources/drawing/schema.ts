// Purpose: Persist independent drawings owned by a dashboard and a provider-scoped listing.
import type { Drawing } from "@openchart/chart-core/drawing/types";
import { defineId } from "@openchart/identifier";
import type { Listing } from "@openchart/market";
import { dashboardTable } from "@openchart/server/resources/dashboard/schema";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Server-managed identity; data.id preserves the core's client-minted gesture identity. */
export const DrawingId = defineId("drw", "Drawing.ID");
/** Branded identifier of the saved Drawing Resource. */
export type DrawingId = typeof DrawingId.Type;

/** Completed drawing geometry; drafts and renderer interaction state are never stored. */
export const drawingTable = sqliteTable(
  "drawing",
  {
    ...resourceEnvelopeColumns(),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboardTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    listing: text("listing", { mode: "json" }).$type<Listing>().notNull(),
    data: text("data", { mode: "json" }).$type<Drawing.Item>().notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("drawing", table),
    check("drawing_provider_check", sql`length(${table.provider}) > 0`),
    check("drawing_listing_check", sql`json_valid(${table.listing})`),
    check("drawing_data_check", sql`json_valid(${table.data})`),
    uniqueIndex("drawing_scope_gesture_unique").on(
      table.dashboardId,
      table.provider,
      sql`json_array(json_extract(${table.listing}, '$.symbol'), json_extract(${table.listing}, '$.venue'), json_extract(${table.listing}, '$.currency'))`,
      sql`json_extract(${table.data}, '$.id')`,
    ),
    index("drawing_dashboard_provider_index").on(
      table.dashboardId,
      table.provider,
    ),
  ],
);
