// Purpose: Persist Workspace Dataset declarations and how each one is collected; data rows stay in the Workspace file.
import { defineId } from "@openchart/identifier";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
// Type-only: drizzle-kit loads this file without the Workspace module.
import type { DatasetCollection, DatasetColumn } from "./entity";

/** Server-assigned identity of a Workspace Dataset Resource. */
export const WorkspaceDatasetId = defineId("wsd", "WorkspaceDataset.ID");
/** Branded identifier of a Workspace Dataset Resource. */
export type WorkspaceDatasetId = typeof WorkspaceDatasetId.Type;

/**
 * One Workspace Dataset: a declaration of a timeseries file the Workspace owns.
 * The file holds the rows; this row holds how to read and collect them.
 * `approved_script_hash` is the script content a person last approved; only
 * an internal transition writes it.
 */
export const workspaceDatasetTable = sqliteTable(
  "workspace_dataset",
  {
    ...resourceEnvelopeColumns(),
    name: text("name").notNull(),
    description: text("description"),
    workspaceId: text("workspace_id").notNull(),
    path: text("path").notNull(),
    timeColumn: text("time_column").notNull(),
    columns: text("columns", { mode: "json" })
      .$type<readonly DatasetColumn[]>()
      .notNull(),
    collection: text("collection", {
      mode: "json",
    }).$type<DatasetCollection | null>(),
    approvedScriptHash: text("approved_script_hash"),
  },
  (table) => [
    ...resourceEnvelopeChecks("workspace_dataset", table),
    check("workspace_dataset_name_check", sql`length(trim(${table.name})) > 0`),
    check(
      "workspace_dataset_workspace_check",
      sql`length(${table.workspaceId}) > 0`,
    ),
    check(
      "workspace_dataset_path_check",
      sql`length(${table.path}) > 4 AND lower(substr(${table.path}, -4)) = '.csv'`,
    ),
    check(
      "workspace_dataset_time_column_check",
      sql`length(${table.timeColumn}) > 0`,
    ),
    check(
      "workspace_dataset_columns_check",
      sql`json_valid(${table.columns}) AND json_type(${table.columns}) = 'array' AND json_array_length(${table.columns}) > 0`,
    ),
    check(
      "workspace_dataset_collection_check",
      sql`${table.collection} IS NULL OR (
        json_valid(${table.collection})
        AND json_extract(${table.collection}, '$.kind') IN ('agent_prompt', 'script')
      )`,
    ),
  ],
);
