// Purpose: Reduce selected OHLC bars to a bounded, factual Chart Explain brief.

import type { Resolution } from "@openchart/feed";

/** The finite bar values Chart Explain uses; Feed retains its native DataFrame. */
export interface RangeBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** One material move between a pair of selected bars. */
export interface PriceWave {
  readonly from: number;
  readonly to: number;
  readonly startPrice: number;
  readonly endPrice: number;
  readonly changePct: number;
  readonly bars: number;
}

/** Bounded facts used to write a chart selection prompt. */
export interface RangeBrief {
  readonly from: number;
  readonly to: number;
  readonly bars: number;
  readonly open: number;
  readonly close: number;
  readonly changePct: number;
  readonly high: number;
  readonly low: number;
  readonly waves: readonly PriceWave[];
}

// V1's resolution floors keep ordinary bar noise from becoming a new wave.
const baseReversalPct: Record<Resolution, number> = {
  "1s": 0.35,
  "1m": 0.45,
  "5m": 0.6,
  "15m": 0.8,
  "30m": 1,
  "1h": 1.25,
  "4h": 1.75,
  "1d": 2.5,
  "1W": 5,
  "1M": 8,
};

const percentChange = (from: number, to: number) => (to / from - 1) * 100;

function reversalThreshold(bars: readonly RangeBar[], resolution: Resolution) {
  // A handful of returns cannot establish a stable volatility estimate. V1 also
  // cuts short ranges at observable features, so retain the resolution floor.
  if (bars.length < 10) return baseReversalPct[resolution];
  const returns = bars
    .slice(1)
    .map((bar, index) => percentChange(bars[index]!.close, bar.close));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.length < 2
      ? 0
      : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (returns.length - 1);
  const trueRange = bars.map((bar, index) => {
    const previous = bars[index - 1]?.close ?? bar.open;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous),
      Math.abs(bar.low - previous),
    );
  });
  const averageTrueRange =
    trueRange.reduce((sum, value) => sum + value, 0) / trueRange.length;
  return Math.max(
    baseReversalPct[resolution],
    Math.sqrt(variance) * 1.25,
    (averageTrueRange / bars[0]!.close) * 75,
  );
}

/**
 * Turn close-price reversals into at most four time-ordered waves.
 *
 *   reversal threshold
 *     < 10 bars:  resolution floor (1d = 2.5%)
 *    >= 10 bars: max(floor, 1.25 * stdev(close returns %),
 *                    75 * mean(true range) / first close)
 *
 *   Example: 1d, four bars, first open = 100; threshold = 2.5%
 *
 *   bar         0             1             2             3
 *   close     100           110           105           112
 *   trend      |---- up ---->|--- down --->|---- up ---->|
 *   point    start         peak         trough         end
 *                             ^             ^
 *   cut confirmed at         bar 2         bar 3
 *
 *   cuts       0             1             2             3 (end)
 *              |-------------|-------------|-------------|
 *   waves        +10.00%        -4.55%        +6.67%
 *
 *   all waves -> largest 4 by |changePct| -> chronological order
 *   First wave starts at bar 0's open; later waves start at the cut's close.
 *   Bar data identifies moves, not their causes.
 * @example summarizeRange(bars, "1d");
 */
export function summarizeRange(
  bars: readonly RangeBar[],
  resolution: Resolution,
): RangeBrief {
  if (bars.length === 0) throw new Error("Chart Explain needs selected bars.");
  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const threshold =
    bars.length > 1 ? reversalThreshold(bars, resolution) : Infinity;
  const cuts = [0];
  let direction: "up" | "down" | undefined;
  let low = 0;
  let high = 0;
  let extreme = 0;

  for (let index = 1; index < bars.length; index++) {
    const close = bars[index]!.close;
    if (!direction) {
      if (close < bars[low]!.close) low = index;
      if (close > bars[high]!.close) high = index;
      if (percentChange(bars[low]!.close, close) >= threshold) {
        direction = "up";
        cuts.push(low);
        extreme = index;
      } else if (percentChange(bars[high]!.close, close) <= -threshold) {
        direction = "down";
        cuts.push(high);
        extreme = index;
      }
      continue;
    }
    if (direction === "up") {
      if (close > bars[extreme]!.close) extreme = index;
      else if (percentChange(bars[extreme]!.close, close) <= -threshold) {
        cuts.push(extreme);
        direction = "down";
        extreme = index;
      }
    } else if (close < bars[extreme]!.close) extreme = index;
    else if (percentChange(bars[extreme]!.close, close) >= threshold) {
      cuts.push(extreme);
      direction = "up";
      extreme = index;
    }
  }
  cuts.push(bars.length - 1);
  const boundaries = [...new Set(cuts)].sort((a, b) => a - b);
  const waves = boundaries.slice(1).map((end, index): PriceWave => {
    const start = boundaries[index]!;
    const opening = start === 0 ? bars[start]!.open : bars[start]!.close;
    const closing = bars[end]!.close;
    return {
      from: bars[start]!.time,
      to: bars[end]!.time,
      startPrice: opening,
      endPrice: closing,
      changePct: percentChange(opening, closing),
      bars: end - start + 1,
    };
  });
  return {
    from: first.time,
    to: last.time,
    bars: bars.length,
    open: first.open,
    close: last.close,
    changePct: percentChange(first.open, last.close),
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    waves: [...waves]
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 4)
      .sort((a, b) => a.from - b.from),
  };
}
