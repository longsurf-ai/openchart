// Purpose: The one exhaustive mapping from Dataset reasons to public Feed reasons, plus Feed's own failures.

import { FeedError, FeedReasons } from "@openchart/feed";
import type { FeedReason } from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import type {
  DatasetError,
  DatasetFailure,
  DatasetReason,
} from "@openchart/server/data/dataset";

/**
 * Wraps a public reason, keeping a server-only cause for logs. The cause is not
 * a schema field, so encoding never sends it.
 *
 * @example feedError(new FeedReasons.SourceUnavailable({}));
 */
export function feedError(reason: FeedReason, cause?: unknown): FeedError {
  const error = new FeedError({ reason });
  return cause === undefined ? error : Object.assign(error, { cause });
}

/**
 * No ready source serves the request; names the provider when one was asked for.
 *
 * @example unavailable(request.provider);
 */
export const unavailable = (provider?: ProviderId) =>
  feedError(
    new FeedReasons.SourceUnavailable(
      provider === undefined ? {} : { provider },
    ),
  );

const reasons = {
  "Dataset.InvalidQuery": (reason) =>
    new FeedReasons.InvalidRequest({ detail: reason.detail }),
  "Dataset.Unsupported": (_, provider) =>
    new FeedReasons.Unsupported({ provider }),
  "Dataset.OutsideRetention": (reason, provider) =>
    new FeedReasons.HistoryUnavailable({
      provider,
      availableFrom: reason.availableFrom,
    }),
  "Dataset.NotFound": (_, provider) => new FeedReasons.NotFound({ provider }),
  "Dataset.AccessDenied": (_, provider) =>
    new FeedReasons.AccessDenied({ provider }),
  "Dataset.RateLimited": (_, provider) =>
    new FeedReasons.RateLimited({ provider }),
  "Dataset.Unavailable": (_, provider) =>
    new FeedReasons.SourceUnavailable({ provider }),
  "Dataset.InvalidResult": (_, provider) =>
    new FeedReasons.InvalidSourceData({ provider }),
  "Dataset.IncompleteData": (_, provider) =>
    new FeedReasons.IncompleteData({ provider }),
  "Dataset.StreamInterrupted": (_, provider) =>
    new FeedReasons.ResyncRequired({ provider }),
  "Dataset.Retired": (_, provider) =>
    new FeedReasons.Reconfigured({ provider }),
} satisfies {
  readonly [T in DatasetReason["_tag"]]: (
    reason: Extract<DatasetReason, { _tag: T }>,
    provider: ProviderId,
  ) => FeedReason;
};

/**
 * Maps a Dataset failure to its public Feed reason, adding the provider id and
 * keeping the original error as the server-only cause. Provider Feed adapters
 * call it with their constant id; a provider access check passes its
 * unlocated DatasetFailure the same way.
 *
 * @example dataset.select(key).pipe(Effect.mapError(datasetFailure(providerId)));
 */
export const datasetFailure =
  (provider: ProviderId) =>
  (error: DatasetError | DatasetFailure): FeedError => {
    const reason = reasons[error.reason._tag] as (
      reason: DatasetReason,
      provider: ProviderId,
    ) => FeedReason;
    return feedError(reason(error.reason, provider), error);
  };
