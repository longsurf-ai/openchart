// Purpose: Own custom widget source failures.
import { Schema } from "effect";

/** A widget file failed its import, declaration or type checks; `message` carries the diagnostics. */
export class WidgetInvalid extends Schema.TaggedError<WidgetInvalid>()(
  "WidgetInvalid",
  { message: Schema.String },
) {}
