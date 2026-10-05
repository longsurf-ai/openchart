// Purpose: Derives the Trigger Resource entity from its table and stored event and target unions.

import { defineId } from "@openchart/identifier";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Effect, Schema } from "effect";

import { TriggerEvent, TriggerTarget, triggers } from "./schema";

/** Branded Trigger identifier with the `trg_` prefix. */
export const TriggerId = defineId("trg", "Trigger.ID");

/** Identifier of a Trigger Resource. */
export type TriggerId = typeof TriggerId.Type;

const triggerColumns = createSelectSchema(triggers, {
  name: (schema) =>
    schema.check(
      Schema.makeFilter(
        (name) => {
          const length = name.trim().length;
          return length >= 1 && length <= 160;
        },
        {
          message:
            "Trigger name must contain 1 to 160 characters after trimming",
        },
      ),
    ),
  event: TriggerEvent,
  target: TriggerTarget,
});

/**
 * Complete Trigger with its independent Resource envelope. Every domain field
 * is authored: `event` selects what to react to; `target` holds its action
 * and message or prompt, rendered at dispatch. Both unions are strict:
 * an unknown `kind` or an extra property fails create and patch. Storing a
 * Trigger dispatches nothing and keeps no execution history.
 */
export const TriggerEntity = Schema.Struct({
  ...envelopeFields(TriggerId),
  name: triggerColumns.fields.name,
  enabled: triggerColumns.fields.enabled.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(
        Schema.decodeUnknownSync(triggerColumns.fields.enabled)(
          triggers.enabled.default,
        ),
      ),
    ),
  ),
  event: triggerColumns.fields.event,
  target: triggerColumns.fields.target,
});

/** Complete runtime shape of a Trigger Resource. */
export type TriggerEntity = typeof TriggerEntity.Type;
