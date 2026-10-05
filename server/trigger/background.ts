// Purpose: Forks the Trigger run and owns its application-scoped shutdown.

import { Cause, Effect, Layer } from "effect";

import { Trigger } from "./trigger";

/**
 * Starts Trigger dispatch once when this Layer is built.
 *
 * The fork belongs to this Layer's scope, survives individual requests, and
 * finishes interruption cleanup before its service dependencies are released.
 * Application runtime composes this Layer alongside other service Layers.
 * Unexpected Trigger defects are logged; normal shutdown is not an error.
 *
 * @example
 * ```ts
 * const runtime = ManagedRuntime.make(
 *   layer.pipe(Layer.provideMerge(applicationServices)),
 * );
 * await runtime.context();
 * await runtime.dispose();
 * ```
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const trigger = yield* Trigger.Service;
    yield* trigger.run().pipe(
      Effect.tapCauseIf(Cause.hasDies, (cause) =>
        Effect.logError("Trigger background run failed", cause),
      ),
      Effect.forkScoped,
    );
  }),
);
