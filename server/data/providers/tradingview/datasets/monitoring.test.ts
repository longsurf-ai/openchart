// Purpose: Preserve TradingView's source-reported delay independently of heartbeat liveness.

import { Deferred, Effect, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import { Monitoring } from "@openchart/server/monitoring";
import type { Client, LiveActivity } from "../client";
import { streamBars } from "./bars";

test("source delay stays degraded on heartbeats and only an explicit live status clears it", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const monitoring = yield* Monitoring.Service;
      const activity = yield* Queue.make<LiveActivity>();
      const client: Client = {
        search: () => Effect.die("unused"),
        history: () => Effect.die("unused"),
        access: () => Effect.succeed({ status: "granted" }),
        reset: () => Effect.void,
        live: () => Effect.succeed(Stream.fromQueue(activity)),
      };
      const updates = yield* streamBars(
        client,
        {
          symbol: "SP:SPX",
          resolution: "1m",
          session: "regular",
          adjustment: "raw",
        },
        yield* Deferred.make<void>(),
      ).pipe(
        Effect.provideService(
          Monitoring.Reporter,
          monitoring.reporter("alert/test", "SPX alert"),
        ),
      );
      const rows: unknown[] = [];
      yield* updates.pipe(
        Stream.tap((frame) => Effect.sync(() => rows.push(...frame))),
        Stream.runDrain,
        Effect.forkScoped,
      );
      const health = monitoring.status.pipe(
        Effect.map((status) => status[0]!.checks[0]!.health),
      );
      expect(yield* health).toMatchObject({ state: "unknown" });

      yield* Queue.offer(activity, {
        type: "status",
        status: { mode: "delayed", delaySeconds: 600 },
      });
      yield* Effect.yieldNow;
      const delayed = {
        state: "degraded",
        reason: {
          code: "delayed",
          message: "TradingView reports a 600-second delay for this series.",
        },
      };
      expect(yield* health).toEqual(delayed);
      yield* TestClock.adjust("20 seconds");
      yield* Queue.offer(activity, { type: "heartbeat" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("20 seconds");
      expect(yield* health).toEqual(delayed);
      expect(rows).toEqual([]);

      const bar = {
        time: 1_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: null,
        receivedSequence: 1,
      };
      yield* Queue.offer(activity, { type: "bars", bars: [bar] });
      yield* Effect.yieldNow;
      expect(yield* health).toEqual(delayed);
      expect(rows).toEqual([bar]);

      yield* Queue.offer(activity, {
        type: "status",
        status: { mode: "live" },
      });
      yield* Effect.yieldNow;
      expect(yield* health).toEqual({ state: "healthy" });
      yield* TestClock.adjust("30 seconds");
      expect(yield* health).toMatchObject({
        state: "unknown",
        reason: { code: "expired" },
      });

      yield* Queue.offer(activity, {
        type: "status",
        status: { mode: "unknown" },
      });
      yield* Queue.offer(activity, { type: "heartbeat" });
      yield* Effect.yieldNow;
      expect(yield* health).toMatchObject({
        state: "unknown",
        reason: { code: "data-mode" },
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(Monitoring.layer),
      Effect.provide(TestClock.layer()),
    ),
  );
});
