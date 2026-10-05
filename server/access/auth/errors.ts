// Purpose: Defines local account failures without exposing credentials.
import { Schema } from "effect";

/** Local account state cannot be read. @example new SessionUnavailable({}) */
export class SessionUnavailable extends Schema.TaggedError<SessionUnavailable>()(
  "SessionUnavailable",
  {},
) {}

/** Safe account mutation failure. @example new AuthOperationFailed({reason: 'storage'}) */
export class AuthOperationFailed extends Schema.TaggedError<AuthOperationFailed>()(
  "AuthOperationFailed",
  {
    reason: Schema.Literals([
      "storage",
      "busy",
      "closed",
      "credential-mismatch",
    ]),
  },
) {}
