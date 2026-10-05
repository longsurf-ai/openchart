// Purpose: Map Yahoo source failures to Dataset reasons; upstream detail stays in the cause.

import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";

/** Preserve deliberate failures; a non-JSON body is InvalidResult, other I/O failures are
 * Unavailable, and both keep their cause.
 * @example const failure = yfinanceError(new Error('network'));
 */
export function yfinanceError(cause: unknown): DatasetFailure {
  if (cause instanceof DatasetFailure) return cause;
  // SyntaxError: the body was not JSON.
  return cause instanceof SyntaxError
    ? invalidResult(cause)
    : new DatasetFailure(new DatasetReasons.Unavailable(), { cause });
}

/** Yahoo returned data that cannot be read; `cause` says what was wrong.
 * @example Effect.fail(invalidResult("Yahoo chart column lengths differ."));
 */
export function invalidResult(cause: unknown): DatasetFailure {
  return new DatasetFailure(new DatasetReasons.InvalidResult(), { cause });
}

const statuses: Record<number, () => DatasetReason> = {
  400: () =>
    new DatasetReasons.InvalidQuery({
      detail: "Yahoo Finance rejected the request.",
    }),
  401: () => new DatasetReasons.AccessDenied(),
  403: () => new DatasetReasons.AccessDenied(),
  404: () => new DatasetReasons.NotFound(),
  429: () => new DatasetReasons.RateLimited(),
};

/** Map a failed Yahoo HTTP status; unlisted statuses are Unavailable.
 * @example throw statusFailure(response.status, body);
 */
export function statusFailure(status: number, cause: unknown): DatasetFailure {
  return new DatasetFailure(
    (statuses[status] ?? (() => new DatasetReasons.Unavailable()))(),
    { cause },
  );
}
