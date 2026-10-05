// Purpose: Prove curated studies run on supplied OHLCV, keep past signals stable and match independent formula references.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DataStream, tea, type Datum } from "tea";
import { from } from "rxjs";
import { Bool, Field, Int64, Schema } from "apache-arrow";
import { featuredStudies, featuredHeroIds } from "./featured-studies";

type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
const bars: Bar[] = Array.from({ length: 360 }, (_, i) => {
  const close = 100 + i * 0.03 + Math.sin(i / 7) * (8 + Math.sin(i / 37) * 5);
  const open = close + Math.cos(i / 3) * 1.4;
  return {
    time: Date.UTC(2024, 0, i + 1),
    open,
    high: Math.max(open, close) + 1.2,
    low: Math.min(open, close) - 1.1,
    close,
    volume: i % 47 === 0 ? 5000 + i : 1000 + (i % 17) * 43,
  };
});

async function execute(
  id: string,
  input: readonly Bar[],
  provisionalLast = false,
) {
  const source = await readFile(
    new URL(`./builtins/${id}.tea`, import.meta.url),
    "utf8",
  );
  const node = tea`${source}`;
  const rows = input.map((bar, index) => {
    const values: Record<string, number> = {
      ...bar,
      hl2: (bar.high + bar.low) / 2,
      hlc3: (bar.high + bar.low + bar.close) / 3,
      ohlc4: (bar.open + bar.high + bar.low + bar.close) / 4,
    };
    return {
      ...Object.fromEntries(
        node.module.inputs.schema.fields.map((field) => [
          field.name,
          values[field.name],
        ]),
      ),
      time: BigInt(bar.time),
      provisional: provisionalLast && index === input.length - 1,
    };
  });
  const inputSchema = new Schema([
    ...node.module.inputs.schema.fields,
    new Field("time", new Int64(), false),
    new Field("provisional", new Bool(), false),
  ]);
  const run = node.bind(new DataStream(inputSchema, from(rows)));
  const output: Datum[] = [];
  try {
    await new Promise<void>((resolve, reject) =>
      run.to({
        next: (row) => output.push(structuredClone(row)),
        error: reject,
        complete: resolve,
      }),
    );
    return output;
  } finally {
    run.dispose();
    node.dispose();
  }
}
function series(row: Datum, output: string): number {
  return (row[output] as { series: number }).series;
}
function noInfinity(value: unknown): boolean {
  if (typeof value === "number")
    return Number.isFinite(value) || Number.isNaN(value);
  if (value !== null && typeof value === "object")
    return Object.values(value).every(noInfinity);
  return true;
}

describe("curated studies", () => {
  it("curates thirty distinct studies across six purposes and six complementary introductions", () => {
    expect(featuredStudies).toHaveLength(30);
    expect(new Set(featuredStudies.map((study) => study.id)).size).toBe(30);
    const primary = featuredStudies.map((study) => study.goals[0]);
    expect(new Set(primary).size).toBe(6);
    for (const goal of new Set(primary))
      expect(primary.filter((item) => item === goal)).toHaveLength(5);
    expect(featuredHeroIds).toHaveLength(6);
    for (const id of featuredHeroIds)
      expect(featuredStudies.some((study) => study.id === id)).toBe(true);
  });
  for (const study of featuredStudies) {
    it(`${study.name} executes without infinities or changing previously confirmed rows`, async () => {
      const output = await execute(study.id, bars);
      expect(output).toHaveLength(bars.length);
      expect(output.every(noInfinity)).toBe(true);
      expect(Object.values(output.at(-1)!).length).toBeGreaterThan(1);
      const prefix = await execute(study.id, bars.slice(0, 280));
      expect(output.slice(0, 280)).toEqual(prefix);
      const flat = await execute(
        study.id,
        bars.slice(0, 120).map((bar) => ({
          ...bar,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          volume: 0,
        })),
      );
      expect(flat.every(noInfinity)).toBe(true);
    }, 20_000);
  }
});

it("money flow matches the independently summed 21-bar contribution", async () => {
  const output = await execute("money-flow-pressure", bars);
  const window = bars.slice(-21);
  const expected =
    window.reduce(
      (sum, bar) =>
        sum +
        ((2 * bar.close - bar.low - bar.high) / (bar.high - bar.low)) *
          bar.volume,
      0,
    ) / window.reduce((sum, bar) => sum + bar.volume, 0);
  expect(series(output.at(-1)!, "flow")).toBeCloseTo(expected, 10);
});

it("volume-anchored VWAP resets only on a prior-window volume record and matches weighted moments", async () => {
  const output = await execute("anchored-vwap-bands", bars);
  let weight = 0,
    price = 0,
    square = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const anchor =
      i >= 63 &&
      bar.volume >
        Math.max(
          ...bars.slice(Math.max(0, i - 63), i).map((item) => item.volume),
        );
    if (anchor) {
      weight = 0;
      price = 0;
      square = 0;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    weight += bar.volume;
    price += typical * bar.volume;
    square += typical * typical * bar.volume;
    const mean = price / weight;
    expect(series(output[i]!, "vwap")).toBeCloseTo(mean, 8);
    expect(series(output[i]!, "upper")).toBeCloseTo(
      mean + 1.5 * Math.sqrt(Math.max(0, square / weight - mean * mean)),
      6,
    );
  }
});

it("Donchian breakout uses only preceding bars for its range", async () => {
  const output = await execute("donchian-breakout", bars);
  for (let i = 20; i < bars.length; i++) {
    expect(series(output[i]!, "upper")).toBe(
      Math.max(...bars.slice(i - 20, i).map((bar) => bar.high)),
    );
    expect(series(output[i]!, "lower")).toBe(
      Math.min(...bars.slice(i - 20, i).map((bar) => bar.low)),
    );
  }
});

it("the regression envelope collapses onto a perfect line", async () => {
  const input = bars.map((bar, i) => ({ ...bar, close: 100 + 2 * i }));
  const output = await execute("regression-channel", input);
  const last = output.at(-1)!;
  expect(series(last, "regression")).toBeCloseTo(input.at(-1)!.close, 8);
  expect(series(last, "upper")).toBeCloseTo(input.at(-1)!.close, 7);
  expect(series(last, "lower")).toBeCloseTo(input.at(-1)!.close, 7);
});

it("swing annotations are reported only after five complete bars on both sides", async () => {
  const output = await execute("confirmed-swing-map", bars);
  let previousHigh: number | undefined;
  let previousLow: number | undefined;
  let count = 0;
  for (let i = 0; i < bars.length; i++) {
    const pivot = i - 5;
    const window = bars.slice(pivot - 5, pivot + 6);
    const high =
      i >= 10 &&
      window.every((bar, j) => j === 5 || bar.high < bars[pivot]!.high);
    const low =
      i >= 10 &&
      window.every((bar, j) => j === 5 || bar.low > bars[pivot]!.low);
    const hh =
      high && previousHigh !== undefined && bars[pivot]!.high > previousHigh;
    const lh =
      high && previousHigh !== undefined && bars[pivot]!.high < previousHigh;
    const hl =
      low && previousLow !== undefined && bars[pivot]!.low > previousLow;
    const ll =
      low && previousLow !== undefined && bars[pivot]!.low < previousLow;
    for (const [key, expected] of [
      ["higher_high", hh],
      ["lower_high", lh],
      ["higher_low", hl],
      ["lower_low", ll],
    ] as const) {
      expect(
        (output[i]![key] as { series: boolean }).series,
        `${i}/${key}`,
      ).toBe(expected);
      if (expected) count++;
    }
    if (high) previousHigh = bars[pivot]!.high;
    if (low) previousLow = bars[pivot]!.low;
  }
  expect(count).toBeGreaterThan(10);
});

it("RSI divergence compares confirmed price pivots and exposes both panes only at confirmation", async () => {
  const output = await execute("rsi-divergence", bars);
  let previousHigh: { index: number; price: number; value: number } | undefined;
  let previousLow: { index: number; price: number; value: number } | undefined;
  let count = 0;
  for (let i = 10; i < bars.length; i++) {
    const pivot = i - 5;
    const window = bars.slice(pivot - 5, pivot + 6);
    const high = window.every(
      (bar, j) => j === 5 || bar.high < bars[pivot]!.high,
    );
    const low = window.every((bar, j) => j === 5 || bar.low > bars[pivot]!.low);
    const value = series(output[pivot]!, "value");
    const bearish =
      high &&
      Number.isFinite(value) &&
      previousHigh !== undefined &&
      bars[pivot]!.high > previousHigh.price &&
      value < previousHigh.value &&
      pivot - previousHigh.index <= 100;
    const bullish =
      low &&
      Number.isFinite(value) &&
      previousLow !== undefined &&
      bars[pivot]!.low < previousLow.price &&
      value > previousLow.value &&
      pivot - previousLow.index <= 100;
    expect(
      (output[i]!.bear_confirmed as { series: boolean }).series,
      `bear/${i}`,
    ).toBe(bearish);
    expect(
      (output[i]!.bull_confirmed as { series: boolean }).series,
      `bull/${i}`,
    ).toBe(bullish);
    if (bearish || bullish) {
      const direction = bearish ? "bear" : "bull";
      const price = output[i]![`${direction}_price`] as {
        end_time: number;
        end_value: number;
        force_overlay: boolean;
      };
      const momentum = output[i]![`${direction}_momentum`] as {
        end_time: number;
        end_value: number;
        force_overlay: boolean;
      };
      expect(price.end_time).toBe(bars[pivot]!.time);
      expect(momentum.end_time).toBe(bars[pivot]!.time);
      expect(momentum.end_value).toBe(value);
      expect(price.force_overlay).toBe(true);
      expect(momentum.force_overlay).toBe(false);
      count++;
    }
    if (high) previousHigh = { index: pivot, price: bars[pivot]!.high, value };
    if (low) previousLow = { index: pivot, price: bars[pivot]!.low, value };
  }
  expect(count).toBeGreaterThan(0);
});

it("Heikin-Ashi emits independently derived candle values rather than relabeling market OHLC", async () => {
  const output = await execute("heikin-ashi-trend", bars);
  let previousOpen = (bars[0]!.open + bars[0]!.close) / 2;
  let previousClose =
    (bars[0]!.open + bars[0]!.high + bars[0]!.low + bars[0]!.close) / 4;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const open = i === 0 ? previousOpen : (previousOpen + previousClose) / 2;
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const candle = output[i]!.averaged_candles as {
      open: number;
      high: number;
      low: number;
      close: number;
    };
    expect(candle.open).toBeCloseTo(open, 10);
    expect(candle.close).toBeCloseTo(close, 10);
    expect(candle.high).toBeCloseTo(Math.max(bar.high, open, close), 10);
    expect(candle.low).toBeCloseTo(Math.min(bar.low, open, close), 10);
    previousOpen = open;
    previousClose = close;
  }
});

it("a three-bar gap appears at confirmation, extends while open and records its far-edge fill", async () => {
  const input = bars
    .slice(0, 23)
    .map((bar) => ({ ...bar, open: 100, high: 101, low: 99, close: 100 }));
  input[19] = { ...input[19]!, high: 103 };
  input[20] = { ...input[20]!, open: 104.5, high: 106, low: 104, close: 105 };
  input[21] = { ...input[21]!, open: 104, high: 105, low: 102, close: 103 };
  input[22] = { ...input[22]!, open: 103, high: 104, low: 100, close: 102 };
  const output = await execute("fair-value-gaps", input);
  expect((output[20]!.bull_formed as { series: boolean }).series).toBe(true);
  expect(
    output[20]!.bull_gap as { start_time: number; top: number; bottom: number },
  ).toMatchObject({ start_time: input[18]!.time, top: 104, bottom: 101 });
  expect((output[21]!.bull_gap as { end_time: number }).end_time).toBe(
    input[21]!.time,
  );
  expect((output[21]!.filled as { series: boolean }).series).toBe(false);
  expect((output[22]!.filled as { series: boolean }).series).toBe(true);
  const unfinished = await execute("fair-value-gaps", input.slice(0, 21), true);
  expect((unfinished.at(-1)!.bull_formed as { series: boolean }).series).toBe(
    false,
  );
});

it("divergence waits for the confirmation bar to close", async () => {
  const output = await execute("rsi-divergence", bars);
  const index = output.findIndex(
    (row) =>
      (row.bear_confirmed as { series: boolean }).series ||
      (row.bull_confirmed as { series: boolean }).series,
  );
  expect(index).toBeGreaterThan(0);
  const unfinished = await execute(
    "rsi-divergence",
    bars.slice(0, index + 1),
    true,
  );
  expect(
    (unfinished.at(-1)!.bear_confirmed as { series: boolean }).series,
  ).toBe(false);
  expect(
    (unfinished.at(-1)!.bull_confirmed as { series: boolean }).series,
  ).toBe(false);
});
