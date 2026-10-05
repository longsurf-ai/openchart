// Purpose: Map Binance I/O failures into typed Dataset reasons.

import { Schema } from "effect";
import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";

/** Preserve deliberate failures; unreadable source data is InvalidResult, any
 * other failure (network, socket) means Binance is unavailable. The original
 * error stays as the server-only cause.
 * @example const failure = binanceError(new Error('network'));
 */
export function binanceError(cause: unknown): DatasetFailure {
  if (cause instanceof DatasetFailure) return cause;
  return new DatasetFailure(
    // SyntaxError: the body was not JSON.
    Schema.isSchemaError(cause) || cause instanceof SyntaxError
      ? new DatasetReasons.InvalidResult()
      : new DatasetReasons.Unavailable(),
    { cause },
  );
}

/** The Dataset reason for a failed Binance HTTP status, from REST or a refused
 * stream upgrade; undocumented statuses mean unavailable.
 * @example httpReason(429); // Dataset.RateLimited
 */
export function httpReason(status: number): DatasetReason {
  switch (status) {
    case 400:
      return new DatasetReasons.InvalidQuery({
        detail: "Binance rejected the request.",
      });
    // 451: Binance refuses restricted locations.
    case 401:
    case 403:
    case 451:
      return new DatasetReasons.AccessDenied();
    case 418:
    case 429:
      return new DatasetReasons.RateLimited();
    default:
      return new DatasetReasons.Unavailable();
  }
}
