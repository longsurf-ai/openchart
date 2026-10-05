// Purpose: Verify merged search identities, global limits and source failures.
import { expect, it } from "vitest";
import { Effect, Exit, Layer } from "effect";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { binanceSymbology } from "@openchart/server/data/providers/binance/datasets/definitions";
import { yfinanceSymbology } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { makeDataset } from "@openchart/server/data";
import { Database } from "@openchart/server/db";
import { SymbologyIndex } from "./symbology";
import { provisionSymbology } from "./provisioner";
import { searchSymbols } from "@openchart/server/data/providers/binance/datasets/symbology";

it("keeps real provider candidates until the global sort and limit", async () => {
  const queries: unknown[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const dataset = yield* makeDataset(binanceSymbology, {
          select: () => Effect.succeed([]),
          search: (query) => {
            queries.push(query);
            return searchSymbols(
              {
                fetch: async () =>
                  Response.json({
                    symbols: ["BTC", "ABTC"].map((baseAsset) => ({
                      symbol: `${baseAsset}USDT`,
                      baseAsset,
                      quoteAsset: "USDT",
                      status: "TRADING",
                      isSpotTradingAllowed: true,
                    })),
                  }),
              },
              query,
            );
          },
        });
        const feed = yield* provisionSymbology([dataset]);
        const results = yield* feed.search({
          query: "BTC",
          limit: 1,
          indexed: false,
        });
        // Binance receives no limit; Feed ranks the BTC prefix first and limits globally.
        expect(queries).toEqual([{ query: "BTC" }]);
        expect(results.map((result) => result.listing.symbol)).toEqual([
          "BTCUSDT",
        ]);
      }),
    ).pipe(
      Effect.provide(
        SymbologyIndex.layer.pipe(
          Layer.provide(Database.layer(":memory:", () => Effect.void)),
        ),
      ),
    ),
  );
});

it("merges identities, sorts before the global limit and fails a partial search", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const binance = yield* makeDataset(binanceSymbology, {
          select: () => Effect.succeed([]),
          search: () =>
            Effect.succeed([
              {
                symbol: "ZZZ",
                baseAsset: "Z",
                quoteAsset: "USD",
                status: "TRADING",
              },
              {
                symbol: "AAPL",
                baseAsset: "A",
                quoteAsset: "USD",
                status: "TRADING",
              },
            ]),
        });
        const yahoo = yield* makeDataset(yfinanceSymbology, {
          search: () =>
            Effect.succeed([
              {
                symbol: "AAPL",
                shortname: "Apple",
                exchange: "NMS",
                quoteType: "EQUITY",
                currency: "USD",
              },
            ]),
        });
        const symbols = yield* provisionSymbology([yahoo, binance]);
        const result = yield* symbols.search({
          query: "A",
          limit: 2,
          indexed: false,
        });
        expect(result.map((hit) => [hit.provider, hit.listing.symbol])).toEqual(
          [
            ["binance", "AAPL"],
            ["yfinance", "AAPL"],
          ],
        );
        const broken = yield* makeDataset(yfinanceSymbology, {
          search: () =>
            Effect.fail(new DatasetFailure(new DatasetReasons.Unavailable())),
        });
        const failed = yield* provisionSymbology([binance, broken]);
        expect(
          yield* failed
            .search({ query: "A", limit: 2, indexed: false })
            .pipe(Effect.flip),
        ).toMatchObject({
          reason: { _tag: "Feed.SourceUnavailable", provider: "yfinance" },
        });
        expect(
          Exit.hasDies(
            yield* Effect.exit(provisionSymbology([binance, binance])),
          ),
        ).toBe(true);
      }),
    ).pipe(
      Effect.provide(
        SymbologyIndex.layer.pipe(
          Layer.provide(Database.layer(":memory:", () => Effect.void)),
        ),
      ),
    ),
  );
});
