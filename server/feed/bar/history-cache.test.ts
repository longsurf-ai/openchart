// Purpose: Prove range/count equivalence, bounded reuse and cancellation at the shared history owner.
import { Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import { FeedError, FeedReasons } from "@openchart/feed";
import { fromPoints, takeRows, type DataFrame } from "@openchart/timeseries";
import { cacheHistory, type HistorySelection } from "./history-cache";

interface Query extends HistorySelection {
  readonly symbol: string;
  readonly session?: string;
}
const query = (from: number, to: number): Query => ({
  symbol: "A",
  time: { from, to },
});
const count = (to: number, count: number): Query => ({
  symbol: "A",
  time: { to },
  count,
});
const frame = (times: readonly number[]) =>
  fromPoints(
    { unit: "USD" },
    times.map((time) => ({
      time,
      close: time === 30 ? NaN : time,
      volume: 1,
      final: true,
      asOf: 1000,
    })),
  );
const source = (data: () => DataFrame) =>
  vi.fn((query: Query): Effect.Effect<DataFrame, FeedError> =>
    Effect.sync(() => {
      const rows = data();
      let indices = [...rows].flatMap(({ time }, index) =>
        time >= (query.time.from ?? 0) && time < query.time.to! ? [index] : [],
      );
      if (query.count !== undefined)
        indices =
          query.time.from === undefined
            ? indices.slice(-query.count)
            : indices.slice(0, query.count);
      return takeRows(rows, indices);
    }),
  );
const stable = { window: () => ({ from: 0, to: 10_000 }) };
const failure = new FeedError({
  reason: new FeedReasons.SourceUnavailable({}),
});

test("keeps disjoint charts, fetches only gaps and coalesces touching coverage, including empty periods", async () => {
  const data = frame([10, 20, 30, 70, 80, 90]);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(read, stable);
      yield* cached(query(10, 40));
      yield* cached(query(70, 100));
      expect([...(yield* cached(query(20, 90)))]).toEqual(
        [...data].filter((r) => r.time >= 20 && r.time < 90),
      );
      expect(read.mock.calls.map(([q]) => q.time)).toEqual([
        { from: 10, to: 40 },
        { from: 70, to: 100 },
        { from: 40, to: 70 },
      ]);
      yield* cached(query(11, 99));
      const empty = yield* cached(query(41, 69));
      expect(empty.numRows).toBe(0);
      expect(empty.labels).toEqual(data.labels);
      expect(read).toHaveBeenCalledTimes(3);
      expect([...(yield* cached(query(0, 110)))]).toEqual([...data]);
      expect(read.mock.calls.slice(3).map(([q]) => q.time)).toEqual([
        { from: 0, to: 10 },
        { from: 100, to: 110 },
      ]);
    }),
  );
});

test("backwards counts use actual rows, extend only the missing prefix and remember exhaustion", async () => {
  const data = frame([10, 20, 90, 100, 200]);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(read, stable);
      expect([...(yield* cached(count(201, 2)))].map((r) => r.time)).toEqual([
        100, 200,
      ]);
      expect([...(yield* cached(count(201, 4)))].map((r) => r.time)).toEqual([
        20, 90, 100, 200,
      ]);
      expect(read.mock.calls.map(([q]) => [q.time.to, q.count])).toEqual([
        [201, 2],
        [100, 2],
      ]);
      expect([...(yield* cached(count(200, 2)))].map((r) => r.time)).toEqual([
        90, 100,
      ]);
      expect([...(yield* cached(count(201, 20)))]).toEqual([...data]);
      expect(read.mock.calls.at(-1)![0]).toEqual(count(20, 16));
      expect((yield* cached(count(10, 3))).numRows).toBe(0);
      expect((yield* cached(query(1, 9))).numRows).toBe(0);
      expect(read).toHaveBeenCalledTimes(3);
    }),
  );
});

test("never uses rows across an unqueried gap to satisfy a count", async () => {
  const data = frame([10, 20, 50, 60, 90, 100]);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(read, stable);
      yield* cached(query(10, 30));
      yield* cached(query(90, 110));
      expect([...(yield* cached(count(110, 4)))].map((r) => r.time)).toEqual([
        50, 60, 90, 100,
      ]);
      expect(read.mock.calls.at(-1)![0]).toEqual(count(90, 2));
    }),
  );
});

test("serializes overlapping consumers while independent series still load concurrently", async () => {
  const data = frame([10, 20, 30]);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>(),
          release = yield* Deferred.make<void>();
        const { select: cached } = yield* cacheHistory(
          (q: Query) =>
            read(q).pipe(
              Effect.tap(() =>
                q.symbol === "A"
                  ? Deferred.succeed(started, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                    )
                  : Effect.void,
              ),
            ),
          stable,
        );
        const first = yield* cached(query(0, 40)).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        const second = yield* cached(query(10, 30)).pipe(Effect.forkScoped);
        yield* cached({ ...query(0, 40), symbol: "B" });
        expect(read).toHaveBeenCalledTimes(2);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        expect((yield* Fiber.join(second)).numRows).toBe(2);
        expect(read).toHaveBeenCalledTimes(2);
      }),
    ),
  );
});

test.each(["reader", "waiter"] as const)(
  "cancelling a %s does not poison another consumer or commit partial coverage",
  async (cancel) => {
    const data = frame([10, 20, 30]);
    const read = source(() => data);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>();
          let firstRead = true;
          const { select: cached } = yield* cacheHistory(
            (q: Query) =>
              Effect.gen(function* () {
                const result = yield* read(q);
                if (firstRead) {
                  firstRead = false;
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(release);
                }
                return result;
              }),
            stable,
          );
          const first = yield* cached(query(0, 40)).pipe(Effect.forkScoped);
          yield* Deferred.await(started);
          const second = yield* cached(query(0, 40)).pipe(Effect.forkScoped);
          yield* Fiber.interrupt(cancel === "reader" ? first : second);
          yield* Deferred.succeed(release, undefined);
          expect([
            ...(yield* Fiber.join(cancel === "reader" ? second : first)),
          ]).toEqual([...data]);
          yield* cached(query(0, 40));
          expect(read).toHaveBeenCalledTimes(cancel === "reader" ? 2 : 1);
        }),
      ),
    );
  },
);

test("a later failed gap rolls back the fill and retries successfully", async () => {
  const data = frame([10, 20, 30, 40, 50, 60]);
  const read = source(() => data);
  let fail = false;
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(
        (q: Query) =>
          fail && q.time.from === 30 ? Effect.fail(failure) : read(q),
        stable,
      );
      yield* cached(query(20, 30));
      yield* cached(query(50, 60));
      fail = true;
      expect(Exit.isFailure(yield* Effect.exit(cached(query(0, 70))))).toBe(
        true,
      );
      fail = false;
      expect([...(yield* cached(query(0, 70)))]).toEqual([...data]);
      expect(read.mock.calls.filter(([q]) => q.time.from === 0)).toHaveLength(
        2,
      );
    }),
  );
});

test("keeps recent rows fresh, expires old corrections, and never claims future coverage", async () => {
  let data = frame([100, 900]);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.adjust(1000);
      const { select: cached } = yield* cacheHistory(read, {
        window: (_, now) => ({ from: 0, to: now - 200 }),
        timeToLive: 2000,
      });
      yield* cached(query(0, 2000));
      data = frame([100, 850, 900, 950]);
      expect([...(yield* cached(query(0, 1000)))].map((r) => r.time)).toEqual([
        100, 850, 900, 950,
      ]);
      expect(read.mock.calls.at(-1)![0].time).toEqual({ from: 800, to: 1000 });
      data = frame([50, 900]);
      expect([...(yield* cached(query(0, 500)))].map((r) => r.time)).toEqual([
        100,
      ]);
      yield* TestClock.adjust(2001);
      expect([...(yield* cached(query(0, 500)))].map((r) => r.time)).toEqual([
        50,
      ]);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("keeps an unfinalized suffix fresh even when it is old, and explicit resync invalidates coverage", async () => {
  const points = [10, 20, 30].map((time) => ({
    time,
    close: time,
    final: time < 20,
  }));
  let data = fromPoints({ unit: "USD" }, points);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const history = yield* cacheHistory(read, {
        ...stable,
        isFinal: (row) => row.final === true,
      });
      yield* history.select(query(0, 40));
      data = fromPoints(
        { unit: "USD" },
        points.map((row) => ({
          ...row,
          final: true,
          close: row.time === 20 ? 99 : row.close,
        })),
      );
      expect([...(yield* history.select(query(0, 40)))]).toEqual([...data]);
      expect(read.mock.calls.at(-1)![0].time).toEqual({ from: 20, to: 40 });
      yield* history.invalidate;
      yield* history.select(query(0, 40));
      expect(read.mock.calls.at(-1)![0].time).toEqual({ from: 0, to: 40 });
    }),
  );
});

test("bounds series, row and empty-span retention without truncating responses", async () => {
  const data = frame([10, 20, 30]);
  for (const limits of [{ capacity: 1 }, { maxRows: 2 }, { maxSpans: 1 }]) {
    const read = source(() => data);
    await Effect.runPromise(
      Effect.gen(function* () {
        const { select: cached } = yield* cacheHistory(read, {
          ...stable,
          ...limits,
        });
        expect([...(yield* cached(query(0, 40)))]).toEqual([...data]);
        yield* cached({ ...query(0, 40), symbol: "B" });
        yield* cached(query(100, 110));
        yield* cached(query(0, 40));
        expect(
          read.mock.calls.filter(
            ([q]) => q.symbol === "A" && q.time.from === 0,
          ),
        ).toHaveLength(2);
      }),
    );
  }
});

test("retains source semantics for bounded forward counts and unsupported bounds", async () => {
  const data = frame([10, 20, 30]);
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(read, stable);
      yield* cached(query(0, 40));
      expect([...(yield* cached({ ...query(0, 40), count: 1 }))]).toEqual([
        ...takeRows(data, [0]),
      ]);
      yield* cached(query(-1, 20));
      expect(read.mock.calls.at(-1)![0].time.from).toBe(-1);
      yield* cached({ symbol: "A", time: { to: 40 } });
      expect(read).toHaveBeenCalledTimes(4);
    }),
  );
});

test("matches uncached selection across randomized overlapping ranges, counts and sparse gaps", async () => {
  let seed = 73;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const data = frame(
    Array.from({ length: 300 }, (_, i) => i * 3 + 1).filter(
      () => random(4) !== 0,
    ),
  );
  const read = source(() => data),
    direct = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(read, stable);
      for (let i = 0; i < 400; i++) {
        const from = random(1000),
          to = from + random(400) + 1;
        const q = random(2) ? query(from, to) : count(to, random(150) + 1);
        expect([...(yield* cached(q))], JSON.stringify(q)).toEqual([
          ...(yield* direct(q)),
        ]);
      }
    }),
  );
  expect(read.mock.calls.length).toBeLessThan(40);
  // 400 randomized reads take about 1 s locally but over 5 s on shared CI runners.
}, 20_000);

test("twenty observations over a historical window avoid 95 percent of native reads", async () => {
  const data = frame(Array.from({ length: 2000 }, (_, i) => i + 1));
  const read = source(() => data);
  await Effect.runPromise(
    Effect.gen(function* () {
      const { select: cached } = yield* cacheHistory(read, stable);
      for (let i = 0; i < 20; i++) {
        yield* cached(query(1000, 2001));
        yield* cached(count(1000, 501));
      }
    }),
  );
  expect(read).toHaveBeenCalledTimes(2);
});
