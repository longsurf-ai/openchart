// Purpose: Own fixed and ongoing time interval bounds shared by requests and snapshots.

import { Schema } from "effect";

/**
 * Validate a time interval expressed in epoch milliseconds.
 *
 * A numeric range includes `from` and excludes `to`, and requires `from < to`.
 * The literal `"now"` leaves cutoff selection to the consuming service: decoding
 * this schema does not read the clock or open a subscription. Bounds must be
 * integers, and unknown properties are rejected.
 *
 * @example
 * ```ts
 * import { TimeRange } from "@openchart/timeseries";
 * import { Schema } from "effect";
 *
 * const parse = Schema.decodeUnknownSync(TimeRange);
 * const fixed = parse({ from: 1_000, to: 2_000 });
 * // Includes time 1_000, but excludes time 2_000.
 * const ongoing = parse({ from: 1_000, to: "now" });
 * // The service decides the numeric cutoff for "now".
 * // parse({ from: 2_000, to: 1_000 }) would throw: from must precede to.
 * ```
 */
export const TimeRange = Schema.Struct({
  /** Inclusive start as integer milliseconds since the Unix epoch. */
  from: Schema.Int,
  /** Exclusive end, or a symbolic cutoff to be resolved by the service. */
  to: Schema.Union([Schema.Int, Schema.Literal("now")]),
})
  .check(
    Schema.makeFilter((range) => range.to === "now" || range.from < range.to, {
      message: "from must precede to",
    }),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });
/** The validated bounds represented by the {@link TimeRange} schema. */
export type TimeRange = typeof TimeRange.Type;

export const CountRange = Schema.Struct({
  countBack: Schema.Int.check(Schema.isGreaterThan(0)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type CountRange = typeof CountRange.Type;

export const Range = TimeRange.mapFields(
  (fields) => ({ ...fields, ...CountRange.fields }),
  { unsafePreserveChecks: true }, // keeps the from < to check
).annotate({ parseOptions: { onExcessProperty: "error" } });
export type Range = typeof Range.Type;
