// Purpose: Owns the Alert Event Resource table, its Rule foreign key, and the stored fire detail schema.

import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { alertRules } from "@openchart/server/resources/alert-rule/schema";
import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { Schema } from "effect";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/** Source-authored occurrence text and JSON facts; actions render them at dispatch. */
export const AlertEventDetail = Schema.Struct({
  title: Schema.String,
  message: Schema.String,
  data: Schema.JsonObject,
}).annotate(strict);
/** Parsed fire detail stored on an Alert Event. */
export type AlertEventDetail = typeof AlertEventDetail.Type;

/** One recorded fire per row, addressed as its own read-only Resource. */
export const alertEvents = sqliteTable(
  "alert_event",
  {
    ...resourceEnvelopeColumns(),
    // Deleting a Rule removes its events; nothing else references them.
    ruleId: text("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    // Stable condition identifier supplied by the Alertable.
    condition: text("condition").notNull(),
    // Occurrence time in Unix epoch milliseconds.
    time: integer("time").notNull(),
    detail: text("detail_json", { mode: "json" })
      .$type<AlertEventDetail>()
      .notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("alert_event", table),
    // @agent invariant: No unique key on (rule_id, condition, time). The script
    // alone decides fire frequency; several fires inside one bar are several events.
    index("idx_alert_events_created").on(desc(table.createdAt), desc(table.id)),
    index("idx_alert_events_rule").on(table.ruleId, table.createdAt, table.id),
    check("chk_alert_events_condition", sql`length(${table.condition}) >= 1`),
    check("chk_alert_events_time", sql`${table.time} >= 0`),
    check(
      "chk_alert_events_detail_object",
      sql`json_type(${table.detail}) = 'object'`,
    ),
  ],
);
