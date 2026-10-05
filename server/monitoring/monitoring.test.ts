// Purpose: Prove that green must keep being re-earned: start unknown, lapse, die with Scope, worst-of.

import { Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";

import { Monitoring } from "./monitoring";

const NOW = 1_000_000;
const failed = (code: string): Monitoring.Health => ({
  state: "failed",
  reason: { code, message: `${code} message` },
});

function run<A>(
  program: Effect.Effect<A, never, Monitoring.Service | Scope.Scope>,
) {
  return Effect.runPromise(
    TestClock.setTime(NOW).pipe(
      Effect.andThen(program),
      Effect.scoped,
      Effect.provide(Monitoring.layer),
      Effect.provide(TestClock.layer()),
    ),
  );
}

const statusOf = (key: string) =>
  Effect.map(
    Monitoring.Service.use((monitoring) => monitoring.status),
    (all) => all.find((status) => status.key === key),
  );

const bound = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Monitoring.Service, (monitoring) =>
    effect.pipe(
      Effect.provideService(
        Monitoring.Reporter,
        monitoring.reporter("alert/a1", "BTC > 70k"),
      ),
    ),
  );

test("a check starts unknown, turns healthy, and lapses to unknown at exactly validFor", () =>
  run(
    Effect.gen(function* () {
      const check = yield* bound(Monitoring.check("Binance BTCUSDT 1m"));
      expect(yield* statusOf("alert/a1")).toMatchObject({
        label: "BTC > 70k",
        health: { state: "unknown", reason: { code: "starting" } },
        since: NOW,
      });
      yield* TestClock.adjust("1 second");
      yield* check.report({ state: "healthy" }, { validFor: "45 seconds" });
      expect(yield* statusOf("alert/a1")).toMatchObject({
        health: { state: "healthy" },
        since: NOW + 1_000,
        checks: [{ lastOkAt: NOW + 1_000 }],
      });
      yield* TestClock.adjust("44999 millis");
      expect((yield* statusOf("alert/a1"))!.health.state).toBe("healthy");
      yield* TestClock.adjust("1 millis");
      expect(yield* statusOf("alert/a1")).toMatchObject({
        health: { state: "unknown", reason: { code: "expired" } },
        // A 45 s recovery is under the hold, so the startup interruption continues.
        since: NOW,
        checks: [{ since: NOW + 46_000, lastOkAt: NOW + 1_000 }],
      });
    }),
  ));

test("closing a check's Scope removes it and ignores its later reports", () =>
  run(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const check = yield* bound(Monitoring.check("old attempt")).pipe(
        Scope.provide(scope),
      );
      yield* Scope.close(scope, Exit.void);
      yield* check.report({ state: "healthy" });
      expect(yield* statusOf("alert/a1")).toBeUndefined();
    }),
  ));

test("a Status takes its worst check, and a check keeps one start across failed → unknown → failed", () =>
  run(
    Effect.gen(function* () {
      const evaluation = yield* bound(Monitoring.check("Alert evaluation"));
      const source = yield* bound(Monitoring.check("Yahoo AAPL 1m"));
      yield* evaluation.report({ state: "healthy" });
      yield* source.report({
        state: "degraded",
        reason: { code: "stale", message: "late" },
      });
      expect((yield* statusOf("alert/a1"))!.health.state).toBe("degraded");
      yield* source.report({ state: "healthy" });
      yield* TestClock.adjust("10 seconds");
      yield* evaluation.report(failed("tea.upstream"));
      yield* TestClock.adjust("5 seconds");
      yield* evaluation.report({
        state: "unknown",
        reason: { code: "starting", message: "Starting" },
      });
      yield* TestClock.adjust("5 seconds");
      yield* evaluation.report(failed("tea.upstream"));
      expect(yield* statusOf("alert/a1")).toMatchObject({
        health: { state: "failed", reason: { code: "tea.upstream" } },
        // The degraded start at NOW; the 10 s recovery was under the hold.
        since: NOW,
        checks: [{ label: "Alert evaluation", since: NOW + 10_000 }, {}],
      });
    }),
  ));

test("work with no bound Status registers nothing", () =>
  run(
    Effect.gen(function* () {
      const check = yield* Monitoring.check("chart session");
      yield* check.report(failed("disconnected"));
      expect(
        yield* Monitoring.Service.use((monitoring) => monitoring.status),
      ).toEqual([]);
    }),
  ));

test("an interruption survives checks handing over and brief recoveries, and ends after 60 s of health", () =>
  run(
    Effect.gen(function* () {
      const evaluation = yield* bound(Monitoring.check("Alert evaluation"));
      const cycle = Effect.gen(function* () {
        // One retry: a source degrades, its session ends, evaluation fails, warmup recovers.
        const scope = yield* Scope.make();
        const source = yield* bound(Monitoring.check("Yahoo AAPL 1m")).pipe(
          Scope.provide(scope),
        );
        yield* evaluation.report({ state: "healthy" });
        yield* source.report({
          state: "degraded",
          reason: { code: "stale", message: "late" },
        });
        for (let second = 0; second < 40; second++) {
          yield* statusOf("alert/a1");
          yield* TestClock.adjust("1 second");
        }
        yield* Scope.close(scope, Exit.void);
        yield* evaluation.report(failed("tea.upstream"));
        for (let second = 0; second < 30; second++) {
          yield* statusOf("alert/a1");
          yield* TestClock.adjust("1 second");
        }
      });
      yield* cycle;
      yield* cycle;
      expect((yield* statusOf("alert/a1"))!.since).toBe(NOW);
      yield* evaluation.report({ state: "healthy" });
      for (let second = 0; second < 59; second++) {
        yield* statusOf("alert/a1");
        yield* TestClock.adjust("1 second");
      }
      expect((yield* statusOf("alert/a1"))!.health.state).toBe("healthy");
      yield* evaluation.report(failed("tea.upstream"));
      expect((yield* statusOf("alert/a1"))!.since).toBe(NOW);
      yield* evaluation.report({ state: "healthy" });
      const recovered = (yield* statusOf("alert/a1"))!.since;
      yield* TestClock.adjust("60 seconds");
      yield* statusOf("alert/a1");
      yield* evaluation.report(failed("tea.upstream"));
      // After a full hold of health, a new failure starts a new interruption.
      expect((yield* statusOf("alert/a1"))!.since).toBe(recovered + 60_000);
    }),
  ));
