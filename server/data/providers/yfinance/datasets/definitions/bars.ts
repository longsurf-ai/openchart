// Purpose: Describe Yahoo chart OHLCV with native intervals and millisecond times.

import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

/** Native Yahoo chart cadences supported by this provider. */
export const YFinanceInterval = Schema.Literals([
  "1m",
  "5m",
  "15m",
  "30m",
  "60m",
  "1d",
  "1wk",
  "1mo",
]);
/** Provider-native observation schema. */
export const yfinanceBarsRow = Schema.Struct({
  /** Bar identity; daily bars use the exchange-local start of the date. */
  time: Schema.Finite.check(Schema.isInt()),
  open: Schema.Finite,
  high: Schema.Finite,
  low: Schema.Finite,
  close: Schema.Finite,
  volume: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Provider observation time, not the exchange's last trade time. */
  asOf: Schema.Finite.check(Schema.isInt()),
});

/**
 * Yahoo chart OHLCV, using its split-adjusted quote columns. No dividend
 * adjustment or unadjusted reconstruction is implied. Updates are delayed
 * polling observations, not individual exchange ticks.
 * @example const query = {symbol: '0700.HK', interval: '1m', includePrePost: false, time: {}, count: 500};
 */
export const yfinanceBars = defineDataset({
  name: "yfinance.bars",
  keys: Schema.Struct({
    symbol: k.eq(Schema.NonEmptyString),
    interval: k.eq(YFinanceInterval),
    includePrePost: k.eq(Schema.Boolean),
    time: k.range(Schema.Finite.check(Schema.isInt())),
  }),
  schema: yfinanceBarsRow,
  layout: Layout.Timeseries,
  access: { select: true, stream: true },
});
