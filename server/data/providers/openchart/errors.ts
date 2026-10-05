// Purpose: Define OpenChart API failures and map them to Dataset reasons.
import { Schema } from "effect";
import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";

/** A finite request or connection exceeded its deadline. @example new OpenChartTimeout({}) */
export class OpenChartTimeout extends Schema.TaggedError<OpenChartTimeout>()(
  "OpenChartTimeout",
  {},
) {}

/**
 * Local transport failed without a usable HTTP response.
 * @example new OpenChartUnavailable({})
 */
export class OpenChartUnavailable extends Schema.TaggedError<OpenChartUnavailable>()(
  "OpenChartUnavailable",
  {},
) {}

/** A OpenChart response was malformed, incomplete, or belonged to another series. @example new OpenChartInvalidResponse({}) */
export class OpenChartInvalidResponse extends Schema.TaggedError<OpenChartInvalidResponse>()(
  "OpenChartInvalidResponse",
  {},
) {}

/** The server requests a fresh authorized connection and history handoff. @example new OpenChartResyncRequired({}) */
export class OpenChartResyncRequired extends Schema.TaggedError<OpenChartResyncRequired>()(
  "OpenChartResyncRequired",
  {},
) {}

/**
 * Cloud rejected or ended one live subscription; other series stay connected.
 * Query and adjustment failures are terminal. Transient failures request a
 * fresh history/live handoff through the Dataset owner.
 * @example new OpenChartLiveError({ code: "resync_required" })
 */
export class OpenChartLiveError extends Schema.TaggedError<OpenChartLiveError>()(
  "OpenChartLiveError",
  {
    code: Schema.Literals([
      "invalid_query",
      "adjustment_unavailable",
      "busy",
      "unavailable",
      "resync_required",
    ]),
  },
) {}

/** Access cannot authorize this transport operation. @example new CredentialUnavailable({reason: 'missing'}) */
export class CredentialUnavailable extends Schema.TaggedError<CredentialUnavailable>()(
  "OpenChart.CredentialUnavailable",
  { reason: Schema.Literals(["missing", "changed", "closed", "unavailable"]) },
) {}

/** HTTP admission/query rejection; no remote response body leaks. @example new OpenChartRejected({status: 403}); */
export class OpenChartRejected extends Schema.TaggedError<OpenChartRejected>()(
  "OpenChartRejected",
  { status: Schema.Int },
) {}

/**
 * Maps a transport failure to its Dataset reason, keeping the OpenChart error as
 * the server-only cause. Missing credentials and 401/403 deny access; changed,
 * closed or unresolvable credentials, timeouts, transport failures and other
 * statuses are Unavailable.
 * @example client.searchListings(query).pipe(Effect.mapError(openchartError));
 */
export function openchartError(error: OpenChartError): DatasetFailure {
  return new DatasetFailure(reasonFor(error), { cause: error });
}

function reasonFor(error: OpenChartError): DatasetReason {
  switch (error._tag) {
    case "OpenChartLiveError":
      if (error.code === "invalid_query")
        return new DatasetReasons.InvalidQuery({
          detail: "OpenChart rejected the subscription.",
        });
      if (error.code === "adjustment_unavailable")
        return new DatasetReasons.Unsupported();
      return new DatasetReasons.StreamInterrupted({ kind: "resync" });
    case "OpenChartRejected":
      switch (error.status) {
        case 400:
          return new DatasetReasons.InvalidQuery({
            detail: "OpenChart rejected the request.",
          });
        case 401:
        case 403:
          return new DatasetReasons.AccessDenied();
        case 422:
          return new DatasetReasons.Unsupported();
        case 429:
          return new DatasetReasons.RateLimited();
        default:
          return new DatasetReasons.Unavailable();
      }
    case "OpenChart.CredentialUnavailable":
      return error.reason === "missing"
        ? new DatasetReasons.AccessDenied()
        : new DatasetReasons.Unavailable();
    case "OpenChartResyncRequired":
      return new DatasetReasons.StreamInterrupted({ kind: "resync" });
    case "OpenChartInvalidResponse":
      return new DatasetReasons.InvalidResult();
    case "OpenChartTimeout":
    case "OpenChartUnavailable":
      return new DatasetReasons.Unavailable();
  }
}

/** Failures exposed by the authenticated OpenChart transport. */
export type OpenChartError =
  | OpenChartTimeout
  | OpenChartUnavailable
  | OpenChartInvalidResponse
  | OpenChartRejected
  | OpenChartResyncRequired
  | OpenChartLiveError
  | CredentialUnavailable;
