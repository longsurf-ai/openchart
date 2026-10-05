// Purpose: Defines secret-free Integration registry and credential invalidations.

import { EventDefinition } from "@openchart/server/events";

const Updated = EventDefinition.define({
  type: "integration.updated",
  schema: {},
});

/** Live invalidations published after credential writes; payloads never contain secrets. */
export const Event = {
  Updated,
  Definitions: EventDefinition.inventory(Updated),
};
