// Purpose: Owns the Trigger Resource table and its stored event and target unions.

import { AgentPromptTarget } from "@openchart/server/agent/contracts/agent-prompt-target";
import { notificationSoundIds } from "@openchart/notification";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Schema } from "effect";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/**
 * Event sources a Trigger can match; a new source adds one `kind` variant.
 * `ruleId` is a plain reference to an Alert Rule: it may name a deleted rule.
 */
export const TriggerEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("alert"),
    ruleId: Schema.String.check(Schema.isMinLength(1)),
  }).annotate(strict),
]);
/** Parsed event descriptor stored on a Trigger. */
export type TriggerEvent = typeof TriggerEvent.Type;

/** Actions a Trigger can take; a new action adds one `kind` variant. */
export const TriggerTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("notification"),
    message: Schema.String.check(Schema.isMinLength(1)),
    // Omission follows the current profile preference; "none" is explicitly silent.
    sound: Schema.optional(Schema.Literals(notificationSoundIds)),
  }).annotate(strict),
  AgentPromptTarget,
]);
/** Parsed action stored on a Trigger. */
export type TriggerTarget = typeof TriggerTarget.Type;

/** User-authored "when this event happens, do that" definitions. */
export const triggers = sqliteTable(
  "trigger",
  {
    ...resourceEnvelopeColumns(),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // @agent invariant: No foreign key to the event source. Alert knows nothing
    // about Triggers; the Trigger service removes Triggers whose rule is gone.
    event: text("event_json", { mode: "json" }).$type<TriggerEvent>().notNull(),
    target: text("target_json", { mode: "json" })
      .$type<TriggerTarget>()
      .notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("trigger", table),
    check(
      "chk_triggers_name",
      sql`length(trim(${table.name})) BETWEEN 1 AND 160`,
    ),
    check(
      "chk_triggers_event_object",
      sql`json_type(${table.event}) = 'object'`,
    ),
    check(
      "chk_triggers_target_object",
      sql`json_type(${table.target}) = 'object'`,
    ),
  ],
);
