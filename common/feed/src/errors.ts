// Purpose: Public Feed failures and their one wording function, shared by server, app and agent.

import { Schema } from "effect";
import * as ClientFailures from "./client-failures";
import * as FeedReasons from "./reasons";
import { describeFailure } from "./wording";

/** Every public Feed failure reason; a closed union decoded the same way on server and app. */
export const FeedReason = Schema.Union([
  FeedReasons.InvalidRequest,
  FeedReasons.Unsupported,
  FeedReasons.HistoryUnavailable,
  FeedReasons.NotFound,
  FeedReasons.AccessDenied,
  FeedReasons.RateLimited,
  FeedReasons.SourceUnavailable,
  FeedReasons.InvalidSourceData,
  FeedReasons.ResyncRequired,
  FeedReasons.Reconfigured,
]);
/** One public Feed failure reason. */
export type FeedReason = typeof FeedReason.Type;

/** Failures a client sees without a public reason; they never cross the wire. */
export const ClientFailure = Schema.Union([
  ClientFailures.Cancelled,
  ClientFailures.Disconnected,
  ClientFailures.InvalidResponse,
  ClientFailures.Internal,
]);
/** One client-side failure without a public reason. */
export type ClientFailure = typeof ClientFailure.Type;

/**
 * A public Feed failure. Only `reason` is encoded; a server-only cause may be
 * attached after construction and never crosses the wire. Constructing and
 * decoding it needs no Effect runtime, so the app uses it directly.
 *
 * @example
 * const error = new FeedError({ reason: new FeedReasons.RateLimited({ provider }) });
 * error.isRetryable; // true
 */
export class FeedError extends Schema.TaggedError<FeedError>()("FeedError", {
  reason: FeedReason,
}) {
  /** Whether repeating the same request may succeed; owned by the reason. */
  get isRetryable(): boolean {
    return this.reason.isRetryable;
  }

  /** The wording sentence, so generic `message` readers never see an empty string. */
  override get message(): string {
    return describeFailure(this.reason);
  }
}
