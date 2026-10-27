// Purpose: Describe TradingView chart candles and their requested series identity.

import { Schema } from "effect";
import { Adjustment, Resolution } from "@openchart/feed";
import { SessionType } from "@openchart/market";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

/** Provider-native candle; `time` is the bar open in Unix milliseconds. */
export const tradingviewBarsRow = Schema.Struct({
  time: Schema.Finite.check(Schema.isInt()),
  open: Schema.Finite,
  high: Schema.Finite,
  low: Schema.Finite,
  close: Schema.Finite,
  volume: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Client-local socket receipt order; not an upstream revision or finality. */
  receivedSequence: Schema.Finite.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
  ),
});

/**
 * TradingView chart candles in its own symbol namespace. `symbol` is the full
 * `EXCHANGE:SYMBOL` identity, so the exchange never separates from the symbol.
 * Every series is requested at one adjustment and session coverage; TradingView
 * applies them in `resolve_symbol` and the Feed rejects combinations it lacks.
 * @example const query = {symbol: 'NASDAQ:AAPL', resolution: '1m', session: 'regular', adjustment: 'split', time: {}, count: 500};
 */
export const tradingviewBars = defineDataset({
  name: "tradingview.bars",
  keys: Schema.Struct({
    symbol: k.eq(Schema.NonEmptyString),
    resolution: k.eq(Resolution),
    session: k.eq(SessionType),
    adjustment: k.eq(Adjustment),
    time: k.range(Schema.Finite.check(Schema.isInt())),
  }),
  schema: tradingviewBarsRow,
  layout: Layout.Timeseries,
  access: { select: true, stream: true },
});
