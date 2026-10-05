// Purpose: Typed Dataset failures: providers supply a reason, makeDataset adds where it failed; causes stay on the server.
import { Schema } from "effect";
import { Mode } from "./definition";
import * as DatasetReasons from "./reasons";

/** Every Dataset failure reason; a closed union that Feed maps exhaustively. */
export const DatasetReason = Schema.Union([
  DatasetReasons.InvalidQuery,
  DatasetReasons.Unsupported,
  DatasetReasons.OutsideRetention,
  DatasetReasons.NotFound,
  DatasetReasons.AccessDenied,
  DatasetReasons.RateLimited,
  DatasetReasons.Unavailable,
  DatasetReasons.InvalidResult,
  DatasetReasons.StreamInterrupted,
  DatasetReasons.Retired,
]);
/** One Dataset failure reason. */
export type DatasetReason = typeof DatasetReason.Type;

/**
 * What provider code fails with: a reason and the upstream cause, without a
 * location. makeDataset turns it into a located {@link DatasetError}; provider
 * activation failures stay a DatasetFailure because no Dataset operation ran.
 *
 * @example new DatasetFailure(new DatasetReasons.RateLimited(), { cause: response });
 */
export class DatasetFailure extends Schema.TaggedError<DatasetFailure>()(
  "DatasetFailure",
  { reason: DatasetReason, cause: Schema.optional(Schema.Defect()) },
) {
  /** Wraps a reason with an optional server-only cause. */
  constructor(reason: DatasetReason, options?: { readonly cause?: unknown }) {
    super({ reason, cause: options?.cause });
  }

  /** The reason tag, for logs only; consumers read `reason`. */
  override get message(): string {
    return this.reason._tag;
  }
}

/**
 * A Dataset operation failure: which Dataset and operation failed, why, and the
 * server-only cause. Only makeDataset creates it; it never crosses a transport.
 *
 * @example new DatasetError({ dataset: "yfinance.bars", operation: "select", reason: new DatasetReasons.NotFound() });
 */
export class DatasetError extends Schema.TaggedError<DatasetError>()(
  "DatasetError",
  {
    dataset: Schema.NonEmptyString,
    operation: Mode,
    reason: DatasetReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  /** Where and why the operation failed, for logs only. */
  override get message(): string {
    return `${this.dataset} ${this.operation}: ${this.reason._tag}`;
  }
}
