// Purpose: Locks Bus delivery, isolation from Events, and bounded overflow behavior.

import { EventDefinition, Events } from "@openchart/server/events";
import { Effect, Exit, Layer, Schema, Stream } from "effect";
import { describe, expect, test } from "vitest";

import { Bus } from "./bus";

const Fired = EventDefinition.define({
  type: "test.fired",
  schema: { id: Schema.String },
});

function run<A, E>(effect: Effect.Effect<A, E, Bus.Service | Events.Service>) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(Layer.merge(Bus.layer, Events.layer))),
  );
}

describe("Bus", () => {
  test("delivers a published definition to a bounded subscriber", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* Bus.Service;
      const stream = yield* Bus.allBounded(1);
      const event = yield* bus.publish(Fired, { id: "event-1" });
      return {
        event,
        received: Array.from(
          yield* stream.pipe(Stream.take(1), Stream.runCollect),
        ),
      };
    });

    const result = await run(Effect.scoped(program));
    expect(result.received).toEqual([result.event]);
    expect(result.event.type).toBe("test.fired");
    expect(result.event.data).toEqual({ id: "event-1" });
  });

  test("shares no subscribers with Events", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* Bus.Service;
      const events = yield* Events.Service;
      const fromBus = yield* bus.allBounded(4);
      const fromEvents = yield* events.allBounded(4);

      // Interleaved so a leak in either direction changes what arrives first.
      const busFirst = yield* bus.publish(Fired, { id: "bus-1" });
      const eventsOnly = yield* events.publish(Fired, { id: "events-1" });
      const busSecond = yield* bus.publish(Fired, { id: "bus-2" });

      return {
        expectedBus: [busFirst, busSecond],
        expectedEvents: [eventsOnly],
        bus: Array.from(yield* fromBus.pipe(Stream.take(2), Stream.runCollect)),
        events: Array.from(
          yield* fromEvents.pipe(Stream.take(1), Stream.runCollect),
        ),
      };
    });

    const result = await run(Effect.scoped(program));
    expect(result.bus).toEqual(result.expectedBus);
    expect(result.events).toEqual(result.expectedEvents);
  });

  test("fails a bounded subscriber instead of dropping an event", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* Bus.Service;
      const stream = yield* bus.allBounded(1);
      yield* bus.publish(Fired, { id: "event-1" });
      yield* bus.publish(Fired, { id: "event-2" });
      yield* Effect.yieldNow;
      return yield* Stream.runCollect(stream).pipe(Effect.exit);
    });

    const exit = await run(Effect.scoped(program));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("Events.SubscriberOverflow");
    }
  });
});
