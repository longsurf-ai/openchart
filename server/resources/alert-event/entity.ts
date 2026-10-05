// Purpose: Defines the read-only Alert Event Resource entity; every domain field is backend-authored.

import { defineId } from "@openchart/identifier";
import {
  listKey,
  serverManaged,
} from "@openchart/server/lib/resource/annotation";
import {
  envelopeFields,
  Timestamp,
} from "@openchart/server/lib/resource/envelope";
import { AlertRuleId } from "@openchart/server/resources/alert-rule/entity";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { AlertEventDetail, alertEvents } from "./schema";

/** Branded Alert Event identifier with the `ale_` prefix. */
export const AlertEventId = defineId("ale", "AlertEvent.ID");

/** Identifier of an Alert Event Resource. */
export type AlertEventId = typeof AlertEventId.Type;

const eventColumns = createSelectSchema(alertEvents, {
  ruleId: AlertRuleId,
  condition: (schema) => schema.check(Schema.isMinLength(1)),
  time: Timestamp,
  detail: AlertEventDetail,
});

/**
 * One recorded fire of an Alert Rule, with its own identity and revision.
 * The envelope's createdAt records when it was written; `time` is the fired
 * occurrence time. `(ruleId, condition, time)` may repeat. It holds source
 * facts and occurrence text, without action-rendered text, read state, or Run link. All fields are server-managed, so
 * clients have read-only queries; backend creation supplies the complete body.
 */
export const AlertEventEntity = Schema.Struct({
  ...envelopeFields(AlertEventId),
  ruleId: listKey(serverManaged(eventColumns.fields.ruleId)),
  condition: serverManaged(eventColumns.fields.condition),
  time: serverManaged(eventColumns.fields.time),
  detail: serverManaged(eventColumns.fields.detail),
});

/** Complete runtime shape of an Alert Event Resource. */
export type AlertEventEntity = typeof AlertEventEntity.Type;
