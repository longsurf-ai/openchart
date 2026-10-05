// Purpose: Owns the backend-only, process-local live event channel between server services.

/**
 * Backend-only live event channel; no client transport ever reads it.
 * @packageDocumentation
 */
export * as Bus from "./bus";

import { Events } from "@openchart/server/events";
import { Context, Layer } from "effect";

/**
 * The capabilities of {@link Events.Interface}, on a separate instance.
 *
 * Publishers persist first, then publish ids only; consumers re-read the
 * Resource. Delivery is live-only: nothing is stored or replayed.
 */
export type Interface = Events.Interface;

/**
 * The backend event capability supplied by {@link layer}.
 *
 * @example
 * ```ts
 * const bus = yield* Bus.Service;
 * yield* bus.publish(AlertFired, {ruleId, eventId});
 * ```
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Bus",
) {}

/**
 * Acquires the shared Bus observer; see {@link Events.Interface.allBounded}.
 *
 * @param capacity - Maximum number of waiting payloads before explicit failure.
 * @returns An Effect that creates the bounded stream in the current scope.
 * @throws SubscriberOverflowError through the returned stream if its consumer
 * cannot keep up; the subscriber decides whether to resubscribe.
 *
 * @example
 * ```ts
 * const stream = yield* Bus.allBounded(256);
 * ```
 */
export function allBounded(capacity: number) {
  return Service.use((bus) => bus.allBounded(capacity));
}

/**
 * Process-local live Bus Layer.
 *
 * Builds a second instance of the one pub/sub implementation owned by Events,
 * shut down with the application scope. Events published here never reach an
 * Events subscriber, and the reverse.
 *
 * @example
 * ```ts
 * const services = Layer.merge(Bus.layer, Events.layer);
 * ```
 */
export const layer = Layer.effect(Service, Events.make);
