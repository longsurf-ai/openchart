// Purpose: Describe an alert editor snapshot that no longer matches its actions.
import { Schema } from "effect";

/** The editor must reload all actions before replacing their complete snapshot. */
export class AlertSaveConflict extends Schema.TaggedError<AlertSaveConflict>()(
  "Alert.SaveConflict",
  {},
) {}
