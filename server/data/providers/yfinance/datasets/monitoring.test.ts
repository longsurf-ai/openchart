// Purpose: Prove Yahoo freshness uses Yahoo's own trading period, and hung requests fail.

import { DatasetFailure } from "@openchart/server/data/dataset";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";

import { request } from "@openchart/server/data/providers/yfinance/client";
import { yahooFreshness, type YahooProgress } from "./bars";

const OPEN = 1_790_343_000; // 09:30 New York, in Yahoo's Unix seconds
const CLOSE = 1_790_366_400; // 16:00
const meta = (regularMarketTime: number) => ({
  symbol: "AAPL",
  currency: "USD",
  exchangeName: "NMS",
  instrumentType: "EQUITY",
  dataGranularity: "1m",
  regularMarketTime,
  currentTradingPeriod: { regular: { start: OPEN, end: CLOSE } },
});

it("a delayed exchange whose trades keep advancing stays healthy", () => {
  // VOD.L-style: every poll sees a trade about 15 minutes old, but a newer one.
  let progress: YahooProgress = { trade: undefined, advancedAt: 0 };
  for (let poll = 0; poll < 10; poll++) {
    const now = (OPEN + 3_600 + poll * 15) * 1000;
    const result = yahooFreshness(
      meta(OPEN + 2_700 + poll * 15),
      now,
      progress,
    );
    expect(result.health).toEqual({ state: "healthy" });
    progress = result.progress;
  }
});

it("during regular hours a trade that stops advancing for over 60 seconds is degraded", () => {
  const trade = OPEN + 3_000;
  let progress = yahooFreshness(meta(trade), (OPEN + 3_600) * 1000, {
    trade: undefined,
    advancedAt: 0,
  }).progress;
  expect(
    yahooFreshness(meta(trade), (OPEN + 3_660) * 1000, progress).health,
  ).toEqual({ state: "healthy" });
  const stale = yahooFreshness(meta(trade), (OPEN + 3_661) * 1000, progress);
  expect(stale.health).toEqual({
    state: "degraded",
    reason: {
      code: "stale",
      message:
        "Yahoo has reported no new trade for over a minute during trading hours; data may be delayed (estimate from trading hours).",
    },
  });
  // A new trade clears it at once.
  progress = stale.progress;
  expect(
    yahooFreshness(meta(trade + 90), (OPEN + 3_676) * 1000, progress).health,
  ).toEqual({ state: "healthy" });
});

it("outside regular hours, or without session metadata, no trade is expected", () => {
  const weekend = (CLOSE + 2 * 86_400) * 1000;
  const old = { trade: CLOSE, advancedAt: 0 };
  expect(yahooFreshness(meta(CLOSE), weekend, old)).toEqual({
    health: { state: "healthy" },
    progress: { trade: CLOSE, advancedAt: weekend },
  });
  expect(yahooFreshness(undefined, weekend, old).health).toEqual({
    state: "healthy",
  });
});

it("a request that never answers fails after 30 seconds", async () => {
  const hanging: typeof fetch = () => new Promise(() => {});
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* request(
        { fetch: hanging },
        "/v8/finance/chart/AAPL",
        {},
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("29 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(error).toBeInstanceOf(DatasetFailure);
  expect(error).toMatchObject({
    reason: { _tag: "Dataset.Unavailable" },
    cause: "Yahoo Finance did not respond within 30 seconds.",
  });
});
