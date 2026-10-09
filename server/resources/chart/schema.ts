// Purpose: Owns the chart grid's cells, market sources, display bindings, and links.

import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { Adjustment } from "@openchart/feed";
import { SessionType, type Listing } from "@openchart/market";
import { dashboardTable } from "@openchart/server/resources/dashboard/schema";
import { inArray, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Fixed grid templates, written as rows by columns; `1` is the single cell. */
export const CHART_PRESETS = [
  "1",
  "1x2",
  "1x3",
  "1x4",
  "2x1",
  "2x2",
  "2x3",
  "2x4",
  "3x1",
  "3x2",
  "3x3",
  "3x4",
  "4x1",
  "4x2",
  "4x3",
  "4x4",
] as const;

/** Canonical V1 bar resolutions retained without historical spelling aliases. */
export const CHART_RESOLUTIONS = [
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1W",
  "1M",
] as const;

/** Trading-session selection shared by a cell's market sources. */
export const CHART_SESSIONS = SessionType.literals;

/** Only the main market series determines a cell's primary listing and pane. */
export const CHART_SERIES_ROLES = ["main", "normal"] as const;

/**
 * What a market binding draws: `price` is the bar's open/high/low/close,
 * `volume` its volume column, and `volumeProfile` the volume traded at each
 * price over the visible range. Presentation maps them to market Bar columns.
 */
export const CHART_MARKET_OUTPUTS = [
  "price",
  "volume",
  "volumeProfile",
] as const;

function orderedChildChecks(
  name: string,
  table: { id: AnySQLiteColumn; position: AnySQLiteColumn },
) {
  return [
    // Drizzle Kit omits NOT NULL on SQLite text primary keys.
    check(
      `${name}_id_check`,
      sql`${table.id} IS NOT NULL AND length(${table.id}) > 0`,
    ),
    check(
      `${name}_position_check`,
      sql`typeof(${table.position}) = 'integer' AND ${table.position} >= 0`,
    ),
  ];
}

/**
 * One Resource is an entire chart grid owned by a dashboard. There may be
 * multiple grids per dashboard; its widgets never duplicate chart membership.
 * Only this table carries an envelope. All child writes share its revision.
 *
 * @see [Resource ownership](../../../docs/architecture/resource.md)
 */
export const chartTable = sqliteTable(
  "chart",
  {
    ...resourceEnvelopeColumns(),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboardTable.id, { onDelete: "cascade" }),
    preset: text("preset", { enum: CHART_PRESETS }).notNull().default("1"),
  },
  (table) => [
    ...resourceEnvelopeChecks("chart", table),
    index("chart_dashboard_index").on(table.dashboardId),
    check(
      "chart_preset_check",
      inArray(table.preset, CHART_PRESETS).inlineParams(),
    ),
  ],
);

/**
 * A V1 chart becomes one ordered cell. Resolution and session apply to all
 * its market sources, along with adjustment. The primary listing is derived from its main series'
 * market source, never copied onto the cell.
 * Viewport, focus, axes, plot styles, and pane dimensions are frontend local state.
 */
export const chartCellTable = sqliteTable(
  "chart_cell",
  {
    id: text("id").primaryKey().notNull(),
    chartId: text("chart_id")
      .notNull()
      .references(() => chartTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    resolution: text("resolution", { enum: CHART_RESOLUTIONS })
      .notNull()
      .default("1d"),
    session: text("session", { enum: CHART_SESSIONS })
      .notNull()
      .default("extended"),
    adjustment: text("adjustment", { enum: Adjustment.literals })
      .notNull()
      .default("raw"),
  },
  (table) => [
    ...orderedChildChecks("chart_cell", table),
    // @agent invariant: The preset controls visibility, never cell membership.
    // Positions may exceed its capacity; shrinking the grid preserves cells.
    unique("chart_cell_position_unique").on(table.chartId, table.position),
    // Composite link FKs prove that both endpoints belong to the same grid.
    unique("chart_cell_chart_id_unique").on(table.chartId, table.id),
    check(
      "chart_cell_resolution_check",
      inArray(table.resolution, CHART_RESOLUTIONS).inlineParams(),
    ),
    check(
      "chart_cell_session_check",
      inArray(table.session, CHART_SESSIONS).inlineParams(),
    ),
    check(
      "chart_cell_adjustment_check",
      inArray(table.adjustment, Adjustment.literals).inlineParams(),
    ),
  ],
);

/**
 * Explicit panes ordered from top to bottom within a cell, including the main
 * pane. Main is derived from the main series' paneId, independently of order.
 * Height, collapsed state, and scale configuration are frontend local state.
 */
export const chartPaneTable = sqliteTable(
  "chart_pane",
  {
    id: text("id").primaryKey().notNull(),
    cellId: text("cell_id")
      .notNull()
      .references(() => chartCellTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    ...orderedChildChecks("chart_pane", table),
    unique("chart_pane_position_unique").on(table.cellId, table.position),
    unique("chart_pane_cell_id_unique").on(table.cellId, table.id),
  ],
);

/**
 * Ordered, user-selected market inputs owned by a cell, independent of their
 * display bindings. Each inherits the cell's resolution, session, and adjustment.
 * Listing identity is scoped to its provider; neither has an application FK.
 * No market points or resolved dataset descriptors are persisted here.
 */
export const chartMarketSourceTable = sqliteTable(
  "chart_market_source",
  {
    id: text("id").primaryKey().notNull(),
    cellId: text("cell_id")
      .notNull()
      .references(() => chartCellTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    provider: text("provider").notNull(),
    listing: text("listing", { mode: "json" }).$type<Listing>().notNull(),
  },
  (table) => [
    ...orderedChildChecks("chart_market_source", table),
    unique("chart_market_source_position_unique").on(
      table.cellId,
      table.position,
    ),
    unique("chart_market_source_cell_id_unique").on(table.cellId, table.id),
    check(
      "chart_market_source_provider_check",
      sql`length(${table.provider}) > 0`,
    ),
    check(
      "chart_market_source_listing_check",
      sql`COALESCE(
        json_type(${table.listing}) = 'object'
        AND json_type(${table.listing}, '$.symbol') = 'text'
        AND json_type(${table.listing}, '$.currency') = 'text',
        0
      )`,
    ),
  ],
);

/**
 * Ordered display bindings owned by explicit panes. Exactly one source branch
 * is present: marketSourceId, indicatorId or datasetId. `output` names what the
 * binding draws from that source: a market output (price, volume or volume
 * profile), the indicator's stable output name, or a Workspace Dataset column.
 * indicatorId names an Indicator Resource by value, with no FK: the add and
 * remove macros keep bindings and Indicators paired, and the chart skips a
 * binding whose Indicator is gone. datasetId names a Workspace Dataset the same
 * way; many charts may bind one Dataset, so deleting it leaves bindings the
 * chart skips. The store maps these columns to the entity's tagged `source`
 * union; no redundant source-kind column is needed.
 * Comparisons are normal series of either kind.
 *
 * @agent invariant: Every cell has exactly one main market series. The partial
 * unique index enforces at most one; ChartEntity must enforce its existence.
 * It draws price. Its pane and listing are derived through the binding, never
 * stored twice.
 * cellId exists here to enforce main uniqueness and same-cell market sources.
 *
 * Deleting a pane removes its bindings, preserving sources and Indicators.
 * Referenced market sources cannot be deleted until their bindings are
 * removed or retargeted. Whole-cell deletion cascades through all rows.
 * Renderer styles, caches, and data points are not part of these bindings.
 */
export const chartSeriesTable = sqliteTable(
  "chart_series",
  {
    id: text("id").primaryKey().notNull(),
    cellId: text("cell_id").notNull(),
    paneId: text("pane_id").notNull(),
    position: integer("position").notNull(),
    role: text("role", { enum: CHART_SERIES_ROLES })
      .notNull()
      .default("normal"),
    marketSourceId: text("market_source_id"),
    indicatorId: text("indicator_id"),
    datasetId: text("dataset_id"),
    output: text("output").notNull(),
    // A volume profile binding's settings; NULL keeps the default.
    profileResolution: text("profile_resolution", {
      enum: CHART_RESOLUTIONS,
    }),
    profileRows: integer("profile_rows"),
  },
  (table) => [
    ...orderedChildChecks("chart_series", table),
    unique("chart_series_position_unique").on(table.paneId, table.position),
    uniqueIndex("chart_series_main_unique")
      .on(table.cellId)
      .where(sql`${table.role} = 'main'`),
    index("chart_series_market_source_index").on(
      table.cellId,
      table.marketSourceId,
    ),
    index("chart_series_indicator_index").on(table.cellId, table.indicatorId),
    foreignKey({
      name: "chart_series_pane_fk",
      columns: [table.cellId, table.paneId],
      foreignColumns: [chartPaneTable.cellId, chartPaneTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chart_series_market_source_fk",
      columns: [table.cellId, table.marketSourceId],
      foreignColumns: [
        chartMarketSourceTable.cellId,
        chartMarketSourceTable.id,
      ],
    }).onDelete("no action"),
    check(
      "chart_series_role_check",
      inArray(table.role, CHART_SERIES_ROLES).inlineParams(),
    ),
    check(
      "chart_series_profile_check",
      sql`(${table.profileResolution} IS NULL AND ${table.profileRows} IS NULL) OR (
        ${table.marketSourceId} IS NOT NULL AND ${table.output} = 'volumeProfile'
        AND (${table.profileResolution} IS NULL OR ${inArray(table.profileResolution, CHART_RESOLUTIONS).inlineParams()})
        AND (${table.profileRows} IS NULL OR ${table.profileRows} BETWEEN 1 AND 100)
      )`,
    ),
    check(
      "chart_series_source_check",
      sql`(
        ${table.marketSourceId} IS NOT NULL AND ${table.indicatorId} IS NULL
        AND ${table.datasetId} IS NULL
        AND ${inArray(table.output, CHART_MARKET_OUTPUTS).inlineParams()}
      ) OR (
        ${table.marketSourceId} IS NULL AND ${table.indicatorId} IS NOT NULL
        AND ${table.datasetId} IS NULL AND length(${table.output}) > 0
      ) OR (
        ${table.marketSourceId} IS NULL AND ${table.indicatorId} IS NULL
        AND length(${table.datasetId}) > 0 AND length(${table.output}) > 0
      )`,
    ),
    check(
      "chart_series_main_market_check",
      sql`${table.role} <> 'main' OR (
        ${table.marketSourceId} IS NOT NULL AND ${table.output} = 'price'
      )`,
    ),
  ],
);

/**
 * Directed synchronization policies between cells of one grid. Links have no
 * authored order; the store must sort them by id when assembling the entity.
 * The policy is durable; current crosshair positions and time ranges are not.
 * Deleting either endpoint removes the edge. Links share the chart revision.
 */
export const chartLinkTable = sqliteTable(
  "chart_link",
  {
    id: text("id").primaryKey().notNull(),
    chartId: text("chart_id")
      .notNull()
      .references(() => chartTable.id, { onDelete: "cascade" }),
    fromCellId: text("from_cell_id").notNull(),
    toCellId: text("to_cell_id").notNull(),
    syncListing: integer("sync_listing", { mode: "boolean" })
      .notNull()
      .default(false),
    syncCrosshair: integer("sync_crosshair", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    check(
      "chart_link_id_check",
      sql`${table.id} IS NOT NULL AND length(${table.id}) > 0`,
    ),
    unique("chart_link_endpoints_unique").on(
      table.chartId,
      table.fromCellId,
      table.toCellId,
    ),
    index("chart_link_target_index").on(table.chartId, table.toCellId),
    // @agent invariant: Endpoint existence alone is insufficient: neither end
    // may point into a different grid, even when both grids share a dashboard.
    foreignKey({
      name: "chart_link_from_cell_fk",
      columns: [table.chartId, table.fromCellId],
      foreignColumns: [chartCellTable.chartId, chartCellTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chart_link_to_cell_fk",
      columns: [table.chartId, table.toCellId],
      foreignColumns: [chartCellTable.chartId, chartCellTable.id],
    }).onDelete("cascade"),
    check(
      "chart_link_distinct_cells_check",
      sql`${table.fromCellId} <> ${table.toCellId}`,
    ),
    check("chart_link_sync_listing_check", sql`${table.syncListing} IN (0, 1)`),
    check(
      "chart_link_sync_crosshair_check",
      sql`${table.syncCrosshair} IN (0, 1)`,
    ),
  ],
);
