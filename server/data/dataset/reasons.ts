// Purpose: Server-only Dataset failure reasons: source-level facts, mapped to public Feed reasons by Feed.

import { Schema } from "effect";

/**
 * The query does not satisfy the Dataset declaration or the source's rules.
 * `detail` is fixed text we wrote, never upstream text.
 *
 * @example new InvalidQuery({ detail: "Yahoo bars require a start or count." });
 */
export class InvalidQuery extends Schema.TaggedError<InvalidQuery>()(
  "Dataset.InvalidQuery",
  { detail: Schema.NonEmptyString },
) {}

/**
 * The source does not support this query.
 *
 * @example new Unsupported();
 */
export class Unsupported extends Schema.TaggedError<Unsupported>()(
  "Dataset.Unsupported",
  {},
) {}

/**
 * The query reaches before the data the source retains; `availableFrom` is the
 * earliest retained time in Unix milliseconds.
 *
 * @example new OutsideRetention({ availableFrom: 1754006400000 });
 */
export class OutsideRetention extends Schema.TaggedError<OutsideRetention>()(
  "Dataset.OutsideRetention",
  { availableFrom: Schema.Int },
) {}

/**
 * The source has no such key.
 *
 * @example new NotFound();
 */
export class NotFound extends Schema.TaggedError<NotFound>()(
  "Dataset.NotFound",
  {},
) {}

/**
 * The source refused access.
 *
 * @example new AccessDenied();
 */
export class AccessDenied extends Schema.TaggedError<AccessDenied>()(
  "Dataset.AccessDenied",
  {},
) {}

/**
 * The source is rate limiting.
 *
 * @example new RateLimited();
 */
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "Dataset.RateLimited",
  {},
) {}

/**
 * The source cannot be reached, or the Dataset is not ready.
 *
 * @example new Unavailable();
 */
export class Unavailable extends Schema.TaggedError<Unavailable>()(
  "Dataset.Unavailable",
  {},
) {}

/**
 * The source returned data that could not be read.
 *
 * @example new InvalidResult();
 */
export class InvalidResult extends Schema.TaggedError<InvalidResult>()(
  "Dataset.InvalidResult",
  {},
) {}

/**
 * The source supplied an observation with missing required values. A later
 * read may succeed after the source completes or repairs the observation.
 *
 * @example new IncompleteData();
 */
export class IncompleteData extends Schema.TaggedError<IncompleteData>()(
  "Dataset.IncompleteData",
  {},
) {}

/**
 * A stream overflowed, disconnected, or the source asked to resynchronize.
 * `resync` is the only kind a provider may resume on its own.
 *
 * @example new StreamInterrupted({ kind: "resync" });
 */
export class StreamInterrupted extends Schema.TaggedError<StreamInterrupted>()(
  "Dataset.StreamInterrupted",
  { kind: Schema.Literals(["overflow", "disconnected", "resync"]) },
) {}

/**
 * The Dataset was retired and admits no new work.
 *
 * @example new Retired();
 */
export class Retired extends Schema.TaggedError<Retired>()(
  "Dataset.Retired",
  {},
) {}
