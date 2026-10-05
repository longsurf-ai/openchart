// Purpose: A Source's stream and the fixed market context of its series behave the same for every reader.
import { Effect, Exit, Schema, Scope } from "effect";
import { tea, timeframeClock } from "tea";
import { expect, test } from "vitest";
import { BarsSeries, Resolution } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import type { DataFrameRow } from "@openchart/timeseries";
import type { FeedServices } from "@openchart/server/feed/service";
import { makeSource, marketContext, runResolution } from "./source";

// A Feed row as a frame yields it; `time` is epoch milliseconds.
const bar = (row: { readonly time: number } & Record<string, unknown>) =>
  row as DataFrameRow;

test("real source timing reaches visual geometry without changing the market timestamp", async () => {
  const scope = Effect.runSync(Scope.make());
  const input = Effect.runSync(
    makeSource(
      {
        _tag: "Samples",
        provider: "yfinance" as Tea.Samples["provider"],
        listing: { symbol: "AAPL", currency: "USD" },
        resolution: "1d",
        session: "regular",
        adjustment: "split",
        schema: Tea.barsSchema,
        rows: [],
      },
      ["close"],
      "study timing",
    ).pipe(Scope.provide(scope)),
  );
  const node = tea`plotsegment("segment", time, close, time, close, color=color.red)`;
  const run = node.bind(input.stream);
  const results: unknown[] = [];
  try {
    const completed = new Promise<void>((resolve, reject) =>
      run.to({
        next: (row) => results.push(row.segment),
        error: reject,
        complete: resolve,
      }),
    );
    input.send(bar({ time: 1704205800000, close: 100 }), false);
    input.complete();
    await completed;
    expect(results).toMatchObject([
      { start_time: 1704205800000, end_time: 1704205800000, start_value: 100 },
    ]);
  } finally {
    run.dispose();
    node.dispose();
    Effect.runSync(Scope.close(scope, Exit.void));
  }
});

test("a Source carries its columns as numbers, derives composite prices, closes a bar when the next one arrives and ends with its Scope", () => {
  const hourly = Schema.decodeUnknownSync(BarsSeries)({
    provider: "binance",
    listing: { symbol: "BTCUSDT", currency: "USDT" },
    resolution: "1h",
    session: "24h",
    adjustment: "raw",
  });
  const scope = Effect.runSync(Scope.make());
  const input = Effect.runSync(
    makeSource(
      Tea.barsInputs(hourly).inputs.bars! as Tea.Bars,
      ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"],
      "input 'bars' at root",
    ).pipe(Scope.provide(scope)),
  );
  expect(input.stream.schema.fields.map((field) => field.name)).toEqual([
    "time",
    "provisional",
    "open",
    "high",
    "low",
    "close",
    "hl2",
    "hlc3",
    "ohlc4",
    "hlcc4",
  ]);
  expect(input.stream.clock).toBe(timeframeClock("60"));
  const rows: unknown[] = [];
  let ended = false;
  input.stream.subscribe({
    next: (row) => rows.push(row),
    complete: () => (ended = true),
  });
  const row = { time: 0, open: 4, high: 12, low: 2, close: 10 };
  input.send(bar(row), true);
  // An explicit column wins over derivation, and a null leg gives NaN.
  input.send(bar({ ...row, time: 1, high: null, hl2: 99 }), false);
  expect(rows).toEqual([
    {
      time: 0,
      provisional: true,
      open: 4,
      high: 12,
      low: 2,
      close: 10,
      hl2: 7,
      hlc3: 8,
      ohlc4: 7,
      hlcc4: 8.5,
    },
    // The later bar first closes the provisional one.
    {
      time: 0,
      provisional: false,
      open: 4,
      high: 12,
      low: 2,
      close: 10,
      hl2: 7,
      hlc3: 8,
      ohlc4: 7,
      hlcc4: 8.5,
    },
    {
      time: 1,
      provisional: false,
      open: 4,
      high: NaN,
      low: 2,
      close: 10,
      hl2: 99,
      hlc3: NaN,
      ohlc4: NaN,
      hlcc4: NaN,
    },
  ]);
  expect(row).toEqual({ time: 0, open: 4, high: 12, low: 2, close: 10 });
  expect(() => input.send(bar({ ...row, time: 1 }), false)).toThrow(
    "Out-of-order input or committed revision in input 'bars' at root",
  );
  expect(() => input.send(bar({ ...row, time: 2, hl2: "7" }), false)).toThrow(
    "Input column 'hl2' must be numeric",
  );
  expect(() => input.send(bar({ time: 2 }), false)).toThrow("must be numeric");
  Effect.runSync(Scope.close(scope, Exit.void));
  expect(ended).toBe(true);
});

test("fixed market context is supplied only when every series gives the script the same values", () => {
  const node = tea`
    emit "period" timeframe.multiplier
    emit "symbol" syminfo.tickerid == "yfinance:MSFT"
    emit "ticker" syminfo.ticker == "MSFT"
    emit "prefix" syminfo.prefix == "yfinance"
  `;
  try {
    const series = Schema.decodeUnknownSync(BarsSeries)({
      provider: "yfinance",
      listing: { symbol: "MSFT", currency: "USD" },
      resolution: "4h",
      session: "regular",
      adjustment: "split",
    });
    const named = { ...series, listing: { ...series.listing, name: "Msft" } };
    const module = node.module.bind(
      {},
      marketContext(node.module.inputs, [series, named]),
    );
    expect(module.ready()).toBe(true);
    expect(
      Object.fromEntries(
        module.inputs.builtins.map((builtin) => [
          `${builtin.source.domain}.${builtin.source.field}`,
          builtin.value,
        ]),
      ),
    ).toMatchObject({
      "timeframe.multiplier": 240,
      "syminfo.ticker": "MSFT",
      "syminfo.tickerid": "yfinance:MSFT",
      "syminfo.prefix": "yfinance",
    });
    expect(
      node.module.inputs.builtins.every(
        (builtin) => builtin.value === undefined,
      ),
    ).toBe(true);
    const other = { ...series, listing: { ...series.listing, symbol: "AAPL" } };
    expect(marketContext(node.module.inputs, [series, other]).size).toBe(0);
    expect(marketContext(node.module.inputs, []).size).toBe(0);
  } finally {
    node.dispose();
  }
});

const all = Resolution.literals;
test.each<[Resolution, readonly Resolution[], Resolution]>([
  ["1s", all, "1s"],
  ["1m", all, "1m"],
  ["5m", all, "1m"],
  ["15m", all, "1m"],
  ["30m", all, "1m"],
  ["1h", all, "5m"],
  ["4h", all, "15m"],
  ["1d", all, "1h"],
  ["1W", all, "1d"],
  ["1M", all, "1d"],
  // Without 1h, the next finest within 32 times; never a coarser one.
  ["1d", ["1m", "4h", "1d", "1W"], "4h"],
  // 1m is 1,440 times finer than a day.
  ["1d", ["1m", "1d"], "1d"],
])(
  "an auto script given %s bars, with %j offered, runs on %s",
  (chart, offered, run) => {
    const series = Schema.decodeUnknownSync(BarsSeries)({
      provider: "binance",
      listing: { symbol: "BTCUSDT", currency: "USDT" },
      resolution: chart,
      session: "24h",
      adjustment: "raw",
    });
    // Offers at another session or adjustment never count.
    const feed = Effect.succeed({
      bars: {
        getCapabilities: () =>
          Effect.succeed([
            ...offered.map((resolution) => ({
              resolution,
              session: "24h",
              adjustment: "raw",
            })),
            ...all.map((resolution) => ({
              resolution,
              session: "regular",
              adjustment: "raw",
            })),
            ...all.map((resolution) => ({
              resolution,
              session: "24h",
              adjustment: "split",
            })),
          ]),
      },
    } as unknown as FeedServices);
    expect(Effect.runSync(runResolution(series, feed))).toBe(run);
  },
);
