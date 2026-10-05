// Purpose: Capture real, finite daily, weekly and monthly history for offline study-library charts.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DateTime, Effect, Schema } from "effect";
import { format, resolveConfig } from "prettier";
import { ProviderId } from "@openchart/market";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { makeClient as yahooClient } from "@openchart/server/data/providers/yfinance/client";
import { selectBars as yahooBars } from "@openchart/server/data/providers/yfinance/datasets/bars";
import { searchSymbols as yahooSymbols } from "@openchart/server/data/providers/yfinance/datasets/symbology";
import { yfinanceSymbology } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { yfinanceSymbologyFeed } from "@openchart/server/data/providers/yfinance/feed/symbology";
import { makeClient as binanceClient } from "@openchart/server/data/providers/binance/client";
import { selectBars as binanceBars } from "@openchart/server/data/providers/binance/datasets/bars";
import {
  searchSymbols as binanceSymbols,
  selectSymbols as binanceListings,
} from "@openchart/server/data/providers/binance/datasets/symbology";
import { binanceSymbology } from "@openchart/server/data/providers/binance/datasets/definitions";
import { binanceSymbologyFeed } from "@openchart/server/data/providers/binance/feed/symbology";

const outputDirectory = fileURLToPath(
  new URL(
    "../../app/src/features/chart/assets/market-examples/",
    import.meta.url,
  ),
);
const requestedRange = {
  from: DateTime.toEpochMillis(DateTime.makeUnsafe("2021-01-01T00:00:00Z")),
  to: DateTime.toEpochMillis(DateTime.makeUnsafe("2025-01-01T00:00:00Z")),
};
const examples = [
  ...[
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "AMD",
    "INTC",
  ].map((symbol) => ({
    symbol,
    provider: "yfinance",
    assetClass: "stock",
    currency: "USD",
    venues: ["NMS"],
  })),
  ...["JPM", "XOM", "UNH", "PFE", "DIS", "BA"].map((symbol) => ({
    symbol,
    provider: "yfinance",
    assetClass: "stock",
    currency: "USD",
    venues: ["NYQ"],
  })),
  {
    symbol: "WMT",
    provider: "yfinance",
    assetClass: "stock",
    currency: "USD",
    venues: ["NYQ", "NMS"],
  },
  ...["SPY", "IWM", "GLD", "XLE"].map((symbol) => ({
    symbol,
    provider: "yfinance",
    assetClass: "etf",
    currency: "USD",
    venues: ["PCX"],
  })),
  ...["QQQ", "TLT"].map((symbol) => ({
    symbol,
    provider: "yfinance",
    assetClass: "etf",
    currency: "USD",
    venues: ["NGM"],
  })),
  ...["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((symbol) => ({
    symbol,
    provider: "binance",
    assetClass: "crypto",
    currency: "USDT",
    venues: ["Binance"],
  })),
];
const displayYears = [2022, 2024];
// Each example's bars: the daily ones it draws, then the same market's weeks
// and months, as Feed names them, by each provider's interval.
const resolutions = ["1d", "1W", "1M"] as const;
const binanceIntervals = { "1d": "1d", "1W": "1w", "1M": "1M" } as const;
const yahooIntervals = { "1d": "1d", "1W": "1wk", "1M": "1mo" } as const;
// The fewest rows a capture keeps over two years, and over its display year.
const coverage = {
  "1d": (crypto: boolean) =>
    crypto ? { rows: 730, shown: 365 } : { rows: 490, shown: 245 },
  "1W": () => ({ rows: 100, shown: 50 }),
  "1M": () => ({ rows: 24, shown: 12 }),
};
const manifest = examples.flatMap(({ provider, symbol }) =>
  displayYears.map((year) => ({
    id: `${symbol.toLowerCase()}-${year}-1d`,
    provider,
    symbol,
    year,
  })),
);
const verify = process.argv.includes("--verify");
assert(process.argv.slice(2).every((argument) => argument === "--verify"));
const CapturedBars = Schema.Struct({
  provenance: Schema.Struct({ sha256: Schema.String }),
  bars: Schema.Array(
    Schema.Tuple([
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
    ]),
  ),
});

await mkdir(outputDirectory, { recursive: true });

await Effect.runPromise(
  Effect.gen(function* () {
    // Record the actual history URL; the public Provider clients still own I/O,
    // pagination, quotas, parsing, split adjustment and daily timestamp semantics.
    let sourceUrls = new Set<string>();
    const captureFetch: typeof fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.searchParams.has("period1") || url.pathname.endsWith("/klines"))
        sourceUrls.add(url.href);
      return fetch(input, init);
    };
    const yahoo = yield* yahooClient(captureFetch);
    const binance = yield* binanceClient(captureFetch);
    const yahooSearch = yfinanceSymbologyFeed(
      yield* makeDataset(yfinanceSymbology, {
        search: (query) => yahooSymbols(yahoo, query),
      }),
      ProviderId.make("yfinance"),
    );
    const binanceSearch = binanceSymbologyFeed(
      yield* makeDataset(binanceSymbology, {
        search: (query) => binanceSymbols(binance, query),
        select: (query) => binanceListings(binance, query),
      }),
      ProviderId.make("binance"),
    );
    for (const example of examples) {
      const { symbol } = example;
      const crypto = example.provider === "binance";
      const search = crypto ? binanceSearch : yahooSearch;
      const matches = (yield* search.search({
        query: symbol,
        indexed: false,
        limit: 100,
      })).filter((entry) => entry.listing.symbol === symbol);
      assert.equal(
        matches.length,
        1,
        `Expected one exact source listing for ${symbol}`,
      );
      const instrument = matches[0]!;
      assert.equal(
        instrument.provider,
        example.provider,
        `${symbol}: wrong Provider`,
      );
      assert.equal(
        instrument.listing.class,
        example.assetClass,
        `${symbol}: wrong asset class`,
      );
      assert.equal(
        instrument.listing.currency,
        example.currency,
        `${symbol}: wrong currency`,
      );
      assert(
        example.venues.includes(instrument.listing.venue ?? ""),
        `${symbol}: unexpected venue ${instrument.listing.venue}`,
      );
      // Each example's daily bars, and the same market's weekly and monthly
      // bars, which a study's request.security lines read in a preview.
      for (const resolution of resolutions) {
        sourceUrls = new Set();
        const frame = crypto
          ? yield* binanceBars(binance, {
              symbol,
              interval: binanceIntervals[resolution],
              time: requestedRange,
            })
          : yield* yahooBars(yahoo, {
              symbol,
              interval: yahooIntervals[resolution],
              includePrePost: false,
              time: requestedRange,
            });
        const history = [...frame].map(
          ({ time, open, high, low, close, volume }) =>
            [time, open, high, low, close, volume] as const,
        );
        const retrievedAt = DateTime.formatIso(yield* DateTime.now);
        assert(sourceUrls.size > 0, `${symbol}: source URL was not captured`);
        for (const year of displayYears) {
          const start = (value: number) =>
            DateTime.toEpochMillis(
              DateTime.makeUnsafe(`${value}-01-01T00:00:00Z`),
            );
          const displayRange = { from: start(year), to: start(year + 1) };
          const warmupStart = start(year - 1);
          // Keep the preceding year for indicator warmup, without normalizing,
          // interpolating, or repeating any source OHLCV values.
          const bars = history.filter(
            ([time]) => time >= warmupStart && time < displayRange.to,
          );
          const visibleBars = bars.filter(
            ([time]) => time >= displayRange.from,
          );
          const minimum = coverage[resolution](crypto);
          assert(
            bars.length >= minimum.rows && visibleBars.length >= minimum.shown,
            `Insufficient historical coverage for ${symbol} ${year} ${resolution}`,
          );
          for (let index = 0; index < bars.length; index++) {
            const [time, open, high, low, close, volume] = bars[index]!;
            assert(
              open !== null &&
                high !== null &&
                low !== null &&
                close !== null &&
                volume !== null,
              `${symbol}: historical example requires complete OHLCV`,
            );
            assert(
              index === 0 || time > bars[index - 1]![0],
              `${symbol}: unordered bars`,
            );
            assert(
              high >= Math.max(open, close) &&
                low <= Math.min(open, close) &&
                low > 0 &&
                volume >= 0,
              `${symbol}: invalid OHLCV`,
            );
          }
          const id = `${symbol.toLowerCase()}-${year}-${resolution}`;
          const sha256 = createHash("sha256")
            .update(JSON.stringify(bars))
            .digest("hex");
          const asset = {
            id,
            instrument,
            resolution,
            session: crypto ? "24h" : "regular",
            adjustment: crypto ? "raw" : "split",
            displayRange,
            provenance: {
              sourceUrl: [...sourceUrls][0]!,
              sourceUrls: [...sourceUrls],
              retrievedAt,
              requestedRange,
              firstBarTime: bars[0]![0],
              lastBarTime: bars.at(-1)![0],
              rowCount: bars.length,
              sha256,
            },
            bars,
          };
          const path = `${outputDirectory}/${id}.json`;
          yield* Effect.promise(async () => {
            if (verify) {
              const previous = Schema.decodeUnknownSync(
                Schema.fromJsonString(CapturedBars),
              )(await readFile(path, "utf8"));
              assert.equal(
                createHash("sha256")
                  .update(JSON.stringify(previous.bars))
                  .digest("hex"),
                previous.provenance.sha256,
                `${id}: saved checksum does not match the cached bars`,
              );
              assert.equal(
                previous.provenance.sha256,
                sha256,
                `${symbol}: provider history changed; inspect before recapturing`,
              );
            } else {
              // Unchanged history keeps its file, and with it its retrieval time.
              const saved = await readFile(path, "utf8").then(
                (text) =>
                  Schema.decodeUnknownSync(Schema.fromJsonString(CapturedBars))(
                    text,
                  ).provenance.sha256,
                () => undefined,
              );
              if (saved !== sha256)
                await writeFile(
                  path,
                  await format(JSON.stringify(asset), {
                    ...(await resolveConfig(path)),
                    parser: "json",
                  }),
                );
            }
          });
          yield* Effect.log(
            `${verify ? "Verified" : "Captured"} ${instrument.provider}:${symbol} ${year} ${resolution}: ${bars.length} rows (${visibleBars.length} displayed) ${sha256}`,
          );
        }
      }
    }
    yield* Effect.promise(async () => {
      const path = `${outputDirectory}/manifest.json`;
      if (!verify) {
        await writeFile(
          path,
          await format(JSON.stringify(manifest), {
            ...(await resolveConfig(path)),
            parser: "json",
          }),
        );
      } else {
        const savedManifest = Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Array(
              Schema.Struct({
                id: Schema.String,
                provider: Schema.String,
                symbol: Schema.String,
                year: Schema.Number,
              }),
            ),
          ),
        )(await readFile(path, "utf8"));
        assert.deepEqual(
          savedManifest,
          manifest,
          "Captured manifest differs from the example catalog",
        );
      }
    });
  }).pipe(Effect.scoped),
);
