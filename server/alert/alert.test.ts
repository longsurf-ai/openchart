// Purpose: Verifies live-only firing, one-shot retirement, rule lifecycle, Drawing and Indicator sources, and per-rule failure isolation through Alert.Service.

import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { FeedError, FeedReasons, type BarsRequest } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { Bus } from "@openchart/server/bus";
import { Database } from "@openchart/server/db";
import { Events, SubscriberOverflowError } from "@openchart/server/events";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
import { calendarFeed } from "@openchart/server/feed/calendar/service";
import { logosFeed } from "@openchart/server/feed/logo/logo";
import { Feed } from "@openchart/server/feed/service";
import { Transactor } from "@openchart/server/lib/resource";
import * as ResourceEvents from "@openchart/server/lib/resource/events";
import { alertEventResource } from "@openchart/server/resources/alert-event";
import { chartResource } from "@openchart/server/resources/chart";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { drawingResource } from "@openchart/server/resources/drawing";
import { indicatorResource } from "@openchart/server/resources/indicator";
import {
  alertRuleResource,
  type AlertRule,
} from "@openchart/server/resources/alert-rule";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import { Monitoring } from "@openchart/server/monitoring";
import * as Tea from "@openchart/server/tea/tea";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { takeRows } from "@openchart/timeseries";
import {
  Cause,
  Effect,
  Fiber,
  Layer,
  Queue,
  Random,
  Schema,
  Stream,
} from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";

import { Alert } from "./alert";
import { alertStarters } from "./starters";

const NOW = 1_000_000;
const BAR = 120_000;
const inputs = {
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
} as const;
const sourceFailure = new FeedError({
  reason: new FeedReasons.SourceUnavailable({
    provider: ProviderId.make("binance"),
  }),
});
const price = alertStarters.find((starter) => starter.id === "price")!;
const parameters = { op: "exceeds", threshold: 10 };

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
      volume: 1,
      trades: 1,
      asOf: time + 1,
      final,
    })),
  });

/**
 * Real Tea, SQLite, Events and Bus over a fake Feed. The current bar is already
 * above the threshold in history, so any fire from a snapshot row would show.
 */
function environment(events = Events.layer) {
  const history = frames([
    { time: BAR - 60_000, close: 11, final: true },
    { time: BAR, close: 11, final: false },
  ]);
  const queue = Effect.runSync(
    Queue.unbounded<ReturnType<typeof frames>, FeedError | Cause.Done>(),
  );
  const calls: BarsRequest[] = [];
  const compiled: string[] = [];
  const disposed: string[] = [];
  let releases = 0;
  let failingOpens = 0;
  const bars = {
    getCapabilities: () => Effect.succeed([]),
    observe: Effect.fn("Test.bars.observe")(function* (request: BarsRequest) {
      calls.push(request);
      if (failingOpens > 0) {
        failingOpens--;
        return yield* Effect.fail(sourceFailure);
      }
      yield* Effect.addFinalizer(() => Effect.sync(() => releases++));
      const snapshot = yield* readBarsHistory(request, (bounds) => {
        const indices = [...history].flatMap((row, index) =>
          row.time >= (bounds.from ?? -Infinity) && row.time < bounds.to
            ? [index]
            : [],
        );
        return Effect.succeed(
          takeRows(
            history,
            bounds.count === undefined ? indices : indices.slice(-bounds.count),
          ),
        );
      });
      return { snapshot, updates: Stream.fromQueue(queue) };
    }),
  };
  const tea = Layer.effect(
    Tea.Service,
    Effect.map(Tea.Service, (real) =>
      Tea.Service.of({
        compile: (request) =>
          real
            .compile(request)
            .pipe(
              Effect.tap((node) => Effect.sync(() => compiled.push(node.id))),
            ),
        observe: real.observe,
        validate: real.validate,
        dispose: (request) =>
          real
            .dispose(request)
            .pipe(
              Effect.tap(() => Effect.sync(() => disposed.push(request.id))),
            ),
      }),
    ),
  ).pipe(
    Layer.provide(Tea.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Workspaces, {}),
        Layer.succeed(Feed, {
          getVersion: () => Effect.die("Unused"),
          get: () =>
            Effect.succeed({
              bars,
              symbology: {
                index: () => Effect.die("Unexpected index"),
                indexStatus: () => Effect.succeed([]),
                search: () => Effect.succeed([]),
              },
              logos: logosFeed(),
              calendar: calendarFeed,
            }),
        }),
      ),
    ),
  );
  const database = Layer.unwrap(
    Effect.map(Events.Service, (service) =>
      Database.layer(":memory:", ResourceEvents.makeOnCommitted(service)),
    ),
  ).pipe(Layer.provideMerge(events));
  return {
    layer: Alert.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(database, Bus.layer, tea, Monitoring.layer),
      ),
    ),
    /** One provisional attempt of the current bar. */
    tick: (close: number, final = false, time = BAR) =>
      Queue.offerUnsafe(queue, frames([{ time, close, final }])),
    calls,
    compiled,
    disposed,
    releases: () => releases,
    /** The next `count` source sessions fail to open, as an unreachable provider would. */
    failOpens: (count: number) => {
      failingOpens = count;
    },
  };
}
type Environment = ReturnType<typeof environment>;

function run<A, E>(
  env: Environment,
  program: Effect.Effect<
    A,
    E,
    Layer.Success<Environment["layer"]> | Scope.Scope
  >,
) {
  return Effect.runPromise(
    TestClock.setTime(NOW).pipe(
      Effect.andThen(program),
      Effect.scoped,
      Effect.provide(env.layer),
      // Jitter factor 1.0 keeps backoff wake-ups on whole test milliseconds.
      Effect.provideService(Random.Random, {
        nextIntUnsafe: () => 0,
        nextDoubleUnsafe: () => 0.5,
      }),
      Effect.provide(TestClock.layer()),
    ),
  );
}

/** The price starter above 10 unless `source` replaces it with a parameterless script. */
const createRule = ({
  parameters: starterParameters = parameters,
  source,
  ...options
}: {
  source?: string;
  repeat?: boolean;
  enabled?: boolean;
  parameters?: { op: string; threshold: number };
} = {}) =>
  Transactor.run(
    alertRuleResource.transitions.create(
      Schema.decodeUnknownSync(alertRuleResource.body)({
        name: "BTC above 10",
        enabled: true,
        repeat: true,
        ...options,
        alertable: {
          kind: "tea",
          source: source ?? price.legacySources[0],
          config: barsRuleConfig(inputs, source ? {} : starterParameters),
        },
      }),
    ),
  );
const disable = (rule: AlertRule) =>
  Transactor.run(
    alertRuleResource.transitions.patch({
      id: rule.id,
      expectedRevision: rule.revision,
      operations: [{ op: "replace", path: "/enabled", value: false }],
    }),
  );
const firedEvents = Transactor.run(alertEventResource.transitions.listAll());
/** Forks the service and collects every Bus message published from now on. */
const start = Effect.gen(function* () {
  const messages: { type: string; data: unknown }[] = [];
  const bus = yield* Bus.allBounded(64);
  yield* bus.pipe(
    Stream.runForEach(({ type, data }) =>
      Effect.sync(() => messages.push({ type, data })),
    ),
    Effect.forkScoped,
  );
  const alert = yield* Alert.Service;
  yield* alert.run().pipe(Effect.forkScoped);
  return messages;
});
const until = (assertion: () => void) =>
  Effect.promise(() => vi.waitFor(assertion));

test("three live ticks inside one bar record three events and three id-only Bus messages; the snapshot never fires", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const rule = yield* createRule();
      const messages = yield* start;
      for (const close of [11, 12, 13]) env.tick(close);
      yield* until(() => expect(messages).toHaveLength(3));
      // Stop the rule first: nothing can be recorded after its node is disposed.
      yield* disable(rule);
      yield* until(() => expect(env.disposed).toEqual(env.compiled));

      const events = yield* firedEvents;
      expect(events).toMatchObject(
        [11, 12, 13].map((value) => ({
          ruleId: rule.id,
          condition: "alert",
          time: BAR,
          detail: {
            title: "Price",
            message: "Price met its threshold condition",
            data: {
              inputs,
              parameters,
              symbol: "BTCUSDT",
              provider: "binance",
              resolution: "1m",
              values: { value },
            },
          },
        })),
      );
      expect(messages).toEqual(
        events.map((event) => ({
          type: "alert.fired",
          data: { ruleId: rule.id, eventId: event.id },
        })),
      );
      // The live window, then the standard warmup before its first bar.
      expect(env.calls).toMatchObject([
        { from: NOW - 1, to: "now", countBack: 1 },
        { from: BAR - 1, to: BAR, countBack: Tea.standardWarmupBars },
      ]);
    }),
  );
});

test("a one-shot rule records exactly one event for the same ticks and ends disabled", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const rule = yield* createRule({ repeat: false });
      const messages = yield* start;
      for (const close of [11, 12, 13]) env.tick(close);
      // The macro's own rule change stops the fiber; no test write is involved.
      yield* until(() => {
        expect(env.disposed).toHaveLength(1);
        expect(messages).not.toEqual([]);
      });
      const events = yield* firedEvents;
      expect(events).toMatchObject([
        { detail: { data: { values: { value: 11 } } } },
      ]);
      expect(messages).toEqual([
        {
          type: "alert.fired",
          data: { ruleId: rule.id, eventId: events[0]!.id },
        },
      ]);
      expect(
        yield* Transactor.run(alertRuleResource.transitions.get(rule.id)),
      ).toMatchObject({ enabled: false, revision: 2 });
    }),
  );
});

// One warmup bar supplies the previous close of 11 that "crosses" compares
// against, so only the second tick crosses 12 upwards.
test.each([
  { op: "below", ticks: [13, 11.5], fired: 11.5 },
  { op: "crosses", ticks: [11.5, 13], fired: 13 },
])(
  "the starter operator $op fires only when it holds",
  ({ op, ticks, fired }) => {
    const env = environment();
    return run(
      env,
      Effect.gen(function* () {
        const rule = yield* createRule({ parameters: { op, threshold: 12 } });
        const messages = yield* start;
        for (const close of ticks) env.tick(close);
        yield* until(() => expect(messages).toHaveLength(1));
        yield* disable(rule);
        yield* until(() => expect(env.disposed).toEqual(env.compiled));
        expect(yield* firedEvents).toMatchObject([
          {
            detail: { data: { parameters: { op }, values: { value: fired } } },
          },
        ]);
      }),
    );
  },
);

test("a restart never replays history", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const rule = yield* createRule();
      const messages = yield* start;
      yield* until(() => expect(env.calls).toHaveLength(2));
      // Any rule change restarts its fiber over the same above-threshold history.
      yield* Transactor.run(
        alertRuleResource.transitions.patch({
          id: rule.id,
          expectedRevision: rule.revision,
          operations: [{ op: "replace", path: "/name", value: "Renamed" }],
        }),
      );
      yield* until(() => expect(env.calls).toHaveLength(4));
      expect(env.disposed).toEqual(env.compiled.slice(0, 1));
      env.tick(12);
      yield* until(() => expect(messages).toHaveLength(1));
      expect(yield* firedEvents).toMatchObject([
        { detail: { data: { values: { value: 12 } } } },
      ]);
    }),
  );
});

test.each(["disable", "delete"] as const)(
  "%s interrupts the rule's fiber and disposes its Tea node",
  (change) => {
    const env = environment();
    return run(
      env,
      Effect.gen(function* () {
        const rule = yield* createRule();
        yield* start;
        yield* until(() => expect(env.calls).toHaveLength(2));
        expect(env.disposed).toEqual([]);
        yield* change === "disable"
          ? disable(rule)
          : Transactor.run(alertRuleResource.transitions.remove(rule.id));
        yield* until(() => expect(env.disposed).toEqual(env.compiled));
        expect(env.compiled).toHaveLength(1);
        expect(env.releases()).toBe(2);
      }),
    );
  },
);

test("interrupting run stops every rule fiber and disposes its Tea node before returning", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      yield* createRule();
      const alert = yield* Alert.Service;
      const service = yield* alert.run().pipe(Effect.forkScoped);
      yield* until(() => expect(env.calls).toHaveLength(2));
      expect(env.disposed).toEqual([]);
      // Tea and the Feed are still open here: only the rule fiber can dispose.
      yield* Fiber.interrupt(service);
      expect(env.compiled).toHaveLength(1);
      expect(env.disposed).toEqual(env.compiled);
      expect(env.releases()).toBe(2);
    }),
  );
});

test("a script without alertcondition starts no observation", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      yield* createRule({ source: 'emit "price" close' });
      yield* start;
      yield* until(() => expect(env.disposed).toHaveLength(1));
      expect(env.disposed).toEqual(env.compiled);
      expect(env.calls).toEqual([]);
    }),
  );
});

test("a rule that fails to compile, and a disabled one, leave another rule firing", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      yield* createRule({ source: "this is not Tea (" });
      yield* createRule({ enabled: false });
      const rule = yield* createRule();
      const messages = yield* start;
      env.tick(12);
      yield* until(() => expect(messages).toHaveLength(1));
      expect(yield* firedEvents).toMatchObject([{ ruleId: rule.id }]);
      expect(env.compiled).toHaveLength(1);
    }),
  );
});

test("non-finite outputs are dropped from detail.values", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      // Tea reports both a division by zero and an overflow as NaN, never Infinity.
      yield* createRule({
        source: [
          'emit "price" close',
          'emit "divided" close / (close - close)',
          'emit "overflowed" math.exp(close * 100)',
          'alertcondition("hit", close > 10, "Hit", "Above ten")',
        ].join("\n"),
      });
      const messages = yield* start;
      env.tick(12);
      yield* until(() => expect(messages).toHaveLength(1));
      const [event] = yield* firedEvents;
      expect(event).toMatchObject({ condition: "hit", time: BAR });
      expect(event!.detail.data.values).toEqual({ price: 12 });
    }),
  );
});

test("a subscriber overflow resubscribes and restarts every enabled rule", () => {
  let overflowed = false;
  const env = environment(
    Layer.effect(
      Events.Service,
      Effect.map(Events.make, (events) => ({
        ...events,
        allBounded: (capacity) => {
          if (overflowed) return events.allBounded(capacity);
          overflowed = true;
          return Effect.succeed(
            Stream.fail(new SubscriberOverflowError({ capacity })),
          );
        },
      })),
    ),
  );
  return run(
    env,
    Effect.gen(function* () {
      yield* createRule();
      const messages = yield* start;
      // The retry pause may begin after an adjust, so keep nudging the clock.
      while (env.compiled.length < 2) {
        yield* TestClock.adjust("1 second");
        yield* Effect.promise(() => new Promise((done) => setTimeout(done, 5)));
      }
      yield* until(() => expect(env.calls).toHaveLength(4));
      expect(env.disposed).toEqual(env.compiled.slice(0, 1));
      env.tick(12);
      yield* until(() => expect(messages).toHaveLength(1));
    }),
  );
});

const createDrawingRule = Effect.fn("Test.createDrawingRule")(function* (
  repeat = true,
) {
  const dashboard = yield* Transactor.run(
    dashboardResource.transitions.create(
      Schema.decodeUnknownSync(dashboardResource.body)({ name: "Lines" }),
    ),
  );
  const drawing = yield* Transactor.run(
    drawingResource.transitions.create(
      Schema.decodeUnknownSync(drawingResource.body)({
        dashboardId: dashboard.id,
        provider: inputs.provider,
        listing: inputs.listing,
        data: Drawing.create(
          "horizontal_line",
          [{ time: (BAR - 60_000) / 1000, price: 12 }],
          { id: "line" },
        ),
      }),
    ),
  );
  const rule = yield* Transactor.run(
    alertRuleResource.transitions.create(
      Schema.decodeUnknownSync(alertRuleResource.body)({
        name: "Drawing crossing",
        enabled: true,
        repeat,
        alertable: {
          kind: "drawing",
          drawingId: drawing.id,
          operator: "crossing_up",
          inputs,
        },
      }),
    ),
  );
  return { drawing, rule };
});

test("drawing edits replace execution without rewriting rules; hidden drawings still fire and deletion preserves history", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const { drawing, rule } = yield* createDrawingRule();
      const messages = yield* start;
      yield* until(() => expect(env.calls).toHaveLength(2));
      env.tick(13, true);
      yield* until(() => expect(messages).toHaveLength(1));
      const moved = yield* Transactor.run(
        drawingResource.transitions.patch({
          id: drawing.id,
          expectedRevision: drawing.revision,
          operations: [
            { op: "replace", path: "/data/anchors/0/price", value: 14 },
          ],
        }),
      );
      yield* until(() => expect(env.calls).toHaveLength(4));
      expect(env.disposed).toEqual(env.compiled.slice(0, 1));
      expect(
        yield* Transactor.run(alertRuleResource.transitions.get(rule.id)),
      ).toEqual(rule);
      env.tick(13, true);
      env.tick(15, true, BAR + 60_000);
      yield* until(() => expect(messages).toHaveLength(2));
      const hidden = yield* Transactor.run(
        drawingResource.transitions.patch({
          id: drawing.id,
          expectedRevision: moved.revision,
          operations: [{ op: "replace", path: "/data/hidden", value: true }],
        }),
      );
      yield* until(() => expect(env.calls).toHaveLength(6));
      env.tick(15, true);
      yield* until(() => expect(messages).toHaveLength(3));
      const events = yield* firedEvents;
      expect(events.map((event) => event.detail.data.drawingRevision)).toEqual([
        drawing.revision,
        moved.revision,
        hidden.revision,
      ]);
      yield* Transactor.run(drawingResource.transitions.remove(drawing.id));
      yield* until(() => expect(env.disposed).toEqual(env.compiled));
      // The source-missing branch disables the rule before its observer finishes.
      expect(
        yield* Transactor.run(alertRuleResource.transitions.get(rule.id)),
      ).toMatchObject({ enabled: false });
      expect(yield* firedEvents).toEqual(events);
    }),
  );
});

test("moving a drawing never rearms a fired Once rule", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const { drawing, rule } = yield* createDrawingRule(false);
      const messages = yield* start;
      yield* until(() => expect(env.calls).toHaveLength(2));
      env.tick(13, true);
      yield* until(() => {
        expect(messages).toHaveLength(1);
        expect(env.disposed).toEqual(env.compiled);
      });
      yield* Transactor.run(
        drawingResource.transitions.patch({
          id: drawing.id,
          expectedRevision: drawing.revision,
          operations: [
            { op: "replace", path: "/data/anchors/0/price", value: 10 },
          ],
        }),
      );
      expect(
        yield* Transactor.run(alertRuleResource.transitions.get(rule.id)),
      ).toMatchObject({ enabled: false });
      expect(env.compiled).toHaveLength(1);
      expect(yield* firedEvents).toHaveLength(1);
    }),
  );
});

const averageSource = [
  'indicator("Average", overlay = false)',
  "length = input.int(2)",
  'plot("avg", ta.sma(close, length))',
  'hline("mid", 50)',
].join("\n");
/** A chart cell on the market `inputs` names. */
const marketCell = () => ({
  id: "ccl_a",
  resolution: inputs.resolution,
  session: inputs.session,
  adjustment: inputs.adjustment,
  marketSources: [
    { id: "cms_a", provider: inputs.provider, listing: inputs.listing },
  ],
  panes: [
    {
      id: "cpn_a",
      series: [
        {
          id: "csr_main",
          role: "main",
          source: { kind: "market", marketSourceId: "cms_a", output: "price" },
        },
      ],
    },
  ],
});
const createIndicator = (chartId: string) =>
  Transactor.run(
    indicatorResource.transitions.create(
      Schema.decodeUnknownSync(indicatorResource.body)({
        chartId,
        cellId: "ccl_a",
        source: { workspaceId: "wsp_test", path: "average.tea" },
        snapshot: { "average.tea": averageSource },
        parameterOverrides: {},
      }),
    ),
  );

/** A rule that fires while the followed Indicator's average exceeds 12. */
const createIndicatorRule = Effect.fn("Test.createIndicatorRule")(function* () {
  const dashboard = yield* Transactor.run(
    dashboardResource.transitions.create(
      Schema.decodeUnknownSync(dashboardResource.body)({ name: "Studies" }),
    ),
  );
  const chart = yield* Transactor.run(
    chartResource.transitions.create(
      Schema.decodeUnknownSync(chartResource.body)({
        dashboardId: dashboard.id,
        cells: [marketCell()],
      }),
    ),
  );
  const indicator = yield* createIndicator(chart.id);
  const rule = yield* Transactor.run(
    alertRuleResource.transitions.create(
      Schema.decodeUnknownSync(alertRuleResource.body)({
        name: "Average above 12",
        enabled: true,
        repeat: true,
        alertable: {
          kind: "tea",
          source: [
            'average = input.series("indicator.avg")',
            'emit "average" average',
            'alertcondition("hit", average > 12, "Hit", "Average above 12")',
          ].join("\n"),
          config: { indicatorId: indicator.id, parameters: {}, requests: {} },
        },
      }),
    ),
  );
  return { dashboard, chart, indicator, rule };
});

// One warmup bar supplies the previous close of 11 to the Indicator's
// two-bar average, so only the second tick lifts it above 12.
test("an Indicator rule observes its cell's market together with the Indicator and records which Indicator revision fired", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const { indicator, rule } = yield* createIndicatorRule();
      const messages = yield* start;
      // The live read, then the warmup prefix read: the rule and the Indicator
      // share one session on the cell's market.
      yield* until(() => expect(env.calls).toHaveLength(2));
      expect(env.calls).toMatchObject([inputs, inputs]);
      // The rule and the Indicator it reads.
      expect(env.compiled).toHaveLength(2);
      for (const close of [12, 15]) env.tick(close);
      yield* until(() => expect(messages).toHaveLength(1));
      const events = yield* firedEvents;
      expect(events).toMatchObject([
        {
          ruleId: rule.id,
          condition: "hit",
          time: BAR,
          detail: {
            data: {
              indicatorId: indicator.id,
              indicatorRevision: indicator.revision,
              symbol: "BTCUSDT",
              values: { average: 13 },
            },
          },
        },
      ]);
      expect(events[0]!.detail.data.inputs).toEqual(inputs);
    }),
  );
});

test("Indicator edits and a new cell symbol restart the rule on the new program and listing", () => {
  const env = environment();
  const eth = { ...inputs.listing, symbol: "ETHUSDT", name: "Ethereum" };
  return run(
    env,
    Effect.gen(function* () {
      const { chart, indicator, rule } = yield* createIndicatorRule();
      const messages = yield* start;
      yield* until(() => expect(env.calls).toHaveLength(2));
      const edited = yield* Transactor.run(
        indicatorResource.transitions.patch({
          id: indicator.id,
          expectedRevision: indicator.revision,
          operations: [
            {
              op: "replace",
              path: "/parameterOverrides",
              value: { length: 1 },
            },
          ],
        }),
      );
      yield* until(() => expect(env.calls).toHaveLength(4));
      expect(env.compiled).toHaveLength(4);
      expect(new Set(env.disposed)).toEqual(new Set(env.compiled.slice(0, 2)));
      // A two-bar average of 11 and 13 would not exceed 12; the edit's one-bar one does.
      env.tick(13);
      yield* until(() => expect(messages).toHaveLength(1));
      yield* Transactor.run(
        chartResource.transitions.patch({
          id: chart.id,
          expectedRevision: chart.revision,
          operations: [
            {
              op: "replace",
              path: "/cells/0/marketSources/0/listing",
              value: eth,
            },
          ],
        }),
      );
      yield* until(() => expect(env.calls).toHaveLength(6));
      expect(env.calls[4]).toMatchObject({ ...inputs, listing: eth });
      expect(new Set(env.disposed)).toEqual(new Set(env.compiled.slice(0, 4)));
      env.tick(14);
      yield* until(() => expect(messages).toHaveLength(2));
      const events = yield* firedEvents;
      expect(events).toMatchObject(
        [
          { symbol: "BTCUSDT", average: 13 },
          { symbol: "ETHUSDT", average: 14 },
        ].map(({ symbol, average }) => ({
          ruleId: rule.id,
          detail: {
            data: {
              indicatorRevision: edited.revision,
              symbol,
              values: { average },
            },
          },
        })),
      );
      expect(events[1]!.detail.data.inputs).toEqual({
        ...inputs,
        listing: eth,
      });
    }),
  );
});

test("adding another Indicator to the chart or changing its preset keeps the rule observing", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const { chart } = yield* createIndicatorRule();
      yield* start;
      yield* until(() => expect(env.calls).toHaveLength(2));
      const other = yield* createIndicator(chart.id);
      const bound = yield* Transactor.run(
        chartResource.transitions.patch({
          id: chart.id,
          expectedRevision: chart.revision,
          operations: [
            {
              op: "add",
              path: "/cells/0/panes/-",
              value: {
                id: "cpn_b",
                series: [
                  {
                    id: "csr_b",
                    role: "normal",
                    source: {
                      kind: "indicator",
                      indicatorId: other.id,
                      output: "avg",
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
      yield* Transactor.run(
        chartResource.transitions.patch({
          id: chart.id,
          expectedRevision: bound.revision,
          operations: [{ op: "replace", path: "/preset", value: "2x1" }],
        }),
      );
      // Changes are handled in order and a restart disposes before it moves on,
      // so once a later rule observes, any restart would already show here.
      yield* createRule();
      yield* until(() => expect(env.calls).toHaveLength(4));
      expect(env.calls[2]).toMatchObject(inputs);
      expect(env.compiled).toHaveLength(3);
      expect(env.disposed).toEqual([]);
    }),
  );
});

test.each(["indicator", "chart", "dashboard"] as const)(
  "deleting the rule's %s disables it and keeps its events",
  (deleted) => {
    const env = environment();
    return run(
      env,
      Effect.gen(function* () {
        const { dashboard, chart, indicator, rule } =
          yield* createIndicatorRule();
        const messages = yield* start;
        yield* until(() => expect(env.calls).toHaveLength(2));
        env.tick(15);
        yield* until(() => expect(messages).toHaveLength(1));
        const events = yield* firedEvents;
        yield* deleted === "indicator"
          ? Transactor.run(indicatorResource.transitions.remove(indicator.id))
          : deleted === "chart"
            ? Transactor.run(chartResource.transitions.remove(chart.id))
            : Transactor.run(
                dashboardResource.transitions.remove(dashboard.id),
              );
        // The replacement observer disables the rule once it finds nothing to follow.
        while (
          (yield* Transactor.run(alertRuleResource.transitions.get(rule.id)))
            .enabled
        )
          yield* Effect.promise(
            () => new Promise((done) => setTimeout(done, 5)),
          );
        expect(env.compiled).toHaveLength(2);
        expect(new Set(env.disposed)).toEqual(new Set(env.compiled));
        expect(yield* firedEvents).toEqual(events);
      }),
    );
  },
);

test("a failing source marks the rule failed and retries until it evaluates and fires again", () => {
  const env = environment();
  env.failOpens(2);
  return run(
    env,
    Effect.gen(function* () {
      const rule = yield* createRule();
      const monitoring = yield* Monitoring.Service;
      const status = () =>
        Effect.runSync(monitoring.status).find(
          (item) => item.key === `alert/${rule.id}`,
        );
      const messages = yield* start;
      yield* until(() =>
        expect(status()).toMatchObject({
          label: "BTC above 10",
          health: {
            state: "failed",
            reason: {
              code: "tea.upstream",
              message: sourceFailure.message,
            },
          },
        }),
      );
      // Step through the backoff (about 1 s, then 2 s); the second attempt fails
      // too, and the third reads its window and then its warmup.
      for (let step = 0; step < 20 && env.calls.length < 4; step++) {
        yield* TestClock.adjust("500 millis");
        yield* Effect.promise(
          () => new Promise((done) => setTimeout(done, 10)),
        );
      }
      expect(env.calls).toHaveLength(4);
      // The warmed snapshot is the first successful evaluation.
      yield* until(() =>
        expect(status()!.health).toEqual({ state: "healthy" }),
      );
      expect(status()!.checks).toMatchObject([
        { label: "Alert evaluation", health: { state: "healthy" } },
      ]);
      expect(yield* firedEvents).toEqual([]);
      env.tick(12);
      yield* until(() => expect(messages).toHaveLength(1));
    }),
  );
});

test("a false condition still counts as a successful evaluation", () => {
  const env = environment();
  return run(
    env,
    Effect.gen(function* () {
      const rule = yield* createRule();
      const monitoring = yield* Monitoring.Service;
      const check = () =>
        Effect.runSync(monitoring.status).find(
          (item) => item.key === `alert/${rule.id}`,
        )?.checks[0];
      yield* start;
      yield* until(() => expect(check()?.health.state).toBe("healthy"));
      const warmed = check()!.lastOkAt!;
      yield* TestClock.adjust("2 seconds");
      env.tick(9);
      yield* until(() => expect(check()!.lastOkAt).toBe(warmed + 2_000));
      expect(yield* firedEvents).toEqual([]);
    }),
  );
});
