// Purpose: Own enabled Alertable lifetimes and record each live occurrence before publishing its Bus id.

/**
 * Alert observation; the background Layer owns one application-lifetime run.
 * @packageDocumentation
 */
export * as Alert from "./alert";

import { isDeepStrictEqual } from "node:util";
import type { BarsSeries } from "@openchart/feed";
import { Bus } from "@openchart/server/bus";
import { Events } from "@openchart/server/events";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import {
  AlertRuleId,
  alertRuleResource,
  decodeAlertRuleRunConfig,
  type AlertRule,
} from "@openchart/server/resources/alert-rule";
import { recordAlertFire } from "@openchart/server/resources/macros/record-alert-fire";
import {
  followIndicator,
  ruleRequest,
} from "@openchart/server/resources/macros/follow-indicator";
import { chartResource } from "@openchart/server/resources/chart";
import { drawingResource } from "@openchart/server/resources/drawing";
import { indicatorResource } from "@openchart/server/resources/indicator";
import { Monitoring } from "@openchart/server/monitoring";
import * as Tea from "@openchart/tea";
import {
  Clock,
  Context,
  Effect,
  FiberMap,
  Layer,
  Random,
  Schedule,
  Schema,
  Stream,
} from "effect";

import { AlertFired } from "./events";
import { TeaAlerts } from "./tea-alerts";
import { drawingTeaDefinition } from "./drawing-alerts";

/** Application-wide observation of enabled Alert Rules. */
export interface Interface {
  /**
   * Observes every enabled rule until interrupted: one fiber per rule, each
   * owning one compiled Tea node and one live observation. Application
   * composition owns one invocation and interrupts it on shutdown, which stops
   * every rule fiber and disposes its node before returning.
   *
   * Every live update row whose alertcondition() list is non-empty is one
   * `alert_event` per Alert in it, provisional ticks included: there is no
   * per-bar dedupe and no throttle. Snapshot rows never fire, so a restart
   * never replays. Each event commits before its `alert.fired` Bus message.
   *
   * Each rule reports an "Alert evaluation" check under the Monitoring Status
   * `alert/<ruleId>`, which it binds for its observation so sources report
   * there too. Every completed evaluation reports healthy, including one where
   * no condition holds. Any expected failure (compile, source, write, or the
   * live stream ending while enabled) reports failed and retries that rule with
   * jittered backoff from 1 to 30 seconds, restarting at 1 second after a run
   * that evaluated for a minute; a failed write loses that fire and restarts the
   * observation. A failed subscription or rule read keeps running rules,
   * reports an "Alert rules" check under the Status bound around run, and
   * resubscribes and reconciles. Defects and interruption propagate.
   * @example
   * const alert = yield* Alert.Service;
   * yield* alert.run();
   */
  readonly run: typeof run;
}

/**
 * Alert capability supplied by application composition. Providing the service
 * starts no work; its background Layer forks run.
 * @example
 * const alert = yield* Alert.Service;
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Alert",
) {}

/** Public reason for a failed attempt; Tea errors already carry safe messages. */
function reasonFor(error: unknown): Monitoring.Reason {
  return error instanceof Tea.Error
    ? { code: `tea.${error.code}`, message: error.message }
    : {
        code: "storage",
        message: "OpenChart could not read or save this alert.",
      };
}

/** An attempt that evaluated this long before failing restarts backoff at 1 s. */
const stableRun = 60_000;

/** Each following rule's market, as its latest attempt resolved it. */
type ObservedMarkets = Map<AlertRuleId, BarsSeries>;

/**
 * One observation attempt. Returning means the rule stopped deliberately. Its
 * Scope owns the compilations the attempt runs, a followed Indicator included.
 */
const observeOnce = Effect.fn("Alert.observeOnce")(function* (
  rule: AlertRule,
  evaluated: Effect.Effect<void>,
  observed: ObservedMarkets,
) {
  const bus = yield* Bus.Service;
  const alertable = rule.alertable;
  const run =
    alertable.kind === "tea"
      ? yield* decodeAlertRuleRunConfig(alertable.config).pipe(
          Effect.flatMap(ruleRequest),
          Effect.catchTag("Resource.NotFound", () => Effect.succeed(null)),
        )
      : undefined;
  const follow = run?.follow;
  const drawing =
    alertable.kind === "drawing"
      ? yield* Transactor.run(
          drawingResource.transitions.get(alertable.drawingId),
        ).pipe(Effect.catchTag("Resource.NotFound", () => Effect.succeed(null)))
      : undefined;
  if (drawing === null || run === null) {
    // Keep the authored rule and its history; a deleted source cannot observe.
    yield* Transactor.run(
      alertRuleResource.transitions.patch({
        id: rule.id,
        expectedRevision: rule.revision,
        operations: [{ op: "replace", path: "/enabled", value: false }],
      }),
    );
    return;
  }
  const definition =
    alertable.kind === "drawing"
      ? yield* Effect.try({
          try: () => drawingTeaDefinition(drawing!, alertable),
          catch: (cause) =>
            cause instanceof Tea.Error
              ? cause
              : new Tea.Error(
                  {
                    code: "invalid_request",
                    message: "Invalid drawing alert geometry",
                  },
                  { cause },
                ),
        })
      : { source: alertable.source, config: run!.config, nodes: run!.nodes };
  if (follow) observed.set(rule.id, follow.market);
  yield* new TeaAlerts(definition).observe().pipe(
    Stream.tap(() => evaluated),
    Stream.flattenIterable,
    Stream.runForEach((occurrence) =>
      Transactor.run(
        recordAlertFire({
          ruleId: rule.id,
          expectedRevision: rule.revision,
          ...(drawing
            ? {
                expectedDrawing: {
                  id: drawing.id,
                  revision: drawing.revision,
                },
              }
            : {}),
          ...(follow
            ? {
                expectedIndicator: {
                  id: follow.indicator.id,
                  revision: follow.indicator.revision,
                  market: follow.market,
                },
              }
            : {}),
          condition: occurrence.condition,
          time: occurrence.time,
          detail: {
            title: occurrence.title,
            message: occurrence.message,
            data: drawing
              ? {
                  ...occurrence.data,
                  drawingId: drawing.id,
                  drawingRevision: drawing.revision,
                  drawingType: drawing.data.type,
                }
              : follow
                ? {
                    ...occurrence.data,
                    indicatorId: follow.indicator.id,
                    indicatorRevision: follow.indicator.revision,
                  }
                : occurrence.data,
          },
        }),
      ).pipe(
        // Stale, disabled, or deleted rules produce no event.
        Effect.flatMap((event) =>
          event
            ? bus.publish(AlertFired, { ruleId: rule.id, eventId: event.id })
            : Effect.void,
        ),
        // Once disables its rule and interrupts this fiber. Its committed
        // event must still reach the Bus.
        Effect.uninterruptible,
      ),
    ),
  );
  // An enabled rule has no normal end: a retired or finished source is a failure.
  return yield* Effect.fail(
    new Tea.Error({
      code: "upstream",
      message: "The live data stream ended.",
    }),
  );
}, Effect.scoped);

const observeRule = Effect.fn("Alert.observeRule")(
  function* (rule: AlertRule, observed: ObservedMarkets) {
    const evaluation = yield* Monitoring.check("Alert evaluation");
    let failures = 0;
    yield* Effect.gen(function* () {
      let evaluatedAt: number | undefined;
      const evaluated = Effect.gen(function* () {
        evaluatedAt ??= yield* Clock.currentTimeMillis;
        yield* evaluation.report({ state: "healthy" });
      });
      yield* observeOnce(rule, evaluated, observed).pipe(
        Effect.tapError(
          Effect.fnUntraced(function* (failure) {
            yield* evaluation.report({
              state: "failed",
              reason: reasonFor(failure),
            });
            yield* Effect.logError(
              "Alert rule observation failed; retrying",
              failure,
            );
            // Backoff restarts after a stable run; quick re-failures keep growing it,
            // so a rule that fails right after warmup never retries in a tight loop.
            const now = yield* Clock.currentTimeMillis;
            failures =
              evaluatedAt !== undefined && now - evaluatedAt >= stableRun
                ? 1
                : failures + 1;
            const jitter = 0.8 + 0.4 * (yield* Random.next);
            yield* Effect.sleep(
              Math.round(
                Math.min(1_000 * 2 ** (failures - 1), 30_000) * jitter,
              ),
            );
          }),
        ),
      );
    }).pipe(Effect.eventually);
  },
  (effect, rule) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ ruleId: rule.id })),
);

const run = Effect.fn("Alert.run")(function* () {
  const monitoring = yield* Monitoring.Service;
  // Reports under the Status bound around run (service/alerts in the app).
  const sync = yield* Monitoring.check("Alert rules");
  let synced = false;
  const fibers = yield* FiberMap.make<AlertRuleId, void, never>();
  const observed: ObservedMarkets = new Map();
  const start = (rule: AlertRule) =>
    FiberMap.run(
      fibers,
      rule.id,
      observeRule(rule, observed).pipe(
        Effect.provideService(
          Monitoring.Reporter,
          monitoring.reporter(`alert/${rule.id}`, rule.name),
        ),
      ),
    );
  const restart = (rule: AlertRule) =>
    Effect.gen(function* () {
      yield* FiberMap.remove(fibers, rule.id);
      observed.delete(rule.id);
      if (rule.enabled) yield* start(rule);
    });
  const watch = Effect.gen(function* () {
    // Subscribe before reading, so no rule change falls between the two.
    const changes = yield* Events.allBounded(256);
    // Read before clearing: a failed read leaves the running rules observing.
    const rules = yield* Transactor.run(
      alertRuleResource.transitions.listAll(),
    );
    // Reconcile by restarting everything: history never fires, so a restart
    // never replays.
    // ponytail: one recompile and Feed resubscription per rule, diff by
    // revision if rule counts make that slow.
    yield* FiberMap.clear(fibers);
    observed.clear();
    yield* Effect.forEach(
      rules.filter((rule) => rule.enabled),
      start,
      { discard: true },
    );
    synced = true;
    yield* sync.report({ state: "healthy" });
    yield* changes.pipe(
      Stream.filter(Schema.is(ResourceChanged)),
      Stream.filter(
        (event) =>
          event.data.resource === alertRuleResource.name ||
          event.data.resource === drawingResource.name ||
          event.data.resource === indicatorResource.name ||
          event.data.resource === chartResource.name,
      ),
      Stream.runForEach(
        Effect.fnUntraced(function* (event) {
          if (event.data.resource === drawingResource.name) {
            const rules = yield* Transactor.run(
              alertRuleResource.transitions.listAll(),
            );
            for (const rule of rules) {
              if (
                rule.alertable.kind !== "drawing" ||
                rule.alertable.drawingId !== event.data.id
              )
                continue;
              yield* restart(rule);
            }
            return;
          }
          if (
            event.data.resource === indicatorResource.name ||
            event.data.resource === chartResource.name
          ) {
            const rules = yield* Transactor.run(
              alertRuleResource.transitions.listAll(),
            );
            for (const rule of rules) {
              const config =
                rule.alertable.kind === "tea"
                  ? rule.alertable.config
                  : undefined;
              if (!config || !("indicatorId" in config)) continue;
              if (event.data.resource === indicatorResource.name) {
                if (config.indicatorId === event.data.id) yield* restart(rule);
                continue;
              }
              // A chart change retargets only rules whose cell market moved;
              // other chart edits, such as another Indicator, keep observing.
              const follow = yield* Transactor.run(
                followIndicator(config.indicatorId),
              );
              if (follow && follow.indicator.chartId !== event.data.id)
                continue;
              if (
                follow &&
                isDeepStrictEqual(follow.market, observed.get(rule.id))
              )
                continue;
              yield* restart(rule);
            }
            return;
          }
          const id = AlertRuleId.make(event.data.id);
          const rule = yield* Transactor.run(
            alertRuleResource.transitions.get(id),
          ).pipe(
            Effect.catchTag("Resource.NotFound", () =>
              Effect.succeed(undefined),
            ),
          );
          // Await the old fiber so its Tea node is disposed before a replacement compiles.
          yield* FiberMap.remove(fibers, id);
          observed.delete(id);
          if (rule?.enabled) yield* start(rule);
        }),
      ),
    );
  }).pipe(
    Effect.scoped,
    // Subscriber overflow and failed rule reads share one recovery: resubscribe
    // and reconcile. Rule fibers keep observing while this waits.
    Effect.tapError((error) =>
      sync
        .report(
          synced
            ? {
                state: "degraded",
                reason: {
                  code: "rules_stale",
                  message:
                    "Alert rule changes aren't applied yet; running alerts keep monitoring.",
                },
              }
            : {
                state: "failed",
                reason: {
                  code: "rules_unreadable",
                  message: "OpenChart can't read your alert rules; retrying.",
                },
              },
        )
        .pipe(
          Effect.andThen(
            Effect.logError("Alert rule watch failed; resubscribing", error),
          ),
        ),
    ),
    Effect.retry(Schedule.spaced("1 second")),
  );
  // A defect inside a rule fiber surfaces here instead of vanishing with it.
  yield* Effect.raceFirst(watch, FiberMap.join(fibers));
}, Effect.scoped);

/**
 * Registers Alert observation without acquiring dependencies or starting work.
 * run retains its inferred requirements; application composition supplies them
 * to the background Layer.
 * @example
 * const services = Layer.merge(Alert.layer, applicationServices);
 */
export const layer = Layer.succeed(Service, { run });
