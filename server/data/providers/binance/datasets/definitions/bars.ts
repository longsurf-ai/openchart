// Purpose: Describe Binance Spot UTC klines without provider I/O or Feed semantics.

import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

/** Binance's native interval names; uppercase M means a calendar month. */
export const BinanceInterval = Schema.Literals([
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
]);
/** Provider-native observation schema. */
export const binanceBarsRow = Schema.Struct({
  time: Schema.Finite.check(Schema.isInt()),
  open: Schema.Finite,
  high: Schema.Finite,
  low: Schema.Finite,
  close: Schema.Finite,
  volume: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  trades: Schema.Finite.check(Schema.isInt()).check(
    Schema.isGreaterThanOrEqualTo(0),
  ),
  final: Schema.Boolean,
  asOf: Schema.Finite.check(Schema.isInt()),
});

/**
 * Unadjusted Spot OHLCV. Time bounds are inclusive/exclusive milliseconds.
 * `trades` orders REST and WebSocket observations of the same bucket; `asOf`
 * is the WebSocket event time or REST observation time, not a global revision.
 * @example const query = {symbol: 'BTCUSDT', interval: '1m', time: {}, count: 500};
 */
export const binanceBars = defineDataset({
  name: "binance.bars",
  keys: Schema.Struct({
    symbol: k.eq(Schema.NonEmptyString),
    interval: k.eq(BinanceInterval),
    time: k.range(Schema.Finite.check(Schema.isInt())),
  }),
  schema: binanceBarsRow,
  layout: Layout.Timeseries,
  access: { select: true, stream: true },
});
