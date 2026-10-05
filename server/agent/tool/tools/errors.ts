// Purpose: Defines recoverable built-in tool argument diagnostics.

import { Schema } from "effect";
import { ResourceIssue } from "@openchart/server/lib/resource/invariant";

/** A finite Tea result exceeds the model-facing output budget. */
export class TeaRunOutputTooLarge extends Schema.TaggedError<TeaRunOutputTooLarge>()(
  "Tool.TeaRunOutputTooLarge",
  { maximumRows: Schema.Int, maximumCharacters: Schema.Int },
) {
  /** Guides the model to request a smaller complete result. @example error.message; */
  override get message() {
    return `Tea output exceeds ${this.maximumRows} rows or ${this.maximumCharacters} serialized characters. Shorten the time window or emit fewer fields.`;
  }
}

/** The complete Feed window is too large for a model-facing bar result. */
export class MarketDataWindowTooLarge extends Schema.TaggedError<MarketDataWindowTooLarge>()(
  "Tool.MarketDataWindowTooLarge",
  { bars: Schema.Int, maximum: Schema.Int },
) {
  /** Guides the model to request a smaller complete window. @example error.message; */
  override get message() {
    return `Market data returned ${this.bars} bars, exceeding the ${this.maximum}-bar maximum. Shorten the time window or use a coarser resolution.`;
  }
}

/** The requested task profile does not exist; no child Session has been created. */
export class TaskAgentNotFound extends Schema.TaggedError<TaskAgentNotFound>()(
  "Tool.TaskAgentNotFound",
  { agent: Schema.String },
) {
  /** Identifies the missing profile in tool feedback. @example error.message; */
  override get message() {
    return `Unknown agent profile: ${this.agent}`;
  }
}

/** Resource selection or input diagnostics that let the model correct its request. */
export class ResourceArgumentsError extends Schema.TaggedError<ResourceArgumentsError>()(
  "Tool.ResourceArgumentsError",
  {
    detail: Schema.String,
    allowedKeys: Schema.optionalKey(Schema.Array(Schema.String)),
    issues: Schema.optionalKey(Schema.Array(ResourceIssue)),
  },
) {}

/** A cursor the tool's storage does not recognize; the model restarts or reuses the exact returned one. */
export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()(
  "Tool.InvalidCursor",
  { tool: Schema.String },
) {
  override get message() {
    return `Invalid ${this.tool} cursor. Pass only the exact next cursor returned by a previous ${this.tool} call, or start over without one.`;
  }
}
