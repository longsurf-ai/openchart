// Purpose: Define Feed notifications published through the shared application event bus.

import { FeedVersion } from "@openchart/feed";
import { EventDefinition } from "@openchart/server/events";

/** Published after the complete Feed replacement is committed; carries no credentials. */
export const FeedVersionChanged = EventDefinition.define({
  type: "feed.version.changed",
  schema: {
    version: FeedVersion,
  },
});
