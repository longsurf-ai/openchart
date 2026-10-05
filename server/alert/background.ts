// Purpose: Forks Alert observation and owns its application-scoped shutdown.

import { Monitoring } from "@openchart/server/monitoring";
import { Cause, Effect, Layer } from "effect";

import { Alert } from "./alert";

/**
 * Starts Alert observation once when this Layer is built.
 *
 * The fork belongs to this Layer's scope, survives individual requests, and
 * finishes interruption cleanup (every rule fiber and its Tea node) before its
 * service dependencies are released. Application runtime composes this Layer
 * alongside other service Layers. An "Alert runner" check under the Monitoring
 * Status `service/alerts` stays healthy while the run lives; an unexpected
 * defect is logged and fails that check, so every enabled alert reads as not
 * monitored. Normal shutdown is not an error.
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
    const alert = yield* Alert.Service;
    const monitoring = yield* Monitoring.Service;
    const reporter = monitoring.reporter("service/alerts", "Alerts");
    const runner = yield* Monitoring.check("Alert runner").pipe(
      Effect.provideService(Monitoring.Reporter, reporter),
    );
    yield* runner.report({ state: "healthy" });
    yield* alert.run().pipe(
      // Rule-sync checks land here; each rule binds its own Status.
      Effect.provideService(Monitoring.Reporter, reporter),
      Effect.tapCauseIf(Cause.hasDies, (cause) =>
        Effect.logError("Alert background run failed", cause).pipe(
          Effect.andThen(
            runner.report({
              state: "failed",
              reason: {
                code: "alert_runner_stopped",
                message:
                  "Alert monitoring stopped unexpectedly. Restart OpenChart.",
              },
            }),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
