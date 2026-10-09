// Purpose: Prove cold scoped Tea alerts, explicit subject binding, Indicator following, and a real fifty-symbol static scan.
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import {
  BarsSeries,
  type BarsRequest,
  type FeedError,
  type Resolution,
} from "@openchart/feed";
import { Feed } from "@openchart/server/feed/service";
import { calendarFeed } from "@openchart/server/feed/calendar/service";
import { logosFeed } from "@openchart/server/feed/logo/logo";
import { seriesFeed } from "@openchart/server/feed/series/series";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
import { indicatorResource } from "@openchart/server/resources/indicator";
import {
  compileIndicator,
  followIndicatorNodes,
} from "@openchart/server/resources/macros/follow-indicator";
import * as Tea from "@openchart/server/tea/tea";
import { Workspaces } from "@openchart/server/workspace/workspace";

import { takeRows } from "@openchart/timeseries";
import { Cause, Effect, Fiber, Layer, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import type { AlertOccurrence } from "./alertable";
import { residualVolatilityExample } from "./residual-example";
import { TeaAlerts } from "./tea-alerts";
import { alertStarters } from "./starters";
import { buildConditions } from "./conditions";

const BAR = 2000 * 60_000;
const series = (symbol: string) =>
  Schema.decodeUnknownSync(BarsSeries)({
    provider: "binance",
    listing: {
      symbol,
      name: symbol,
      class: "stock",
      venue: "TEST",
      currency: "USD",
    },
    resolution: "1m",
    session: "24h",
    adjustment: "raw",
  });
const frames = (
  values: readonly { time: number; close: number; final: boolean }[],
) =>
  binanceBars.frame.create({
    labels: {},
    rows: values.map(({ time, close, final }) => ({
      time,
      close,
      open: close,
      high: close,
      low: close,
      volume: close,
      trades: 1,
      asOf: time + 1,
      final,
    })),
  });
// Feed offers `offered` bars at the test series' session and adjustment.
function environment(historyCount = 12, offered: readonly Resolution[] = []) {
  const queues = new Map<
    string,
    Queue.Queue<ReturnType<typeof frames>, FeedError | Cause.Done>
  >();
  const calls: BarsRequest[] = [];
  let acquired = 0;
  let released = 0;
  let compiled = 0;
  let disposed = 0;
  const base = Tea.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Workspaces, {}),
        Layer.succeed(Feed, {
          getVersion: () => Effect.die("Unused"),
          get: () =>
            Effect.succeed({
              bars: {
                getCapabilities: () =>
                  Effect.succeed(
                    offered.map((resolution) => ({
                      resolution,
                      session: "24h" as const,
                      adjustment: "raw" as const,
                      modes: ["history", "live"] as const,
                    })),
                  ),
                observe: Effect.fn("Test.multiInput")(function* (
                  request: BarsRequest,
                ) {
                  calls.push(request);
                  acquired++;
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      released++;
                    }),
                  );
                  const symbol = request.listing.symbol;
                  let queue = queues.get(symbol);
                  if (!queue) {
                    queue = yield* Queue.unbounded<
                      ReturnType<typeof frames>,
                      FeedError | Cause.Done
                    >();
                    queues.set(symbol, queue);
                  }
                  const history = frames(
                    Array.from({ length: historyCount }, (_, index) => ({
                      time: BAR - (historyCount - 1 - index) * 60_000,
                      close:
                        symbol === "SPY" ? 100 : index % 2 === 0 ? 100 : 101,
                      final: index < historyCount - 1,
                    })),
                  );
                  const snapshot = yield* readBarsHistory(request, (bounds) => {
                    const indices = [...history].flatMap((row, index) =>
                      row.time >= (bounds.from ?? -Infinity) &&
                      row.time < bounds.to
                        ? [index]
                        : [],
                    );
                    return Effect.succeed(
                      takeRows(
                        history,
                        bounds.count === undefined
                          ? indices
                          : indices.slice(-bounds.count),
                      ),
                    );
                  });
                  return {
                    snapshot,
                    ...(request.to === "now"
                      ? { updates: Stream.fromQueue(queue) }
                      : {}),
                  };
                }),
              },
              symbology: {
                index: () => Effect.die("Unused"),
                indexStatus: () => Effect.succeed([]),
                search: () => Effect.succeed([]),
              },
              calendar: calendarFeed,
              logos: logosFeed(),
              series: seriesFeed(),
            }),
        }),
      ),
    ),
  );
  const layer = Layer.effect(
    Tea.Service,
    Effect.map(Tea.Service, (real) =>
      Tea.Service.of({
        ...real,
        compile: (request) =>
          real.compile(request).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                compiled++;
              }),
            ),
          ),
        dispose: (request) =>
          real.dispose(request).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                disposed++;
              }),
            ),
          ),
      }),
    ),
  ).pipe(Layer.provide(base));
  return {
    layer,
    calls,
    tick: (symbol: string, close: number, time = BAR) =>
      Queue.offerUnsafe(
        queues.get(symbol)!,
        frames([{ time, close, final: false }]),
      ),
    counts: () => ({ acquired, released, compiled, disposed }),
  };
}
const until = (assertion: () => void) =>
  Effect.promise(() => vi.waitFor(assertion, { timeout: 5000 }));
function run<A, E>(
  env: ReturnType<typeof environment>,
  effect: Effect.Effect<A, E, Tea.Service>,
) {
  return Effect.runPromise(
    TestClock.setTime(BAR + 30_000).pipe(
      Effect.andThen(effect),
      Effect.provide(env.layer),
      Effect.provide(TestClock.layer()),
    ),
  );
}

const symbols =
  "AAPL MSFT NVDA AMZN GOOGL META BRK.B AVGO TSLA JPM V UNH XOM MA COST WMT HD PG NFLX JNJ ABBV BAC KO CRM ORCL CVX MRK CSCO ABT WFC IBM MCD GE CAT AXP PM GS NOW ISRG QCOM TXN DIS AMGN INTU RTX PFE VZ T UBER AMD".split(
    " ",
  );

test("unresolved drawing history fails and releases the entire observation before accepting updates", () => {
  const env = environment();
  return run(
    env,
    Effect.scoped(
      Effect.gen(function* () {
        const error = yield* new TeaAlerts({
          source:
            'emit "ready" 0.0\nalertcondition("hit", true, "Hit", "Unavailable geometry")',
          config: {
            ...Tea.barsInputs(series("SPY")),
            parameters: {},
            requests: {},
          },
          from: BAR - 11 * 60_000,
          readyOutput: "ready",
          warmupBars: 1,
        })
          .observe()
          .pipe(Stream.runDrain, Effect.flip);
        expect(error.code).toBe("invalid_data");
        expect(error.message).toMatch(/anchors/);
        expect(env.calls[0]!.from).toBe(BAR - 11 * 60_000);
        expect(env.counts().disposed).toBe(1);
        expect(env.counts().released).toBe(env.counts().acquired);
      }),
    ),
  );
});

test("future drawing windows warm recent bars and reject lost live readiness", () => {
  const env = environment();
  return run(
    env,
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* new TeaAlerts({
          source:
            'emit "ready" close < 110 ? 1.0 : 0.0\nalertcondition("hit", close > 110, "Hit", "Must not escape")',
          config: {
            ...Tea.barsInputs(series("SPY")),
            parameters: {},
            requests: {},
          },
          from: BAR + 10 * 60_000,
          readyOutput: "ready",
          warmupBars: 2,
        })
          .observe()
          .pipe(Stream.runCollect, Effect.flip, Effect.forkChild);
        yield* until(() => expect(env.calls.length).toBeGreaterThan(0));
        expect(env.calls[0]!.from).toBe(BAR + 30_000 - 1);
        env.tick("SPY", 150, BAR + 60_000);
        const error = yield* Fiber.join(fiber);
        // A drawing warms exactly its own bars, never the standard 1000.
        expect(env.calls[1]).toMatchObject({ countBack: 2 });
        expect(error.code).toBe("invalid_data");
        expect(error.message).toMatch(/geometry became unavailable/);
        expect(env.counts().disposed).toBe(1);
        expect(env.counts().released).toBe(env.counts().acquired);
      }),
    ),
  );
});

// Compiling and binding 51 inputs can exceed the default five seconds on CI.
test("fifty static subjects compile and emit correctly bound residual/volatility occurrences, then release all inputs", () => {
  const env = environment();
  const definition = residualVolatilityExample(
    series("SPY"),
    symbols.map(series),
  );
  // The first request is rebound after source generation: event identity must
  // follow the actual bound data, not the original request.security spelling.
  const first = definition.config.requests.stock_0!;
  const rebound = {
    ...definition,
    config: {
      ...definition.config,
      requests: {
        ...definition.config.requests,
        stock_0: { ...first, ...Tea.barsInputs(series("REBOUND")) },
      },
    },
  };
  return run(
    env,
    Effect.scoped(
      Effect.gen(function* () {
        const source = new TeaAlerts(rebound);
        const stream = source.observe().pipe(Stream.flattenIterable);
        expect(env.counts()).toEqual({
          acquired: 0,
          released: 0,
          compiled: 0,
          disposed: 0,
        });
        const events: AlertOccurrence<Schema.JsonObject>[] = [];
        const fiber = yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ),
          Effect.forkScoped,
        );
        yield* until(() =>
          expect(env.calls.filter((call) => call.to === "now")).toHaveLength(
            51,
          ),
        );
        expect(events).toEqual([]);
        for (const symbol of ["REBOUND", ...symbols.slice(1)])
          env.tick(symbol, 120);
        yield* Effect.yieldNow;
        env.tick("SPY", 100);
        yield* until(() => expect(events).toHaveLength(50));
        expect(events.map((event) => event.data.symbol)).toEqual([
          "REBOUND",
          ...symbols.slice(1),
        ]);
        const previousReturns = [-100 / 101, 1, -100 / 101, 1, -100 / 101];
        const mean = previousReturns.reduce((sum, value) => sum + value, 0) / 5;
        const deviation = Math.sqrt(
          previousReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            5,
        );
        for (const event of events) {
          expect(event.condition).toBe("residual");
          expect(event.time).toBe(BAR);
          expect(event.data).toMatchObject({
            provider: "binance",
            resolution: "1m",
            residual: 20,
          });
          expect(Number(event.data.volatility)).toBeCloseTo(deviation, 10);
        }
        yield* Fiber.interrupt(fiber);
        expect(env.counts().disposed).toBe(1);
        expect(env.counts().released).toBe(env.counts().acquired);
      }),
    ),
  );
}, 15_000);

test.each(["missing", "__proto__", "toString"])(
  "invalid payload input %s fails with cleanup",
  (input) => {
    const env = environment();
    const definition = {
      source: `struct Data\n    array<string> input\n    string symbol\nalert("event", true, "Title", "Message", Data.new(array.from(${JSON.stringify(input)}), "Wrong"))`,
      config: {
        ...Tea.barsInputs(series("SPY")),
        parameters: {},
        requests: {},
      },
    };
    return run(
      env,
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* new TeaAlerts(definition)
            .observe()
            .pipe(Stream.runDrain, Effect.flip, Effect.forkScoped);
          yield* until(() =>
            expect(env.calls.filter((call) => call.to === "now")).toHaveLength(
              1,
            ),
          );
          env.tick("SPY", 100);
          const error: Tea.Error = yield* Fiber.join(fiber);
          expect(error.message).toMatch(/input does not exist/);
          expect(env.counts().released).toBe(env.counts().acquired);
          expect(env.counts().disposed).toBe(1);
        }),
      ),
    );
  },
);

test("movement windows over the standard warmup have their first live comparison available", () => {
  const env = environment(1510);
  const source = alertStarters[0]!.source;
  const config = {
    ...Tea.barsInputs(series("SPY")),
    parameters: {
      op: "moving_up",
      threshold: 0,
      lower: 0,
      upper: 1,
      amount: 1,
      bars: 1500,
    },
    requests: {},
  };
  return run(
    env,
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* new TeaAlerts({ source, config })
          .observe()
          .pipe(
            Stream.flattenIterable,
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
          );
        yield* until(() => expect(env.calls).toHaveLength(2));
        expect(env.calls[1]!.countBack).toBeGreaterThanOrEqual(1500);
        env.tick("SPY", 102);
        expect(yield* Fiber.join(fiber)).toHaveLength(1);
        expect(env.counts().released).toBe(env.counts().acquired);
      }),
    ),
  );
});

test.each([
  {
    source:
      'child = request.security("Other", "1", close)\nalertcondition("event", child > 0, "Title", "Message")',
    requests: true,
    expected: undefined,
  },
  {
    source:
      'struct Data\n    array<string> input\n    string symbol\nalert("event", true, "Title", "Message", Data.new(array.new<string>(0), "Wrong"))',
    requests: false,
    expected: "SPY",
  },
])(
  "subject identity is explicit, including the root path ($expected)",
  ({ source, requests, expected }) => {
    const env = environment();
    const config: Tea.NodeConfig = {
      ...Tea.barsInputs(series("SPY")),
      parameters: {},
      requests: requests
        ? {
            child: {
              ...Tea.barsInputs(series("Other")),
              parameters: {},
              requests: {},
            },
          }
        : {},
    };
    return run(
      env,
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* new TeaAlerts({ source, config })
            .observe()
            .pipe(
              Stream.flattenIterable,
              Stream.take(1),
              Stream.runCollect,
              Effect.forkScoped,
            );
          yield* until(() =>
            expect(env.calls.filter((call) => call.to === "now")).toHaveLength(
              requests ? 2 : 1,
            ),
          );
          env.tick("SPY", 100);
          const [event] = yield* Fiber.join(fiber);
          expect(event!.data.symbol).toBe(expected);
          expect(event!.data.provider).toBe(expected ? "binance" : undefined);
          expect(event!.data.resolution).toBe(expected ? "1m" : undefined);
          expect(env.counts().disposed).toBe(1);
          expect(env.counts().released).toBe(env.counts().acquired);
        }),
      ),
    );
  },
);

const followed = (
  parameterOverrides: Tea.ParameterOverrides,
  header = 'indicator("T", overlay = false)',
) =>
  Schema.decodeUnknownSync(indicatorResource.entity)({
    id: "ind_avg",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_a",
    cellId: "ccl_a",
    source: { workspaceId: "wsp_test", path: "avg.tea" },
    snapshot: {
      "avg.tea": `${header}\nlength = input.int(2)\nplot("avg", ta.sma(close, length))\nhline("level", 50.0)`,
    },
    parameterOverrides,
  });
const crossing = buildConditions({
  combinator: "and",
  rules: [
    {
      field: "indicator.avg",
      operator: "crossing_up",
      value: { threshold: 108, lower: 0, upper: 1, amount: 1, bars: 1 },
    },
  ],
});

// SPY history closes at 100, so the SMA leaves 100 only on the live ticks.
test.each<{ parameterOverrides: Tea.ParameterOverrides; avg: number }>([
  // (100 + 118) / 2 crosses 108 on the first tick.
  { parameterOverrides: {}, avg: 109 },
  // (3 * 100 + 118) / 4 stays below; (3 * 100 + 140) / 4 crosses.
  { parameterOverrides: { length: 4 }, avg: 110 },
])(
  "a followed Indicator with $parameterOverrides fires its plot crossing on one shared market, then disposes both nodes",
  ({ parameterOverrides, avg }) => {
    const env = environment();
    return run(
      env,
      Effect.gen(function* () {
        // The caller compiles and expands the Indicator, as the Alert runner does.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const indicator = followed(parameterOverrides);
            const { config, nodes } = yield* followIndicatorNodes(
              { parameters: crossing.parameters, requests: {} },
              { indicator, market: series("SPY") },
              yield* compileIndicator(indicator),
            );
            const fiber = yield* new TeaAlerts({
              source: crossing.source,
              config,
              nodes,
            })
              .observe()
              .pipe(
                Stream.flattenIterable,
                Stream.take(1),
                Stream.runCollect,
                Effect.forkScoped,
              );
            yield* until(() =>
              expect(
                env.calls.filter((call) => call.to === "now"),
              ).toHaveLength(1),
            );
            env.tick("SPY", 118);
            env.tick("SPY", 140);
            const [event] = yield* Fiber.join(fiber);
            expect(event!.time).toBe(BAR);
            expect(event!.data.inputs).toEqual(series("SPY"));
            expect(event!.data.values).toEqual({
              value: avg,
              "indicator.avg_0": avg,
            });
          }),
        );
        expect(env.counts()).toMatchObject({ compiled: 2, disposed: 2 });
        expect(env.counts().released).toBe(env.counts().acquired);
      }),
    );
  },
);

test("a followed Indicator's override naming no parameter fails before observing, and its compilation is released", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const indicator = followed({ missing: 1 });
      const error = yield* Effect.scoped(
        Effect.gen(function* () {
          return yield* followIndicatorNodes(
            { parameters: crossing.parameters, requests: {} },
            { indicator, market: series("SPY") },
            yield* compileIndicator(indicator),
          );
        }),
      ).pipe(Effect.flip);
      expect(error.code).toBe("invalid_request");
      expect(error.message).toMatch(/“missing” no longer exists/);
      expect(env.counts()).toMatchObject({
        acquired: 0,
        compiled: 1,
        disposed: 1,
      });
    }),
  );
});

test("a rule following an auto Indicator runs on its finer bars and names them", () => {
  const env = environment(12, ["1m", "5m"]);
  return run(
    env,
    Effect.scoped(
      Effect.gen(function* () {
        const indicator = followed(
          {},
          'indicator("T", overlay = false, timeframe = "auto")',
        );
        const { config, nodes } = yield* followIndicatorNodes(
          { parameters: crossing.parameters, requests: {} },
          { indicator, market: { ...series("SPY"), resolution: "5m" } },
          yield* compileIndicator(indicator),
        );
        const fiber = yield* new TeaAlerts({
          source: crossing.source,
          config,
          nodes,
        })
          .observe()
          .pipe(
            Stream.flattenIterable,
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
          );
        yield* until(() =>
          expect(env.calls.filter((call) => call.to === "now")).toHaveLength(1),
        );
        env.tick("SPY", 118);
        const [event] = yield* Fiber.join(fiber);
        // The rule and the Indicator share one session of 1m bars, and its
        // warmup read.
        expect(env.calls.map(({ resolution }) => resolution)).toEqual([
          "1m",
          "1m",
        ]);
        expect(event!.data.inputs).toEqual(series("SPY"));
        expect(event!.data.resolution).toBe("1m");
      }),
    ),
  );
});
