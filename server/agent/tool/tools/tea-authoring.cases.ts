// Purpose: Independent requirements and two datasets per real-Agent Tea authoring case.
import type * as Tea from "@openchart/tea";

/** Completed bars for a node and, by request name, for each of its request children. */
export type Dataset = {
  readonly rows: Tea.Samples["rows"];
  readonly requests: Readonly<Record<string, Dataset>>;
};

const bars = (
  closes: number[],
  options: { opens?: number[]; volumes?: number[] } = {},
): Dataset => ({
  rows: closes.map((close, index) => {
    const open = options.opens?.[index] ?? close;
    return {
      time: (index + 1) * 60_000,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: options.volumes?.[index] ?? 1,
    };
  }),
  requests: {},
});
const bullish = (flags: boolean[]) =>
  bars(
    flags.map(() => 10),
    { opens: flags.map((flag) => (flag ? 9 : 11)) },
  );
const volume = (values: number[]) =>
  bars(
    values.map(() => 10),
    { volumes: values },
  );
const pair = (root: number[], peer: number[]): Dataset => ({
  ...bars(root),
  requests: { peer: bars(peer) },
});
const multiTimeframe = (reverse: boolean): Dataset => {
  const closes = [
    ...Array<number>(72).fill(100),
    ...Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 101 : 99)),
  ];
  for (const [row, above] of [
    [83, !reverse],
    [87, reverse],
    [91, !reverse],
    [95, reverse],
  ] as const)
    closes[row - 1] = above ? 102 : 99;
  const root = bars(closes);
  // The same listing's hourly final close must equal its last 15m close.
  // The last supplied hour has not finished anywhere in the root window.
  const hourly = bars([
    ...Array.from({ length: 23 }, (_, i) => closes[(i + 1) * 4 + 2]!),
    500,
  ]);
  return {
    rows: root.rows.map((row) => ({ ...row, time: row.time * 15 })),
    requests: {
      peer: {
        rows: hourly.rows.map((row) => ({ ...row, time: row.time * 60 })),
        requests: {},
      },
    },
  };
};

// Invert Wilder's recurrence to prescribe RSI values independently of Tea.
// Fourteen alternating changes seed equal average gains/losses (RSI 50).
const rsiPath = (targets: number[], gap = false): Dataset => {
  const closes = Array.from({ length: 15 }, (_, i) => 100 + (i % 2));
  let gain = 0.5;
  let loss = 0.5;
  for (const target of targets) {
    gain *= 13 / 14;
    loss *= 13 / 14;
    const ratio = target / (100 - target);
    const change =
      gain / loss < ratio
        ? 14 * (ratio * loss - gain)
        : -14 * (gain / ratio - loss);
    closes.push(closes.at(-1)! + change);
    gain += Math.max(change, 0) / 14;
    loss += Math.max(-change, 0) / 14;
  }
  const data = bars(closes);
  return {
    ...data,
    rows: data.rows.map((row, i) => ({
      ...row,
      time: row.time * 15 + (gap && i >= 20 ? 86_400_000 : 0),
    })),
  };
};

const relativeStrength = (ratios: number[], missing?: number): Dataset => {
  const data = pair(
    ratios.map((value) => value * 100),
    ratios.map(() => 100),
  );
  const daily = (rows: Dataset["rows"]) =>
    rows.map((row) => ({
      ...row,
      time: row.time * 1440,
    }));
  return {
    rows: daily(data.rows),
    requests: {
      peer: {
        rows: daily(data.requests.peer!.rows).map((row, i) => ({
          ...row,
          close: i === missing ? null : row.close,
        })),
        requests: {},
      },
    },
  };
};

const alternatingRatios = Array.from(
  { length: 20 },
  (_, i) => 1 + (i % 2) * 0.02,
);

const squeezeBreakout = (wide: boolean): Dataset => {
  const closes = wide
    ? [
        ...Array<number>(20).fill(100),
        104,
        ...Array<number>(10).fill(104),
        104.5,
        105,
      ]
    : [
        ...Array<number>(20).fill(100),
        101.2,
        102,
        ...Array<number>(10).fill(102),
        102.5,
        103,
      ];
  const initial = [
    ...Array<number>(15).fill(100),
    ...Array<number>(5).fill(50),
  ];
  const volumes = wide
    ? [...initial, 200, ...Array<number>(10).fill(20), 200, 200]
    : [...initial, 132, 200, ...Array<number>(10).fill(20), 200, 200];
  const data = bars(closes, { volumes });
  return {
    ...data,
    rows: data.rows.map((row, i) => ({
      ...row,
      time: row.time * 1440,
      high: i < 20 ? (wide ? 103 : 101) : row.close! + 0.2,
      low: i < 20 ? (wide ? 97 : 99) : row.close! - 0.2,
    })),
  };
};

/** Expected positions are hand-derived from requirements, never from generated Tea. */
export const authoringCases = [
  {
    id: "19-squeeze-breakout",
    listing: { symbol: "SPY", currency: "USD" },
    requirement:
      "Agent's declared defaults: prior 10-bar range at most 3%, prior 5/20-bar volume ratio threshold 0.8, close above prior high by 0.1%, volume at least 1.5x baseline; after a signal require ten entirely subsequent setup bars. Tight-range first signal/rearm and wide-range rejection are independently constructed.",
    samples: squeezeBreakout(false),
    expected: [21, 33],
    heldout: squeezeBreakout(true),
    heldoutExpected: [32],
  },
  {
    id: "17-rsi-rearm",
    listing: { symbol: "ETHUSDT", currency: "USDT" },
    requirement:
      "RSI14 below 30 arms one subsequent upward crossing of 40. Every crossing consumes the arm, including a suppressed crossing. Successful events must be at least eight completed bars apart. A timestamp gap does not expire a bar-count cooldown.",
    samples: rsiPath([
      20, 39, 45, 50, 25, 45, 35, 45, 45, 45, 45, 25, 45, 25, 45, 25, 35, 35,
      39, 39, 45, 50,
    ]),
    expected: [18, 28, 36],
    heldout: rsiPath(
      [45, 35, 45, 20, 45, 20, 45, 35, 45, 45, 20, 35, 45],
      true,
    ),
    heldoutExpected: [20, 28],
  },
  {
    id: "18-pair-zscore",
    listing: { symbol: "QQQ", currency: "USD" },
    requirement:
      "QQQ/SPY daily close ratio uses a complete 20-bar population z-score. Cross from <=2 to >2 only. A missing paired price or zero standard deviation cannot fire; event messages identify both listings and computed values.",
    samples: relativeStrength([
      ...alternatingRatios,
      1.3,
      1.4,
      1,
      1.5,
      1,
      ...Array<number>(20).fill(1),
      2,
    ]),
    expected: [21, 24],
    heldout: relativeStrength(
      [...alternatingRatios, 1.3, 1.4, 1, 1.5, 1, ...alternatingRatios, 1.5],
      20,
    ),
    heldoutExpected: [46],
  },
  {
    id: "13-crypto-mtf",
    listing: { symbol: "BTCUSDT", currency: "USDT" },
    requirement:
      "Binance BTCUSDT 15-minute EMA9 crosses above EMA21, and the most recent completed hourly bar closes above its SMA20. Sample time is the bar open time: at the decision point, which is the parent open time plus 15 minutes, use only hourly bars whose open time plus 1 hour is no later than that decision point.",
    samples: multiTimeframe(false),
    expected: [83, 91, 93],
    heldout: multiTimeframe(true),
    heldoutExpected: [87, 89, 95],
  },
  {
    id: "11-hk-breakout",
    listing: { symbol: "0700.HK", currency: "HKD" },
    requirement:
      "Tencent (Hong Kong) daily close is strictly above the highest price of the prior 20 days, and volume is strictly above 1.5 times the average volume of the prior 20 days; both windows exclude the current day, and it can fire only once the full history is available.",
    samples: bars([...Array<number>(20).fill(10), 11, 12, 12, 13, 14, 13, 15], {
      volumes: [...Array<number>(20).fill(10), 15, 16, 100, 10, 20, 20, 40],
    }),
    expected: [22, 27],
    heldout: bars([...Array<number>(20).fill(20), 21, 22, 20, 23], {
      volumes: [...Array<number>(20).fill(8), 13, 12, 9, 20],
    }),
    heldoutExpected: [21, 24],
  },
  {
    id: "12-jp-decline",
    listing: { symbol: "7203.T", currency: "JPY" },
    requirement:
      "Tokyo-listed Toyota's daily close falls at least 3% from the previous close, and the day closes as a bearish candle; fire only when both conditions hold at the same time.",
    samples: bars([100, 97, 94.09, 94, 90, 87.3, 90], {
      opens: [100, 98, 93, 100, 89, 88, 89],
    }),
    expected: [2, 6],
    heldout: bars([200, 194, 180, 182, 170, 170], {
      opens: [200, 193, 181, 183, 171, 180],
    }),
    heldoutExpected: [3, 5],
  },
  {
    id: "01-cross-up",
    requirement:
      "Fire when the close goes from <= 50 on the previous bar to > 50 on the current bar. The first bar has no previous value and does not fire; staying above 50 or being exactly 50 does not fire.",
    samples: bars([49, 50, 51, 52, 50, 51]),
    expected: [3, 6],
    heldout: bars([60, 60, 49, 51, 50, 49, 51]),
    heldoutExpected: [4, 7],
  },
  {
    id: "02-cross-down",
    requirement:
      "Fire when the close goes from >= 50 on the previous bar to < 50 on the current bar. The first bar has no previous value and does not fire; staying below 50 or being exactly 50 does not fire.",
    samples: bars([51, 50, 49, 48, 50, 49]),
    expected: [3, 6],
    heldout: bars([40, 40, 51, 49, 50, 51, 49]),
    heldoutExpected: [4, 7],
  },
  {
    id: "20-claude-sma-cross",
    requirement:
      "AAPL daily close crosses above the SMA20 that includes the current day; evaluate only once both the current and the previous day's SMA are complete. Staying above the SMA does not fire again, and being equal to the SMA does not fire.",
    samples: bars([
      ...Array<number>(20).fill(100),
      100,
      102,
      104,
      99,
      100,
      110,
    ]),
    expected: [22, 26],
    heldout: bars([
      ...Array<number>(19).fill(100),
      120,
      120,
      90,
      100,
      110,
      110,
      90,
      120,
    ]),
    heldoutExpected: [24, 27],
  },
  {
    id: "03-sma-cross",
    requirement:
      "Fire when the close crosses above the 3-bar simple moving average of closes that includes the current bar: previous close <= previous SMA, and current close > current SMA. Both the current and the previous SMA require a complete 3-bar history.",
    samples: bars([1, 2, 3, 2, 4, 5, 1, 4]),
    expected: [5, 8],
    heldout: bars([5, 4, 3, 2, 4, 6, 3, 2, 6]),
    heldoutExpected: [5, 9],
  },
  {
    id: "04-prior-high",
    requirement:
      "Fire on every qualifying completed bar whose close is strictly above the maximum high of the previous 3 bars. The window excludes the current bar and requires a complete 3-bar history; equality does not fire.",
    samples: bars([1, 2, 3, 4, 4, 5, 2, 6]),
    expected: [4, 6, 8],
    heldout: bars([9, 8, 7, 8, 9, 10, 9, 11]),
    heldoutExpected: [5, 6, 8],
  },
  {
    id: "05-streak",
    requirement:
      "Each run of consecutive bullish bars (close > open) fires only once, on its 3rd bar; the 4th and later bars do not fire. Any non-bullish bar resets the run, and another 3 consecutive bullish bars can fire again.",
    samples: bullish([true, true, true, true, false, true, true, true, true]),
    expected: [3, 8],
    heldout: bullish([
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
    ]),
    heldoutExpected: [7, 13],
  },
  {
    id: "06-cooldown",
    requirement:
      "Fire when close > 50, but the bar indexes of any two events must differ by at least 3. The first bar that meets the condition can fire; after the cooldown, it can fire again whenever the condition is true, without requiring a new cross. Count the cooldown in bars.",
    samples: bars([51, 51, 51, 51, 40, 51, 51, 51, 51]),
    expected: [1, 4, 7],
    heldout: bars([49, 51, 49, 51, 51, 51, 51, 51]),
    heldoutExpected: [2, 5, 8],
  },
  {
    id: "07-volume",
    requirement:
      "The user asks only for a volume-spike alert; before writing code, the Agent explicitly chooses 2 times the average volume of the prior 20 trading days, excluding the current day. The expectations below are derived independently from this stated default.",
    samples: volume([...Array<number>(20).fill(10), 20, 30, 10, 30, 30, 10]),
    expected: [22, 24, 25],
    heldout: volume([...Array<number>(20).fill(5), 11, 0, 12, 13, 5, 20]),
    heldoutExpected: [21, 23, 24, 26],
  },
  {
    id: "08-combined",
    requirement:
      "Fire when the current close is up at least 5% from the previous close and the current bar is bullish (close > open). Both conditions must hold; the first bar does not fire, and it does not fire when the previous close is non-positive or missing.",
    samples: bars([100, 105, 110.25, 100, 105, 120], {
      opens: [100, 100, 120, 95, 104, 120],
    }),
    expected: [2, 5],
    heldout: bars([200, 210, 220, 240, 252], {
      opens: [190, 220, 200, 230, 250],
    }),
    heldoutExpected: [4, 5],
  },
  {
    id: "09-payload",
    requirement:
      "Fire when the close goes from <= 50 on the previous bar to > 50 on the current bar. The event data must be a struct containing price (the actual close) and symbol (the current ticker), and the message must include the current ticker and the actual close.",
    samples: bars([49, 50, 51, 52, 50, 53]),
    expected: [3, 6],
    heldout: bars([60, 60, 49, 54, 50, 49, 55]),
    heldoutExpected: [4, 7],
  },
  {
    id: "10-request",
    requirement:
      "Also request MSFT daily closes. Fire when the AAPL close goes from <= the MSFT close at the same time on the previous bar to > the MSFT close at the same time on the current bar. The event belongs to AAPL. The first bar does not fire. The two streams align one-to-one in time; peer is only the test data slot name and does not constrain the script's binding name.",
    samples: pair([10, 11, 12, 9, 10, 12], [11, 10, 11, 10, 10, 11]),
    expected: [2, 6],
    heldout: pair([15, 10, 8, 12, 9, 14], [14, 11, 9, 11, 10, 13]),
    heldoutExpected: [4, 6],
  },
];

// Numeric references are independent of the authored Tea and chart output IDs.
export const indicatorSamples: readonly Dataset[] = [
  bars(
    Array.from({ length: 45 }, (_, i) => 100 + i * 0.4 + 8 * Math.sin(i * 0.7)),
  ),
  bars(
    Array.from({ length: 45 }, (_, i) => (i < 20 ? 100 : i < 30 ? 120 : 90)),
  ),
].map((samples) => ({
  rows: samples.rows.map((row, i) => ({
    ...row,
    time: (i + 1) * 86_400_000,
    high: row.close! + 2,
    low: row.close! - 1,
    volume: null,
  })),
  requests: {},
}));

/** EMA20, population Bollinger20×2, Wilder RSI14 and SMA20±2×Wilder ATR14. */
export function indicatorExpected(samples: Dataset) {
  const close = samples.rows.map((row) => row.close!);
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  const basis = close.map((_, i) =>
    i < 19 ? NaN : mean(close.slice(i - 19, i + 1)),
  );
  const spread = close.map((_, i) =>
    i < 19
      ? NaN
      : 2 *
        Math.sqrt(
          mean(
            close.slice(i - 19, i + 1).map((value) => (value - basis[i]!) ** 2),
          ),
        ),
  );
  const ema: number[] = [];
  close.forEach((value, i) =>
    ema.push(i === 0 ? value : value * (2 / 21) + ema[i - 1]! * (19 / 21)),
  );
  const wilder = (values: number[]) => {
    const output: number[] = [];
    let current = NaN;
    const seed: number[] = [];
    for (const value of values) {
      if (!Number.isNaN(value)) {
        if (Number.isNaN(current)) {
          seed.push(value);
          if (seed.length === 14) current = mean(seed);
        } else current = (13 * current + value) / 14;
      }
      output.push(current);
    }
    return output;
  };
  const delta = close.map((value, i) =>
    i === 0 ? NaN : value - close[i - 1]!,
  );
  const gain = wilder(delta.map((value) => Math.max(value, 0)));
  const loss = wilder(delta.map((value) => Math.max(-value, 0)));
  const rsi = gain.map((value, i) =>
    loss[i] === 0 ? 100 : value === 0 ? 0 : 100 - 100 / (1 + value / loss[i]!),
  );
  const atr = wilder(
    samples.rows.map((row, i) =>
      Math.max(
        row.high! - row.low!,
        i === 0 ? 0 : Math.abs(row.high! - close[i - 1]!),
        i === 0 ? 0 : Math.abs(row.low! - close[i - 1]!),
      ),
    ),
  );
  return {
    ema,
    basis,
    bbUpper: basis.map((value, i) => value + spread[i]!),
    bbLower: basis.map((value, i) => value - spread[i]!),
    rsi,
    atrUpper: basis.map((value, i) => value + 2 * atr[i]!),
    atrLower: basis.map((value, i) => value - 2 * atr[i]!),
  };
}
