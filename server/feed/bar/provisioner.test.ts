// Purpose: Verify Bars routing and snapshot/update ordering.

import { expect, it } from "vitest";
import { Deferred, Effect, Exit, Queue, Schema, Stream } from "effect";
import type { DatasetFailure } from "@openchart/server/data/dataset";
import {
  binanceBars,
  binanceSymbology,
} from "@openchart/server/data/providers/binance/datasets/definitions";
import { yfinanceBars } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { BarsRequest } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { makeDataset } from "@openchart/server/data";
import { provisionBars } from "./provisioner";

const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "Binance",
    currency: "USDT",
  },
  resolution: "1m",
  adjustment: "raw",
  session: "24h",
  from: 0,
  to: "now",
  countBack: 500,
});
function frame(
  close: number,
  trades = 1,
  asOf = 1,
  final = false,
  times = [1],
) {
  return binanceBars.frame.create({
    labels: { symbol: "BTCUSDT" },
    rows: times.map((time) => ({
      time,
      open: 1,
      high: close,
      low: 1,
      close,
      volume: trades,
      trades,
      final,
      asOf,
    })),
  });
}

it("routes Bars only to the requested provider and preserves absent historical updates", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let binanceCalls = 0;
        let yahooCalls = 0;
        const binance = yield* makeDataset(binanceBars, {
          select: (query) =>
            query.count !== undefined
              ? Effect.succeed(frame(0, 0, 0, false, []))
              : Effect.sync(() => {
                  binanceCalls++;
                  return frame(2);
                }),
          stream: () => Effect.succeed(Stream.never),
        });
        const yahoo = yield* makeDataset(yfinanceBars, {
          select: (query) =>
            query.count !== undefined
              ? Effect.succeed(frame(0, 0, 0, false, []))
              : Effect.sync(() => {
                  yahooCalls++;
                  return frame(3);
                }),
          stream: () => Effect.succeed(Stream.never),
        });
        const bars = yield* provisionBars([binance, yahoo]);
        const session = yield* bars.observe({ ...request, to: 100 });
        expect(session.snapshot.data.get(0)?.close).toBe(2);
        expect(session.updates).toBeUndefined();
        expect([binanceCalls, yahooCalls]).toEqual([1, 0]);
        const missing = yield* bars
          .observe({
            ...request,
            provider: Schema.decodeUnknownSync(ProviderId)("unknown"),
          })
          .pipe(Effect.flip);
        expect(missing.reason).toMatchObject({
          _tag: "Feed.SourceUnavailable",
          provider: "unknown",
        });
        expect(yahooCalls).toBe(0);
        const delayed = yield* bars.getCapabilities({
          provider: Schema.decodeUnknownSync(ProviderId)("yfinance"),
          listing: request.listing,
        });
        expect(
          delayed.every(
            (capability) =>
              capability.modes.includes("delayed") &&
              !capability.modes.includes("live"),
          ),
        ).toBe(true);
      }),
    ),
  );
});

it("opens upstream before history and never applies stale buffered versions over the snapshot", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<
          ReturnType<typeof frame>,
          DatasetFailure
        >();
        let subscribed = false;
        const selected = yield* Deferred.make<void>();
        const dataset = yield* makeDataset(binanceBars, {
          stream: () =>
            Effect.sync(() => {
              subscribed = true;
              return Stream.fromQueue(queue);
            }),
          select: (query) =>
            query.count !== undefined
              ? Effect.succeed(frame(0, 0, 0, false, []))
              : Effect.gen(function* () {
                  expect(subscribed).toBe(true);
                  yield* Queue.offer(queue, frame(1, 1, 1));
                  yield* Deferred.succeed(selected, undefined);
                  return frame(2, 2, 2);
                }),
        });
        const bars = yield* provisionBars([dataset]);
        const session = yield* bars.observe(request);
        expect(session.snapshot.data.get(0)?.close).toBe(2);
        yield* Deferred.await(selected);
        // Published after snapshot return, before consumer starts its Stream.
        yield* Queue.offer(queue, frame(3, 3, 3));
        const updates = session.updates;
        if (!updates) throw new Error("Missing live updates");
        const batches = yield* updates.pipe(Stream.take(1), Stream.runCollect);
        expect(
          batches.flatMap((frame) => [...frame].map((row) => row.close)),
        ).toEqual([3]);
      }),
    ),
  );
});

it("keeps Yahoo polling after snapshot and emits overlapping corrections", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const order: string[] = [];
        const dataset = yield* makeDataset(yfinanceBars, {
          select: (query) =>
            query.count !== undefined
              ? Effect.succeed(frame(0, 0, 0, false, []))
              : Effect.sync(() => {
                  order.push("snapshot");
                  return frame(2);
                }),
          stream: () =>
            Effect.succeed(
              Stream.fromEffect(
                Effect.sync(() => {
                  order.push("poll");
                  return frame(3);
                }),
              ),
            ),
        });
        const bars = yield* provisionBars([dataset]);
        const session = yield* bars.observe({
          ...request,
          provider: Schema.decodeUnknownSync(ProviderId)("yfinance"),
          adjustment: "split",
          session: "regular",
        });
        expect(order).toEqual(["snapshot"]);
        if (!session.updates) throw new Error("Missing delayed updates");
        const updates = yield* session.updates.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        expect(order).toEqual(["snapshot", "poll"]);
        expect(updates[0]?.get(0)?.close).toBe(3);
      }),
    ),
  );
});

it("delivers a newer final-bar correction with an unchanged trade count", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<
          ReturnType<typeof frame>,
          DatasetFailure
        >();
        const dataset = yield* makeDataset(binanceBars, {
          select: (query) =>
            Effect.succeed(
              query.count === undefined
                ? frame(2, 5, 100, true)
                : frame(0, 0, 0, false, []),
            ),
          stream: () => Effect.succeed(Stream.fromQueue(queue)),
        });
        const bars = yield* provisionBars([dataset]);
        const session = yield* bars.observe(request);
        if (!session.updates) throw new Error("Missing live stream");
        yield* Queue.offer(queue, frame(1, 5, 101, false));
        yield* Queue.offer(queue, frame(3, 5, 102, true));
        const delivered = yield* session.updates.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        expect(
          delivered.flatMap((frame) => [...frame].map((row) => row.close)),
        ).toEqual([3]);
      }),
    ),
  );
});

it("does not drop newly available delayed bars after an empty snapshot", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = frame(3);
        const empty = binanceBars.frame.create({
          labels: source.labels,
          rows: [],
        });
        const dataset = yield* makeDataset(yfinanceBars, {
          select: () => Effect.succeed(empty),
          stream: () => Effect.succeed(Stream.succeed(source)),
        });
        const bars = yield* provisionBars([dataset]);
        const session = yield* bars.observe({
          ...request,
          provider: Schema.decodeUnknownSync(ProviderId)("yfinance"),
          adjustment: "split",
          session: "regular",
        });
        if (!session.updates) throw new Error("Missing delayed updates");
        expect(session.snapshot.data.numRows).toBe(0);
        const batches = yield* session.updates.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        expect(
          batches.flatMap((frame) => [...frame].map((row) => row.time)),
        ).toEqual([1]);
      }),
    ),
  );
});

it("ignores unrelated datasets when provisioning Bars", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const symbols = yield* makeDataset(binanceSymbology, {
          select: () => Effect.succeed([]),
          search: () => Effect.succeed([]),
        });
        const bars = yield* provisionBars([symbols]);
        expect(yield* bars.getCapabilities(request)).toEqual([]);
      }),
    ),
  );
});

it("dies when two Bars Datasets route the same provider", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const implementation = {
          select: () => Effect.succeed(frame(1)),
          stream: () => Effect.succeed(Stream.never),
        };
        const first = yield* makeDataset(binanceBars, implementation);
        const second = yield* makeDataset(binanceBars, implementation);
        expect(
          Exit.hasDies(yield* Effect.exit(provisionBars([first, second]))),
        ).toBe(true);
      }),
    ),
  );
});

it("retains native correction ordering for bars fetched before the requested from", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<
          ReturnType<typeof frame>,
          DatasetFailure
        >();
        const dataset = yield* makeDataset(binanceBars, {
          select: (query) =>
            Effect.succeed(
              query.count === undefined
                ? frame(2, 5, 100, true, [20])
                : frame(1, 5, 100, true, [1, 10]),
            ),
          stream: () => Effect.succeed(Stream.fromQueue(queue)),
        });
        const feed = yield* provisionBars([dataset]);
        const session = yield* feed.observe({
          ...request,
          from: 15,
          countBack: 2,
        });
        expect([...session.snapshot.data].map((row) => row.time)).toEqual([
          10, 20,
        ]);
        expect(session.snapshot.range.from).toBe(10);
        expect(session.snapshot.hasMoreBefore).toBe(true);
        if (!session.updates) throw new Error("Missing live updates");
        yield* Queue.offer(queue, frame(0, 1, 99, false, [10]));
        yield* Queue.offer(queue, frame(3, 5, 101, true, [10]));
        const batches = yield* session.updates.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        expect(
          batches.flatMap((frame) =>
            [...frame].map(({ time, close }) => [time, close]),
          ),
        ).toEqual([[10, 3]]);
      }),
    ),
  );
});

it("preserves native gaps, labels and metadata through snapshots and updates", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const initial = frame(NaN, 5, 100, true);
        const update = frame(NaN, 6, 101, true);
        const dataset = yield* makeDataset(binanceBars, {
          select: (query) =>
            Effect.succeed(
              query.count === undefined ? initial : frame(0, 0, 0, false, []),
            ),
          stream: () => Effect.succeed(Stream.succeed(update)),
        });
        const feed = yield* provisionBars([dataset]);
        const observation = yield* feed.observe(request);
        expect(observation.snapshot.data).toBe(initial);
        if (!observation.updates) throw new Error("Missing updates");
        const received = yield* Stream.runCollect(observation.updates);
        expect(received).toEqual([update]);
        expect(received[0]).toBe(update);
      }),
    ),
  );
});
