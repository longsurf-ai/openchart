// Purpose: Trading-session selectors; extended and 24h are query coverage, not atomic sessions.

import { Schema } from "effect";

/** Requested trading-session coverage. */
export const SessionType = Schema.Literals([
  "regular",
  "extended", // pre + regular + post
  "24h", // all available trading hours
]);
export type SessionType = typeof SessionType.Type;

/** Atomic session kinds a venue actually holds; never a coverage selector. */
export const AtomicSessionType = Schema.Literals([
  "regular",
  "pre",
  "post",
  "overnight",
]);
export type AtomicSessionType = typeof AtomicSessionType.Type;
