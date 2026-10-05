// Purpose: Public Feed failure reasons: closed, browser-safe facts that callers cannot know themselves.

import { ProviderId } from "@openchart/market";
import { Schema } from "effect";

/**
 * The request itself is invalid, for example a window that does not start
 * before its cutoff. `detail` is fixed text we wrote, never upstream text.
 *
 * @example new InvalidRequest({ detail: "Bars from must precede the snapshot cutoff" });
 */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "Feed.InvalidRequest",
  { detail: Schema.NonEmptyString },
) {
  /** Repeating an invalid request cannot succeed. */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * The source does not offer the requested resolution, session, adjustment or
 * live combination. The caller already knows which combination it requested.
 *
 * @example new Unsupported({ provider: ProviderId.make("yfinance") });
 */
export class Unsupported extends Schema.TaggedError<Unsupported>()(
  "Feed.Unsupported",
  { provider: ProviderId },
) {
  /** The source will not start supporting the combination on retry. */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * The request reaches further back than the source keeps; `availableFrom` is
 * the earliest time in Unix milliseconds the source still serves.
 *
 * @example new HistoryUnavailable({ provider: ProviderId.make("yfinance"), availableFrom: 1754006400000 });
 */
export class HistoryUnavailable extends Schema.TaggedError<HistoryUnavailable>()(
  "Feed.HistoryUnavailable",
  { provider: ProviderId, availableFrom: Schema.Int },
) {
  /** The source's retention does not change on retry. */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * The source has no such listing.
 *
 * @example new NotFound({ provider: ProviderId.make("yfinance") });
 */
export class NotFound extends Schema.TaggedError<NotFound>()("Feed.NotFound", {
  provider: ProviderId,
}) {
  /** A missing listing stays missing. */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * The source refused access.
 *
 * @example new AccessDenied({ provider: ProviderId.make("openchart") });
 */
export class AccessDenied extends Schema.TaggedError<AccessDenied>()(
  "Feed.AccessDenied",
  { provider: ProviderId },
) {
  /** Access changes through the account, not by retrying. */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * The source is rate limiting. The server has already retried with backoff.
 *
 * @example new RateLimited({ provider: ProviderId.make("yfinance") });
 */
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "Feed.RateLimited",
  { provider: ProviderId },
) {
  /** A later attempt may succeed once the limit resets. */
  get isRetryable(): boolean {
    return true;
  }
}

/**
 * The source is temporarily unavailable, or no source is ready. `provider` is
 * absent when no single source is responsible.
 *
 * @example new SourceUnavailable({ provider: ProviderId.make("binance") });
 */
export class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
  "Feed.SourceUnavailable",
  { provider: Schema.optionalKey(ProviderId) },
) {
  /** Availability may return. */
  get isRetryable(): boolean {
    return true;
  }
}

/**
 * The source returned data that could not be read.
 *
 * @example new InvalidSourceData({ provider: ProviderId.make("yfinance") });
 */
export class InvalidSourceData extends Schema.TaggedError<InvalidSourceData>()(
  "Feed.InvalidSourceData",
  { provider: ProviderId },
) {
  /** The same source data would fail again. */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * The live stream must be re-established: it overflowed, disconnected, or the
 * source asked for resynchronization.
 *
 * @example new ResyncRequired({ provider: ProviderId.make("openchart") });
 */
export class ResyncRequired extends Schema.TaggedError<ResyncRequired>()(
  "Feed.ResyncRequired",
  { provider: ProviderId },
) {
  /** Opening the stream again resynchronizes it. */
  get isRetryable(): boolean {
    return true;
  }
}

/**
 * The source was retired or reconfigured while the request ran.
 *
 * @example new Reconfigured({ provider: ProviderId.make("yfinance") });
 */
export class Reconfigured extends Schema.TaggedError<Reconfigured>()(
  "Feed.Reconfigured",
  { provider: ProviderId },
) {
  /** A new request reaches the current configuration. */
  get isRetryable(): boolean {
    return true;
  }
}
