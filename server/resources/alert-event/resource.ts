// Purpose: Registers Alert Events as a read-only Resource; the backend writes them with the intrinsic create.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { AlertEventEntity } from "./entity";
import { alertEventStore } from "./store";

export { AlertEventEntity, AlertEventId } from "./entity";
export { AlertEventDetail } from "./schema";

/**
 * Backend-authored fire history. Public queries expose events;
 * `recordAlertFire` inserts through the internal intrinsic create.
 *
 * @example
 * ```ts
 * const page = yield* Transactor.run(
 *   alertEventResource.transitions.list({filter: {ruleId}, limit: 20}),
 * );
 * ```
 */
export const alertEventResource = defineResource({
  name: "alert_event",
  description:
    "A record of an Alert Rule firing, containing its rule ID, condition, occurrence time, and source-provided title, message, and data.",
  readOnly: true,
  entity: AlertEventEntity,
  store: alertEventStore,
});

/** Complete Alert Event returned by Resource reads. */
export type AlertEvent = typeof alertEventResource.entity.Type;
