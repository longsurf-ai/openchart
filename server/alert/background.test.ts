// Purpose: Verifies the Alert fiber outlives calls and finishes cleanup before dependencies close.

import { Bus } from "@openchart/server/bus";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { Monitoring } from "@openchart/server/monitoring";
import * as Tea from "@openchart/server/tea/tea";
import { Deferred, Effect, Layer, ManagedRuntime } from "effect";
import { expect, test } from "vitest";

import { Alert } from "./alert";
import { layer } from "./background";

test("starts once and awaits run cleanup before releasing its service", async () => {
  const started = Deferred.makeUnsafe<void>();
  const stopping = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const order: string[] = [];
  let runs = 0;
  const alert = Layer.effect(
    Alert.Service,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => order.push("service closed")),
      );
      return Alert.Service.of({
        run: () =>
          Effect.gen(function* () {
            runs += 1;
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                order.push("run stopping");
                yield* Deferred.succeed(stopping, undefined);
                yield* Deferred.await(release);
                order.push("run closed");
              }),
            ),
          ),
      });
    }),
  );
  const runtime = ManagedRuntime.make(
    layer.pipe(
      Layer.provideMerge(alert),
      // The fake run uses none of these; unexpected calls fail explicitly.
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Tea.Service, {}),
          Monitoring.layer,
          Layer.mock(Bus.Service, {}),
          Layer.mock(Events.Service, {}),
          Layer.succeed(Database.Service, {
            get db(): never {
              throw new Error("The fake run must not access the database");
            },
          }),
        ),
      ),
    ),
  );
  try {
    await runtime.context();
    await Effect.runPromise(Deferred.await(started));
    await runtime.context();
    await runtime.runPromise(Effect.void);
    expect(runs).toBe(1);
    expect(order).toEqual([]);

    const closing = runtime.dispose();
    await Effect.runPromise(Deferred.await(stopping));
    expect(order).toEqual(["run stopping"]);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await closing;
    expect(order).toEqual(["run stopping", "run closed", "service closed"]);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await runtime.dispose();
  }
});
