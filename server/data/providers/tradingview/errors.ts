// Purpose: Map TradingView transport and protocol failures to Dataset reasons.

import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";
import type { ServerFrame } from "./protocol";
import { frameStrings } from "./protocol";

/** Preserve a deliberate failure; any other transport cause is Unavailable.
 * @example const failure = tradingviewError(new Error("socket closed"));
 */
export function tradingviewError(cause: unknown): DatasetFailure {
  return cause instanceof DatasetFailure
    ? cause
    : new DatasetFailure(new DatasetReasons.Unavailable(), { cause });
}

/** TradingView returned data that cannot be read; `cause` names the problem.
 * @example Effect.fail(invalidResult("TradingView returned a short candle."));
 */
export function invalidResult(cause: unknown): DatasetFailure {
  return new DatasetFailure(new DatasetReasons.InvalidResult(), { cause });
}

const statuses: Readonly<Record<number, () => DatasetReason>> = {
  401: () => new DatasetReasons.AccessDenied(),
  403: () => new DatasetReasons.AccessDenied(),
  404: () => new DatasetReasons.NotFound(),
  429: () => new DatasetReasons.RateLimited(),
};

/** Maps an HTTP response status; unlisted statuses remain transient Unavailable.
 * @example const failure = statusFailure(429, "TradingView rate limit");
 */
export function statusFailure(status: number, cause: unknown): DatasetFailure {
  return new DatasetFailure(
    (statuses[status] ?? (() => new DatasetReasons.Unavailable()))(),
    { cause },
  );
}

/** A symbol or series refusal names its reason in the fourth parameter. */
export function protocolFailure(
  frame: ServerFrame,
  symbol: string,
): DatasetFailure {
  const strings = frameStrings(frame);
  const reason =
    frame.kind === "message" && frame.method === "symbol_error"
      ? strings[2]
      : strings[3];
  const normalized = (reason ?? "").toLowerCase();
  const data = { cause: reason ?? frame };
  if (
    normalized.includes("not entitled") ||
    normalized.includes("permission denied")
  )
    return new DatasetFailure(new DatasetReasons.AccessDenied(), data);
  if (
    normalized.includes("invalid symbol") ||
    normalized.includes("unknown symbol") ||
    normalized.includes("not found") ||
    normalized.includes("resolve error")
  )
    return new DatasetFailure(new DatasetReasons.NotFound(), data);
  if (normalized.includes("unsupported resolution"))
    return new DatasetFailure(new DatasetReasons.Unsupported(), data);
  return new DatasetFailure(new DatasetReasons.Unavailable(), {
    cause: `${symbol}: ${reason ?? "TradingView refused the series"}`,
  });
}

/** The failure a chart-session frame reports, if any; other frames return undefined.
 * @example const failure = frameFailure(frame, "NASDAQ:AAPL");
 */
export function frameFailure(
  frame: ServerFrame,
  symbol: string,
): DatasetFailure | undefined {
  if (frame.kind !== "message") return undefined;
  if (frame.method === "series_error" || frame.method === "symbol_error")
    return protocolFailure(frame, symbol);
  if (frame.method === "critical_error" || frame.method === "protocol_error")
    return new DatasetFailure(new DatasetReasons.Unavailable(), {
      cause: frame,
    });
  return undefined;
}

/** A cookie session that TradingView no longer recognizes; the user must reconnect.
 * @example Effect.fail(expiredSession("TradingView returned no auth token."));
 */
export function expiredSession(cause: unknown): DatasetFailure {
  return new DatasetFailure(new DatasetReasons.AccessDenied(), { cause });
}
