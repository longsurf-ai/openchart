// Purpose: Prove a silent OpenChart socket fails the live session instead of ending it.
import { Deferred, Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import type { Client } from "@openchart/server/data/providers/openchart/contract";
import { streamBars } from "./bars";

const silent: Client = {
  changes: Stream.empty,
  getCapabilities: () => Effect.die("unused"),
  searchListings: () => Effect.die("unused"),
  readCalendar: () => Effect.die("unused"),
  readBarsPage: () => Effect.die("unused"),
  subscribeBars: () => Effect.succeed(Stream.never),
  reset: () => Effect.void,
};

it("fails after 45 seconds without heartbeats so the consumer reconnects", async () => {
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const updates = yield* streamBars(
        silent,
        { listing: 1, session: "regular", resolution: "1m", adjustment: "raw" },
        yield* Deferred.make<void>(),
      );
      const running = yield* updates.pipe(
        Stream.runDrain,
        Effect.result,
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("44 seconds");
      expect(running.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      return yield* Fiber.join(running);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
  expect(outcome).toMatchObject({
    _tag: "Failure",
    failure: { reason: { _tag: "Dataset.Unavailable" } },
  });
});
