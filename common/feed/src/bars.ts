// Purpose: Own complete Bars windows, minimum history counts, and snapshot/update envelopes.

import { Schema } from "effect";
import { BarColumns, ProviderListing, SessionType } from "@openchart/market";
import {
  dataFrameCodec,
  hasColumns,
  TimeRange,
  type DataFrame,
} from "@openchart/timeseries";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/** Common Bar Resolution */
export const Resolution = Schema.Literals([
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1W",
  "1M",
]);
export type Resolution = typeof Resolution.Type;
/**
 * Each resolution's nominal bar length in milliseconds, for padding windows,
 * placing empty or future slots and comparing resolutions. It ignores market
 * hours and counts a month as 30 days, so real bars can be spaced otherwise.
 * @example const step = resolutionMs["1h"]; // 3600000
 */
export const resolutionMs: Readonly<Record<Resolution, number>> = {
  "1s": 1000,
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000,
  "1W": 604800000,
  "1M": 2592000000,
};
/** Common Adjustment Basis */
export const Adjustment = Schema.Literals(["raw", "split", "split_dividend"]);
export type Adjustment = typeof Adjustment.Type;
/** Bars series */
export const BarsSeries = Schema.Struct({
  ...ProviderListing.fields,
  resolution: Resolution,
  session: SessionType,
  adjustment: Adjustment,
});
export type BarsSeries = typeof BarsSeries.Type;

/**
 * One listing's series under a chart's bar settings. Copies exactly the five
 * series fields, so a market source's `id` or a cell's other fields never reach
 * a strict Feed request.
 * @example const series = barsSeries(source, cell);
 */
export function barsSeries(
  listing: ProviderListing,
  settings: Pick<BarsSeries, "resolution" | "session" | "adjustment">,
): BarsSeries {
  return {
    provider: listing.provider,
    listing: listing.listing,
    resolution: settings.resolution,
    session: settings.session,
    adjustment: settings.adjustment,
  };
}

/**
 * Read one provider's complete bar window, optionally followed by updates.
 * All top-level fields are required; unknown fields are rejected.
 *
 * - `provider`: source to route to; never falls back to another provider.
 * - `listing`: source-native listing from Symbology, including symbol/currency
 *   and any source ID (Cloud requires its numeric ID).
 * - `resolution`: bar interval; `1W` and `1M` mean calendar weeks/months.
 * - `session`: trading-session selection; `provider` uses the source's session
 *   semantics rather than implying regular-session or 24-hour coverage.
 * - `adjustment`: price basis: raw, split-adjusted, or split/dividend-adjusted.
 *   The resolution/session/adjustment combination must be supported by the source.
 * - `from`: inclusive history start, in integer Unix milliseconds.
 * - `to`: exclusive history end in integer Unix milliseconds, clamped to the
 *   server's current time. A numeric end returns only a historical snapshot;
 *   `"now"` resolves the snapshot cutoff once and continues with live or delayed
 *   updates after the snapshot.
 * - `countBack`: positive minimum number of historical bars, not a result limit.
 *   Return every bar in the window; if fewer than countBack exist, prepend earlier
 *   available bars. Exhausted history may return fewer; missing bars are not filled.
 *
 * Window/count relationship (countBack = 500):
 *
 * | Bars in [from, to) | Earlier bars added | Total returned |
 * | ----------------- | ------------------ | -------------- |
 * | 800               | 0                  | 800            |
 * | 300               | 200                | 500            |
 * | 300               | only 100 available | 400            |
 *
 * With enough earlier history: total = max(window bars, countBack).
 * Added bars precede `from`; `to` remains the exclusive snapshot cutoff.
 *
 * @example
 * const request: BarsRequest = {
 *   ...barsSeries(source, cell),
 *   from: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   to: "now",
 *   countBack: 500,
 * };
 */
export const BarsRequest = TimeRange.mapFields(
  (fields) => ({
    ...fields,
    ...BarsSeries.fields,
    countBack: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  { unsafePreserveChecks: true }, // The range fields are unchanged.
).annotate(strict);
export type BarsRequest = typeof BarsRequest.Type;

/** Native source columns that include the market Bar vocabulary; times strictly ascend. */
const barsDataFrame = dataFrameCodec
  .pipe(
    Schema.refine(
      (frame): frame is DataFrame<BarColumns> => hasColumns(frame, BarColumns),
      {
        message: "Bars must include open, high, low, close and volume columns",
      },
    ),
  )
  .check(
    Schema.makeFilter(
      (frame) => {
        let previous: number | undefined;
        for (const { time } of frame) {
          if (previous !== undefined && time <= previous) return false;
          previous = time;
        }
        return true;
      },
      { message: "Bars times must strictly ascend" },
    ),
  );

/** Native Dataset columns, including countBack expansion and proven look-behind. */
const snapshot = Schema.Struct({
  range: TimeRange.mapFields(
    (fields) => ({ ...fields, to: Schema.Int }),
    { unsafePreserveChecks: true }, // Narrowing to preserves the ordering check.
  ).annotate(strict),
  data: barsDataFrame,
  hasMoreBefore: Schema.Boolean,
});
/** Feed checks coverage; the timeseries codec owns frame structure and ordering. */
export const BarsSnapshotCheck = Schema.makeFilter<typeof snapshot.Type>(
  (snapshot) =>
    [...snapshot.data].every(
      ({ time }) => time >= snapshot.range.from && time < snapshot.range.to,
    ),
  { message: "Snapshot times must be inside its range" },
);
/** Complete sorted history and its proven coverage. */
export const BarsSnapshot = snapshot.check(BarsSnapshotCheck);
export type BarsSnapshot = typeof BarsSnapshot.Type;

/** Supported combinations, avoiding a misleading Cartesian product. A source lists its default first for each resolution. */
export const BarsCapabilities = Schema.Array(
  Schema.Struct({
    resolution: Resolution,
    session: SessionType,
    adjustment: Adjustment,
    modes: Schema.NonEmptyArray(
      Schema.Literals(["history", "live", "delayed"]), // history: historical bars, live: live bars, delayed: delayed bars
    ),
  }),
);
export type BarsCapabilities = typeof BarsCapabilities.Type;

/** Bars operations always use Hose; live snapshots have a server-selected cutoff. */
export const BarsChannelRequest = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("bars.open"),
    request: BarsRequest,
  }).annotate(strict),
  Schema.Struct({
    type: Schema.Literal("bars.capabilities"),
    request: ProviderListing,
  }).annotate(strict),
]);
export type BarsChannelRequest = typeof BarsChannelRequest.Type;

/** One snapshot must precede every update on the same channel. */
export const BarsMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), snapshot: BarsSnapshot }),
  Schema.Struct({ type: Schema.Literal("updates"), data: barsDataFrame }),
]);
export type BarsMessage = typeof BarsMessage.Type;
