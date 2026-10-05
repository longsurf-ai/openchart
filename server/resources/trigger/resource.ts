// Purpose: Registers Triggers on the shared Resource surfaces with intrinsic CRUD only.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { TriggerEntity } from "./entity";
import { triggerStore } from "./store";

export { TriggerEntity, TriggerId } from "./entity";
export { TriggerEvent, TriggerTarget } from "./schema";

/**
 * User-authored triggers; persistence dispatches nothing.
 *
 * @example
 * ```ts
 * const triggers = yield* Transactor.run(triggerResource.transitions.listAll());
 * ```
 */
export const triggerResource = defineResource({
  name: "trigger",
  description:
    "A saved action to perform when an Alert Rule fires. It connects an event source to a desktop notification or an Agent prompt, with enabled state and message or prompt templates.",
  entity: TriggerEntity,
  store: triggerStore,
});

/** Complete Trigger returned by Resource reads and writes. */
export type Trigger = typeof triggerResource.entity.Type;
