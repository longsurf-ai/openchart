// Purpose: Publish Monitoring transitions and notify the user about lasting interruptions.

import { Events } from "@openchart/server/events";
import { Notification } from "@openchart/server/notification";
import { Clock, Effect, Layer, Schedule } from "effect";

import { MonitoringChanged } from "./events";
import { Monitoring } from "./monitoring";

/** How long an interruption lasts before the user is notified. */
export const notifyAfter = 60_000;

const time = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

function describe(health: Monitoring.Health): string {
  if (health.state === "healthy") return "Monitoring";
  const prefix =
    health.state === "degraded"
      ? "Data may be delayed"
      : health.state === "failed"
        ? "Not monitoring"
        : "Can't confirm monitoring";
  return `${prefix}: ${health.reason.message}`;
}

function summary(
  statuses: readonly Monitoring.Status[],
  many: string,
  body: (status: Monitoring.Status) => string,
): Notification.Input {
  const [first] = statuses;
  return statuses.length === 1
    ? { title: first!.label, body: body(first!) }
    : {
        title: many.replace("{count}", String(statuses.length)),
        body: `${first!.label}: ${body(first!)} (and ${statuses.length - 1} more)`,
      };
}

/**
 * Runs one application-lifetime loop, once per second:
 * - publishes {@link MonitoringChanged} and logs when any Status changes state
 *   or reason (routine renewals publish nothing);
 * - sends one notification once a Status's interruption has lasted
 *   {@link notifyAfter} and it is not monitoring right now (failed or unknown),
 *   independent of any rule action, coalescing Statuses that cross together.
 *   Degraded (data may be late) stays in-app only;
 * - after such a notification, reports recovery with the possibly missed interval
 *   once the interruption is over (healthy for `Monitoring.interruptionHold`).
 *
 * Statuses that disappear (paused or deleted rules) are forgotten silently.
 * Notification is best-effort; the in-app status stays authoritative.
 *
 * @example
 * ```ts
 * const runtime = ManagedRuntime.make(
 *   layer.pipe(Layer.provideMerge(applicationServices)),
 * );
 * ```
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const monitoring = yield* Monitoring.Service;
    const events = yield* Events.Service;
    const notification = yield* Notification.Service;
    let previous = new Map<string, string>();
    // Key -> start of the unhealthy streak the user was told about.
    const notified = new Map<string, number>();
    const tick = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const statuses = yield* monitoring.status;
      const signatures = new Map(
        statuses.map((status) => [
          status.key,
          status.health.state === "healthy"
            ? "healthy"
            : `${status.health.state}:${status.health.reason.code}:${status.health.reason.message}`,
        ]),
      );
      const changed = statuses.filter(
        (status) => previous.get(status.key) !== signatures.get(status.key),
      );
      if (changed.length > 0 || previous.size !== signatures.size)
        yield* events.publish(MonitoringChanged, {});
      for (const status of changed)
        yield* (
          status.health.state === "healthy" ? Effect.logInfo : Effect.logWarning
        )("Monitoring status changed", {
          key: status.key,
          health: signatures.get(status.key),
        });
      previous = signatures;

      for (const key of notified.keys())
        if (!signatures.has(key)) notified.delete(key);
      const interrupted = statuses.filter(
        (status) =>
          (status.health.state === "failed" ||
            status.health.state === "unknown") &&
          now - status.since >= notifyAfter &&
          !notified.has(status.key),
      );
      // A healthy Status's `since` is its recovery; the interruption ends after the hold.
      const resumed = statuses.filter(
        (status) =>
          status.health.state === "healthy" &&
          now - status.since >= Monitoring.interruptionHold &&
          notified.has(status.key),
      );
      if (interrupted.length > 0) {
        for (const status of interrupted)
          notified.set(status.key, status.since);
        yield* notification.notify(
          summary(interrupted, "{count} alerts need attention", (status) =>
            describe(status.health),
          ),
        );
      }
      if (resumed.length > 0) {
        const gaps = new Map(
          resumed.map((status) => [status.key, notified.get(status.key)!]),
        );
        for (const status of resumed) notified.delete(status.key);
        yield* notification.notify(
          summary(
            resumed,
            "{count} alerts resumed monitoring",
            (status) =>
              `Monitoring resumed. Conditions between ${time.format(gaps.get(status.key))} and ${time.format(status.since)} may have been missed.`,
          ),
        );
      }
    });
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced("1 second")),
      Effect.forkScoped,
    );
  }),
);
