// Purpose: Defines Auth-owned user information and public account state.

import { Schema } from "effect";

/** Cached public SDK profile for display; cloud identity comes from key verification. */
export const User = Schema.Struct({
  id: Schema.NonEmptyString,
  firstName: Schema.String,
  lastName: Schema.String,
  email: Schema.String,
});

/**
 * Credential-free account state allowed across the renderer boundary.
 * Service failures travel through Effect error channels, not account states.
 */
export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("signed-out") }),
  Schema.Struct({ status: Schema.Literal("signed-in"), user: User }),
]);

/** Public account state, derived from the account state schema. */
export type State = typeof State.Type;
