// Purpose: Keep historical migration fixtures independent of newer Session columns.
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SessionAnchor } from "@openchart/server/agent/contracts/session-anchor";

const now = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

/** The Session columns used before read positions existed; migrations own actual DDL.
 * @example yield* db.select().from(sessionsBeforeReadPosition);
 */
export const sessionsBeforeReadPosition = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  kind: text("kind", {
    enum: ["chat", "delegate", "dig_in", "alert", "scheduled", "chart_explain"],
  }).notNull(),
  bindingId: text("binding_id"),
  anchors: text("anchors", { mode: "json" }).$type<SessionAnchor[]>(),
  title: text("title").notNull(),
  compactingAt: integer("compacting_at"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});
