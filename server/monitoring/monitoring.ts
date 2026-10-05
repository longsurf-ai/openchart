// Purpose: Hold the current health that owners report, grouped into one Status per monitored key.

/**
 * User-facing monitoring: owners report what they know as Checks; readers get
 * one Status per key whose health is its worst Check.
 * @packageDocumentation
 */
export * as Monitoring from "./monitoring";

import { Clock, Context, Duration, Effect, Layer, Schema, Scope } from "effect";

/** Why a check is not healthy; `message` is safe to show to the user. */
export const Reason = Schema.Struct({
  code: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
});
export type Reason = typeof Reason.Type;

/**
 * `unknown`: no current evidence yet, or it expired. `degraded`: working, but
 * data may be late. `failed`: known not working.
 */
export const Health = Schema.Union([
  Schema.Struct({ state: Schema.Literal("healthy") }),
  Schema.Struct({
    state: Schema.Literals(["unknown", "degraded", "failed"]),
    reason: Reason,
  }),
]);
export type Health = typeof Health.Type;

const Millis = Schema.Finite;

/** One owner's latest report. `since` is its last healthy/unhealthy crossing. */
export const Check = Schema.Struct({
  label: Schema.NonEmptyString,
  health: Health,
  since: Millis,
  lastOkAt: Schema.NullOr(Millis),
});
export type Check = typeof Check.Type;

/**
 * A flat group of checks; its health is the worst check and it reports nothing
 * itself. While unhealthy, `since` is when the current interruption began: a
 * recovery shorter than {@link interruptionHold} does not end it, however the
 * failing checks come and go. While healthy, `since` is when it last recovered.
 */
export const Status = Schema.Struct({
  key: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  health: Health,
  since: Millis,
  checks: Schema.Array(Check),
});
export type Status = typeof Status.Type;

/** Updates one registered check. Reports after its Scope closes are ignored. */
export interface CheckHandle {
  /**
   * Replaces this check's health. A healthy report also records `lastOkAt`.
   * With `validFor`, the report lapses to `unknown` unless renewed in time.
   * @example yield* check.report({state: "healthy"}, {validFor: "45 seconds"});
   */
  readonly report: (
    health: Health,
    options?: { readonly validFor: Duration.Input },
  ) => Effect.Effect<void>;
}

/** Registers checks under one Status key; composition binds it in context. */
export interface Reporter {
  /** @example const handle = yield* reporter.register("Binance BTCUSDT 1m"); */
  readonly register: (
    label: string,
  ) => Effect.Effect<CheckHandle, never, Scope.Scope>;
}

const ignored: CheckHandle = { report: () => Effect.void };

/**
 * The Status that checks registered inside an Effect belong to. The default
 * discards reports, so work nobody monitors (such as chart sessions) pays nothing.
 * @example effect.pipe(Effect.provideService(Monitoring.Reporter, monitoring.reporter("alert/a1", "BTC > 70k")));
 */
export const Reporter = Context.Reference<Reporter>(
  "@openchart/server/Monitoring/Reporter",
  { defaultValue: () => ({ register: () => Effect.succeed(ignored) }) },
);

/**
 * Registers a check under the Status bound in context. It starts `unknown` and
 * is removed when the current Scope closes. Reading a Reference adds no service
 * requirement, so Dataset handles stay requirement-free.
 * @example
 * const source = yield* Monitoring.check("Binance BTCUSDT 1m");
 * yield* source.report({state: "healthy"}, {validFor: "45 seconds"});
 */
export const check = Effect.fn("Monitoring.check")(function* (label: string) {
  const reporter = yield* Reporter;
  return yield* reporter.register(label);
});

/** Current health of every monitored key. */
export interface Interface {
  /**
   * A Reporter whose checks form the Status `key`, shown as `label`.
   * Binding it starts no work.
   * @example const reporter = monitoring.reporter(`alert/${rule.id}`, rule.name);
   */
  readonly reporter: (key: string, label: string) => Reporter;
  /**
   * Every Status with at least one registered check, computed at read time:
   * lapsed reports read as `unknown`, and a Status takes its worst check
   * (`failed > degraded > unknown > healthy`). An unhealthy Status reports when
   * its interruption began; the interruption only ends after
   * {@link interruptionHold} of continuous health, so flapping or checks
   * replacing each other never restart it. Reading records that progress, so
   * callers poll it regularly (the background loop reads every second). Never fails.
   * @example const statuses = yield* monitoring.status;
   */
  readonly status: Effect.Effect<ReadonlyArray<Status>>;
}

/**
 * Monitoring capability supplied by application composition.
 * @example const monitoring = yield* Monitoring.Service;
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Monitoring",
) {}

interface Entry {
  readonly key: string;
  readonly statusLabel: string;
  readonly label: string;
  health: Health;
  since: number;
  lastOkAt: number | null;
  expiresAt: number | null;
}

const starting: Health = {
  state: "unknown",
  reason: { code: "starting", message: "Starting" },
};
const expired: Health = {
  state: "unknown",
  reason: { code: "expired", message: "No recent update" },
};
const rank = { healthy: 0, unknown: 1, degraded: 2, failed: 3 } as const;

/** A Status must stay healthy this long before its interruption counts as over. */
export const interruptionHold = 60_000;

/** One key's current interruption; `recoveredAt` is set while it is briefly healthy. */
interface Interruption {
  start: number;
  recoveredAt: number | null;
}

/** Reported health after lapse, and when it last crossed healthy/unhealthy. */
function current(entry: Entry, now: number) {
  if (entry.expiresAt === null || now < entry.expiresAt)
    return { health: entry.health, since: entry.since };
  return {
    health: expired,
    since: entry.health.state === "healthy" ? entry.expiresAt : entry.since,
  };
}

/** Worst health of the current checks, and when that health last began. */
function statusOf(entries: readonly Entry[], now: number): Status {
  const checks = entries.map((entry) => ({
    label: entry.label,
    ...current(entry, now),
    lastOkAt: entry.lastOkAt,
  }));
  const worst = checks.reduce((a, b) =>
    rank[b.health.state] > rank[a.health.state] ||
    (rank[b.health.state] === rank[a.health.state] && b.since < a.since)
      ? b
      : a,
  );
  const unhealthy = checks.filter((item) => item.health.state !== "healthy");
  return {
    key: entries[0]!.key,
    label: entries.at(-1)!.statusLabel,
    health: worst.health,
    since:
      unhealthy.length > 0
        ? Math.min(...unhealthy.map((item) => item.since))
        : Math.max(...checks.map((item) => item.since)),
    checks,
  };
}

/**
 * Builds an in-memory Monitoring. Nothing persists: after a restart every check
 * is re-earned from `starting`.
 * @example const services = Layer.merge(Monitoring.layer, applicationServices);
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const entries = new Map<number, Entry>();
    let next = 0;
    const reporter = (key: string, statusLabel: string): Reporter => ({
      register: (label) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const id = next++;
            entries.set(id, {
              key,
              statusLabel,
              label,
              health: starting,
              since: clock.currentTimeMillisUnsafe(),
              lastOkAt: null,
              expiresAt: null,
            });
            return id;
          }),
          (id) => Effect.sync(() => entries.delete(id)),
        ).pipe(
          Effect.map((id): CheckHandle => ({
            report: (health, options) =>
              Effect.sync(() => {
                const entry = entries.get(id);
                if (!entry) return;
                const now = clock.currentTimeMillisUnsafe();
                const before = current(entry, now);
                const healthy = health.state === "healthy";
                entry.since =
                  (before.health.state === "healthy") === healthy
                    ? before.since
                    : now;
                entry.health = health;
                if (healthy) entry.lastOkAt = now;
                entry.expiresAt = options
                  ? now + Duration.toMillis(options.validFor)
                  : null;
              }),
          })),
        ),
    });
    const interruptions = new Map<string, Interruption>();
    const status = Effect.sync(() => {
      const now = clock.currentTimeMillisUnsafe();
      const groups = new Map<string, Entry[]>();
      for (const entry of entries.values()) {
        const group = groups.get(entry.key);
        if (group) group.push(entry);
        else groups.set(entry.key, [entry]);
      }
      for (const key of interruptions.keys())
        if (!groups.has(key)) interruptions.delete(key);
      return [...groups.values()].map((group) => {
        const status = statusOf(group, now);
        const interruption = interruptions.get(status.key);
        if (status.health.state !== "healthy") {
          // Checks hand over (a session ends, a retry warms up) without ending the interruption.
          if (!interruption)
            interruptions.set(status.key, {
              start: status.since,
              recoveredAt: null,
            });
          else {
            interruption.start = Math.min(interruption.start, status.since);
            interruption.recoveredAt = null;
          }
          return { ...status, since: interruptions.get(status.key)!.start };
        }
        if (interruption) {
          interruption.recoveredAt ??= status.since;
          if (now - interruption.recoveredAt >= interruptionHold)
            interruptions.delete(status.key);
        }
        return status;
      });
    });
    return Service.of({ reporter, status });
  }),
);
