// Purpose: Defines Integration authorization failures.

import { Schema } from "effect";
import { OAuthAttemptID } from "./id";

/** A code-based OAuth attempt cannot complete without its authorization code. */
export class CodeRequiredError extends Schema.TaggedError<CodeRequiredError>()(
  "Integration.CodeRequired",
  { attemptID: OAuthAttemptID },
) {}

/** Expected failure returned by an integration's authorization operation. */
export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()(
  "Integration.Authorization",
  { cause: Schema.Defect() },
) {}
