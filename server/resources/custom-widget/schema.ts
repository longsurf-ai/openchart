// Purpose: Persist saved custom widgets: a checked `.widget.tsx` snapshot and where it came from.
import { defineId } from "@openchart/identifier";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import { check, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/** Server-assigned identity of a Custom Widget Resource. */
export const CustomWidgetId = defineId("cwg", "CustomWidget.ID");
/** Branded identifier of a Custom Widget Resource. */
export type CustomWidgetId = typeof CustomWidgetId.Type;

/**
 * One saved custom widget. `kind` is declared in its source and unique, so
 * Dashboards place it as `custom:<kind>`. The snapshot is the only code that
 * runs; the Workspace file it came from has no FK and may change or vanish.
 */
export const customWidgetTable = sqliteTable(
  "custom_widget",
  {
    ...resourceEnvelopeColumns(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    workspaceId: text("workspace_id").notNull(),
    path: text("path").notNull(),
    snapshot: text("snapshot").notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("custom_widget", table),
    unique("custom_widget_kind_unique").on(table.kind),
    check(
      "custom_widget_kind_check",
      sql`length(${table.kind}) BETWEEN 1 AND 64 AND ${table.kind} GLOB '[a-z]*' AND ${table.kind} NOT GLOB '*[^a-z0-9-]*'`,
    ),
    check(
      "custom_widget_title_check",
      sql`length(trim(${table.title})) > 0 AND length(${table.title}) <= 80`,
    ),
    check(
      "custom_widget_workspace_check",
      sql`length(${table.workspaceId}) > 0`,
    ),
    check(
      "custom_widget_path_check",
      sql`substr(${table.path}, -11) = '.widget.tsx'`,
    ),
  ],
);
