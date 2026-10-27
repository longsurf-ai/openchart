// Purpose: Verify TradingView's missing observations survive Dataset and Feed transport, and how live updates end.

import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  Result,
  Schema,
  Stream,
} from "effect";
import { expect, test } from "vitest";
import { BarsSnapshot } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import type { Client, LiveActivity } from "../client";
import { selectBars, streamBars } from "../datasets/bars";
import { tradingviewBars } from "../datasets/definitions";
import { tradingviewBarsFeed } from "./bars";

test("index OHLC with no volume reaches a Feed snapshot and survives its wire codec", async () => {
  const time = Date.UTC(2026, 0, 5);
  const client: Client = {
    search: () => Effect.die("unused"),
    live: () => Effect.die("unused"),
    access: () => Effect.succeed({ status: "granted" }),
    reset: () => Effect.void,
    history: ({ to }) =>
      Effect.succeed(
        to !== undefined && to <= time
          ? []
          : [
              {
                time,
                open: 10,
                high: 12,
                low: 9,
                close: 11,
                volume: null,
              },
            ],
      ),
  };
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const dataset = yield* makeDataset(tradingviewBars, {
        select: (query) => selectBars(client, query),
        stream: () => Effect.die("unused"),
      });
      const provider = ProviderId.make("tradingview");
      const feed = tradingviewBarsFeed(dataset, provider);
      return (yield* feed.observe({
        provider,
        listing: {
          symbol: "SPX",
          venue: "TVC",
          currency: "USD",
          class: "index",
        },
        resolution: "1d",
        session: "regular",
        adjustment: "raw",
        from: time,
        to: time + 86_400_000,
        countBack: 1,
      })).snapshot;
    }).pipe(Effect.scoped),
  );
  const encoded = Schema.encodeSync(BarsSnapshot)(snapshot);
  const decoded = Schema.decodeUnknownSync(BarsSnapshot)(encoded);
  expect([...decoded.data]).toEqual([
    { time, open: 10, high: 12, low: 9, close: 11, volume: null },
  ]);
});

const minute = 60_000;
const bar = (time: number, close: number) => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});
const btc = {
  provider: ProviderId.make("tradingview"),
  listing: {
    symbol: "BTCUSD",
    venue: "BITSTAMP",
    currency: "USD",
    class: "crypto" as const,
  },
  resolution: "1m" as const,
  session: "24h" as const,
  adjustment: "raw" as const,
  from: 0,
  countBack: 1,
};

// The Feed over a real Dataset and stream adapter. History holds one bar;
// live activity is what a test offers, and retirement ends it normally once
// accepted activity drains, as the native client does.
const liveFeed = Effect.fn(function* () {
  const activity = yield* Queue.unbounded<
    LiveActivity,
    DatasetFailure | Cause.Done
  >();
  const retired = yield* Deferred.make<void>();
  const client: Client = {
    search: () => Effect.die("unused"),
    access: () => Effect.succeed({ status: "granted" }),
    reset: () => Effect.void,
    history: ({ to }) =>
      Effect.succeed(to !== undefined && to <= 0 ? [] : [bar(0, 1)]),
    live: (_, retired) =>
      Deferred.await(retired).pipe(
        Effect.andThen(Queue.end(activity)),
        Effect.forkScoped,
        Effect.as(Stream.fromQueue(activity)),
      ),
  };
  const dataset = yield* makeDataset(tradingviewBars, {
    select: (query) => selectBars(client, query),
    stream: (query) => streamBars(client, query, retired),
  });
  const feed = tradingviewBarsFeed(dataset, btc.provider);
  const live = yield* feed.observe({ ...btc, to: "now" });
  const rows: unknown[] = [];
  return {
    feed,
    live,
    activity,
    retired,
    rows,
    offer: (...bars: ReturnType<typeof bar>[]) =>
      Queue.offer(activity, { type: "bars", bars }),
    /** Read every update until the stream ends; its failure, if any. */
    drain: live.updates!.pipe(
      Stream.runForEach((frame) => Effect.sync(() => rows.push(...frame))),
      Effect.result,
    ),
  };
});

test("after retirement drains accepted updates, live updates fail as retryable Feed.Reconfigured", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* liveFeed();
      expect([...f.live.snapshot.data]).toEqual([bar(0, 1)]);
      yield* f.offer(bar(0, 2));
      yield* f.offer(bar(minute, 3));
      yield* Deferred.succeed(f.retired, undefined);
      const result = yield* f.drain;
      expect(f.rows).toEqual([bar(0, 2), bar(minute, 3)]);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: { _tag: "Feed.Reconfigured", provider: "tradingview" },
        },
      });
      expect(
        Result.isFailure(result) && result.failure.reason.isRetryable,
      ).toBe(true);
    }).pipe(Effect.scoped),
  );
});

test("a source failure keeps its own reason after accepted updates", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* liveFeed();
      yield* f.offer(bar(minute, 3));
      yield* Queue.fail(
        f.activity,
        new DatasetFailure(
          new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
        ),
      );
      const result = yield* f.drain;
      expect(f.rows).toEqual([bar(minute, 3)]);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: { _tag: "Feed.ResyncRequired", provider: "tradingview" },
        },
      });
    }).pipe(Effect.scoped),
  );
});

test("a history read has no updates, and cancelling live updates is not a failure", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* liveFeed();
      const history = yield* f.feed.observe({ ...btc, to: minute });
      expect(history.updates).toBeUndefined();
      expect([...history.snapshot.data]).toEqual([bar(0, 1)]);
      const fiber = yield* Effect.forkChild(f.drain);
      yield* f.offer(bar(minute, 3));
      while (f.rows.length === 0) yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
    }).pipe(Effect.scoped),
  );
});

// A Feed whose history records the TradingView symbols it reads.
const historyFeed = Effect.fn(function* () {
  const symbols: string[] = [];
  const client: Client = {
    search: () => Effect.die("unused"),
    live: () => Effect.die("unused"),
    access: () => Effect.succeed({ status: "granted" }),
    reset: () => Effect.void,
    history: ({ symbol, to }) =>
      Effect.sync(() => {
        symbols.push(symbol);
        return to !== undefined && to <= 0 ? [] : [bar(0, 1)];
      }),
  };
  const dataset = yield* makeDataset(tradingviewBars, {
    select: (query) => selectBars(client, query),
    stream: () => Effect.die("unused"),
  });
  return { feed: tradingviewBarsFeed(dataset, btc.provider), symbols };
});

test("each resolution lists split adjustment first; raw stays available", async () => {
  const capabilities = await Effect.runPromise(
    Effect.gen(function* () {
      const { feed } = yield* historyFeed();
      return yield* feed.getCapabilities(btc);
    }).pipe(Effect.scoped),
  );
  expect(
    capabilities
      .filter(({ resolution }) => resolution === "1d")
      .map(({ adjustment }) => adjustment),
  ).toEqual(["split", "raw", "split_dividend"]);
});

test("a listing needs its venue or a qualified symbol; no exchange is picked for it", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { feed, symbols } = yield* historyFeed();
      const bare = {
        ...btc,
        listing: {
          symbol: "BTCUSD",
          currency: "USD",
          class: "crypto" as const,
        },
      };
      const invalid = { reason: { _tag: "Feed.InvalidRequest" } };
      expect(yield* Effect.flip(feed.getCapabilities(bare))).toMatchObject(
        invalid,
      );
      expect(
        yield* Effect.flip(feed.observe({ ...bare, to: minute })),
      ).toMatchObject(invalid);
      expect(symbols).toEqual([]);
      const qualified = {
        ...bare,
        listing: { ...bare.listing, symbol: "BITSTAMP:BTCUSD" },
      };
      expect(yield* feed.getCapabilities(qualified)).not.toEqual([]);
      yield* feed.observe({ ...qualified, to: minute });
      expect(new Set(symbols)).toEqual(new Set(["BITSTAMP:BTCUSD"]));
    }).pipe(Effect.scoped),
  );
});
