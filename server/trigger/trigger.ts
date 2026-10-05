// Purpose: Executes enabled Triggers when their source event arrives on the backend Bus.

/**
 * Trigger dispatch; the background Layer owns one application-lifetime run.
 * @packageDocumentation
 */
export * as Trigger from "./trigger";

import { admitPromptTarget } from "@openchart/server/agent/session/admit-prompt-target";
import { AlertFired } from "@openchart/server/alert/events";
import { Bus } from "@openchart/server/bus";
import type { EventDefinition } from "@openchart/server/events";
import { Transactor, Transition } from "@openchart/server/lib/resource";
import { Notification } from "@openchart/server/notification";
import { postResource } from "@openchart/server/resources/post";
import {
  alertEventResource,
  type AlertEventId,
} from "@openchart/server/resources/alert-event";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import {
  triggerResource,
  type Trigger as TriggerDefinition,
} from "@openchart/server/resources/trigger";
import { Context, Effect, Layer, Schema, Stream } from "effect";

import {
  alertTokens,
  renderPrompt,
  renderTemplate,
  type Tokens,
} from "./serialize";

/** Application-wide execution of user-authored Triggers. */
export interface Interface {
  /**
   * Removes Triggers whose Alert Rule no longer exists, once, then serves Bus
   * events until interrupted. Application composition owns one invocation.
   * Each `alert.fired` runs every enabled Trigger of that rule, sequentially
   * and independently: the template is rendered from the recorded event, then
   * the target shows a notification or admits one Agent Run per
   * `trigger:<triggerId>:<eventId>`. Accepted Runs execute independently.
   * Best-effort: expected failures are logged and skipped, a subscription
   * overflow is logged and resubscribed, and fires in that gap or while the
   * service is down are lost. Defects and interruption propagate.
   * @example
   * const trigger = yield* Trigger.Service;
   * yield* trigger.run();
   */
  readonly run: typeof run;
}

/**
 * Trigger capability supplied by application composition. Providing the
 * service starts no work; its background Layer forks run.
 * @example
 * const trigger = yield* Trigger.Service;
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Trigger",
) {}

// A Trigger holds no foreign key to its source, so nothing cascades on Rule deletion.
const sweepOrphans = Effect.fn("Trigger.sweepOrphans")(function* () {
  yield* Transactor.run(
    Transition.from((tx) =>
      Effect.gen(function* () {
        const rules = yield* alertRuleResource.transitions.listAll().apply(tx);
        const ruleIds = new Set<string>(rules.map((rule) => rule.id));
        const triggers = yield* triggerResource.transitions.listAll().apply(tx);
        yield* Effect.forEach(
          triggers.filter(
            (trigger) =>
              trigger.event.kind === "alert" &&
              !ruleIds.has(trigger.event.ruleId),
          ),
          (trigger) => triggerResource.transitions.remove(trigger.id).apply(tx),
          { discard: true },
        );
      }),
    ),
  );
});

const execute = Effect.fn("Trigger.execute")(function* (
  trigger: TriggerDefinition,
  eventId: AlertEventId,
  tokens: Tokens,
) {
  switch (trigger.target.kind) {
    case "notification": {
      const notification = yield* Notification.Service;
      yield* notification.notify({
        title: trigger.name,
        body: renderTemplate(trigger.target.message, tokens),
        ...(trigger.target.sound && { sound: trigger.target.sound }),
      });
      return;
    }
    case "agent_prompt": {
      const { prompt, binding } = trigger.target;
      const post = yield* Transactor.run(
        postResource.transitions.byAlertEvent({ eventId }),
      );
      const rendered = renderPrompt(prompt, tokens);
      // The intent is the only deduplication: one event never admits two Runs.
      yield* admitPromptTarget({
        intent: `trigger:${trigger.id}:${eventId}`,
        title: trigger.name,
        binding,
        input: {
          ...rendered,
          parts: [
            ...rendered.parts,
            ...(post
              ? [
                  {
                    type: "context" as const,
                    context: {
                      kind: "resource" as const,
                      resource: "post",
                      id: post.id,
                      scope: "attached" as const,
                    },
                  },
                ]
              : []),
            {
              type: "text",
              text: "After investigating this Alert, publish your final analysis with publish_post. Include the conclusion, supporting evidence, and uncertainty. The tool records your author and execution source and quotes the original Rule Post automatically. Do not claim publication succeeded unless the tool returns success.",
            },
          ],
        },
      });
      return;
    }
    default:
      // A new target kind fails to compile here instead of silently doing nothing.
      return trigger.target satisfies never;
  }
});

const onAlertFired = Effect.fn("Trigger.onAlertFired")(
  function* (fired: EventDefinition.Data<typeof AlertFired>) {
    const triggers = (yield* Transactor.run(
      triggerResource.transitions.listAll(),
    )).filter(
      (trigger) =>
        trigger.enabled &&
        trigger.event.kind === "alert" &&
        trigger.event.ruleId === fired.ruleId,
    );
    if (triggers.length === 0) return;
    // The Bus carries ids only: a missing event fails below and the fire is skipped.
    const tokens = yield* Transactor.run(
      Transition.from((tx) =>
        Effect.gen(function* () {
          const event = yield* alertEventResource.transitions
            .get(fired.eventId)
            .apply(tx);
          const rule = yield* alertRuleResource.transitions
            .get(event.ruleId)
            .apply(tx);
          return alertTokens(event, rule.name);
        }),
      ),
    );
    yield* Effect.forEach(
      triggers,
      (trigger) =>
        execute(trigger, fired.eventId, tokens).pipe(
          Effect.catch((error) =>
            Effect.logError("Trigger dispatch failed; skipped", {
              triggerId: trigger.id,
              eventId: fired.eventId,
              error,
            }),
          ),
        ),
      { discard: true },
    );
  },
  (effect, fired) =>
    Effect.catch(effect, (error) =>
      Effect.logError("Alert fire skipped by Trigger dispatch", {
        ...fired,
        error,
      }),
    ),
);

const isAlertFired = Schema.is(AlertFired);

// One branch per event source: a new source adds its branch and token table here.
const onPayload = (payload: EventDefinition.Payload) =>
  isAlertFired(payload) ? onAlertFired(payload.data) : Effect.void;

const run = Effect.fn("Trigger.run")(function* () {
  yield* sweepOrphans().pipe(
    Effect.catch((error) =>
      Effect.logError("Trigger orphan sweep failed; orphans remain", error),
    ),
  );
  // ponytail: one sequential consumer of a 256-slot queue; fork per fire if admission ever lags the tick rate.
  yield* Effect.scoped(
    Bus.allBounded(256).pipe(
      Effect.flatMap((payloads) => Stream.runForEach(payloads, onPayload)),
    ),
  ).pipe(
    Effect.catchTag("Events.SubscriberOverflow", (error) =>
      Effect.logError(
        "Trigger subscription overflowed; fires were lost, resubscribing",
        error,
      ),
    ),
    Effect.forever,
  );
});

/**
 * Registers Trigger dispatch without acquiring dependencies or starting work.
 * run retains its inferred requirements; application composition supplies them
 * to the background Layer. Target writes keep their own transaction boundaries.
 * @example
 * const services = Layer.merge(Trigger.layer, applicationServices);
 */
export const layer = Layer.succeed(Service, { run });
