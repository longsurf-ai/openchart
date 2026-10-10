// Purpose: Collection's own expected failures.
import { Schema } from "effect";

/** A script run produced no new data file; `message` is safe to show the user. */
export class ScriptFailed extends Schema.TaggedError<ScriptFailed>()(
  "Collection.ScriptFailed",
  { message: Schema.String },
) {}
