// Purpose: Prove notification timing (60 s), coalescing, recovery notices and transition-only events.

import { Events } from "@openchart/server/events";
import { Notification } from "@openchart/server/notification";
import { Effect, Exit, Layer, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";

import { layer } from "./background";
import { Monitoring } from "./monitoring";

const NOW = 1_000_000;
const failed: Monitoring.Health = {
  state: "failed",
  reason: { code: "tea.upstream", message: "Binance stream disconnected." },
};

function run<A>(
  program: (
    notices: Notification.Input[],
  ) => Effect.Effect<
    A,
    never,
    Monitoring.Service | Events.Service | Scope.Scope
  >,
) {
  const notices: Notification.Input[] = [];
  const notification = Layer.succeed(Notification.Service, {
    notify: (input) => Effect.sync(() => void notices.push(input)),
  });
  return Effect.runPromise(
    TestClock.setTime(NOW).pipe(
      Effect.andThen(program(notices)),
      Effect.scoped,
      Effect.provide(
        layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(Monitoring.layer, Events.layer, notification),
          ),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
}

const check = (key: string, label: string, name = "Alert evaluation") =>
  Effect.flatMap(Monitoring.Service, (monitoring) =>
    Monitoring.check(name).pipe(
      Effect.provideService(
        Monitoring.Reporter,
        monitoring.reporter(key, label),
      ),
    ),
  );

test("an unhealthy Status notifies once at 60 s, then reports recovery with the gap", () =>
  run((notices) =>
    Effect.gen(function* () {
      const evaluation = yield* check("alert/a1", "BTC > 70k");
      yield* evaluation.report(failed);
      yield* TestClock.adjust("59 seconds");
      expect(notices).toEqual([]);
      yield* TestClock.adjust("1 second");
      expect(notices).toEqual([
        {
          title: "BTC > 70k",
          body: "Not monitoring: Binance stream disconnected.",
        },
      ]);
      yield* TestClock.adjust("2 minutes");
      expect(notices).toHaveLength(1);
      yield* evaluation.report({ state: "healthy" });
      // Recovery is announced only once it holds for 60 s.
      yield* TestClock.adjust("59 seconds");
      expect(notices).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      expect(notices).toHaveLength(2);
      expect(notices[1]!.title).toBe("BTC > 70k");
      expect(notices[1]!.body).toMatch(
        /^Monitoring resumed\. Conditions between .+ and .+ may have been missed\.$/,
      );
    }),
  ));

test("a brief interruption that recovers within 60 s sends nothing", () =>
  run((notices) =>
    Effect.gen(function* () {
      const evaluation = yield* check("alert/a1", "BTC > 70k");
      yield* evaluation.report({ state: "healthy" });
      yield* evaluation.report(failed);
      yield* TestClock.adjust("3 seconds");
      yield* evaluation.report({ state: "healthy" });
      yield* TestClock.adjust("5 minutes");
      expect(notices).toEqual([]);
    }),
  ));

test("Statuses crossing 60 s together share one notification; vanished ones are forgotten", () =>
  run((notices) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const first = yield* check("alert/a1", "BTC > 70k").pipe(
        Scope.provide(scope),
      );
      const second = yield* check("alert/a2", "ETH > 4k");
      yield* first.report(failed);
      yield* second.report(failed);
      yield* TestClock.adjust("60 seconds");
      expect(notices).toEqual([
        {
          title: "2 alerts need attention",
          body: "BTC > 70k: Not monitoring: Binance stream disconnected. (and 1 more)",
        },
      ]);
      // Pausing a rule removes its Status; that is not a recovery.
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("5 seconds");
      expect(notices).toHaveLength(1);
    }),
  ));

test("transitions publish monitoring.changed; routine renewals do not", () =>
  run(() =>
    Effect.gen(function* () {
      const types: string[] = [];
      yield* (yield* Events.Service.use((events) =>
        events.allBounded(64),
      )).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => void types.push(event.type)),
        ),
        Effect.forkScoped,
      );
      const source = yield* check(
        "alert/a1",
        "BTC > 70k",
        "Binance BTCUSDT 1m",
      );
      yield* TestClock.adjust("1 second");
      expect(types).toEqual(["monitoring.changed"]);
      for (let second = 0; second < 5; second++) {
        yield* source.report({ state: "healthy" }, { validFor: "15 seconds" });
        yield* TestClock.adjust("1 second");
      }
      expect(types).toEqual(["monitoring.changed", "monitoring.changed"]);
      // No renewal: the report lapses to unknown, which is a transition.
      yield* TestClock.adjust("20 seconds");
      expect(types).toHaveLength(3);
      // A new reason under the same code is a change the app must show.
      yield* source.report({
        state: "failed",
        reason: { code: "tea.upstream", message: "Stream ended." },
      });
      yield* TestClock.adjust("1 second");
      yield* source.report({
        state: "failed",
        reason: { code: "tea.upstream", message: "No source available." },
      });
      yield* TestClock.adjust("1 second");
      expect(types).toHaveLength(5);
    }),
  ));

test("a rule that fails on every retry notifies, even though each warmup looks healthy", () =>
  run((notices) =>
    Effect.gen(function* () {
      const evaluation = yield* check("alert/a1", "BTC > 70k");
      for (let attempt = 0; attempt < 4; attempt++) {
        yield* evaluation.report({ state: "healthy" });
        yield* TestClock.adjust("2 seconds");
        yield* evaluation.report(failed);
        yield* TestClock.adjust("30 seconds");
      }
      expect(notices).toHaveLength(1);
      expect(notices[0]!.body).toBe(
        "Not monitoring: Binance stream disconnected.",
      );
    }),
  ));

test("degraded alone stays in the app and never notifies", () =>
  run((notices) =>
    Effect.gen(function* () {
      const source = yield* check("alert/a1", "AAPL", "Yahoo AAPL 1m");
      yield* source.report({
        state: "degraded",
        reason: { code: "stale", message: "Data may be late." },
      });
      yield* TestClock.adjust("10 minutes");
      expect(notices).toEqual([]);
    }),
  ));
