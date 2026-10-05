// Purpose: Persist chart Indicators: a stored Tea snapshot and explicit parameter choices, owned by a chart.
import { defineId } from "@openchart/identifier";
import { chartTable } from "@openchart/server/resources/chart/schema";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Server-assigned identity of an Indicator Resource. */
export const IndicatorId = defineId("ind", "Indicator.ID");
/** Branded identifier of an Indicator Resource. */
export type IndicatorId = typeof IndicatorId.Type;

/**
 * One chart Indicator. The snapshot plus explicit overrides define its Tea
 * program; the market stays on its chart cell. Deleting the chart deletes its
 * Indicators. cell_id has no FK because chart saves reinsert every cell, and
 * chart series name an Indicator by value, so neither side enforces the other.
 */
export const indicatorTable = sqliteTable(
  "indicator",
  {
    ...resourceEnvelopeColumns(),
    chartId: text("chart_id")
      .notNull()
      .references(() => chartTable.id, { onDelete: "cascade" }),
    cellId: text("cell_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    scriptPath: text("script_path").notNull(),
    snapshot: text("snapshot", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull(),
    parameterOverrides: text("parameter_overrides", { mode: "json" })
      .$type<Record<string, number | boolean | string>>()
      .notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("indicator", table),
    check("indicator_cell_check", sql`length(${table.cellId}) > 0`),
    check("indicator_workspace_check", sql`length(${table.workspaceId}) > 0`),
    check(
      "indicator_path_check",
      sql`length(${table.scriptPath}) > 0 AND substr(${table.scriptPath}, -4) = '.tea'`,
    ),
    check(
      "indicator_snapshot_check",
      sql`json_valid(${table.snapshot}) AND json_type(${table.snapshot}) = 'object'`,
    ),
    check(
      "indicator_overrides_check",
      sql`json_valid(${table.parameterOverrides}) AND json_type(${table.parameterOverrides}) = 'object'`,
    ),
    index("indicator_chart_index").on(table.chartId),
  ],
);
