// Purpose: Resolves Alert publication provenance and Feed execution status from Trigger-owned intents.
import { Effect, Schema } from "effect";
import { runsByIntent } from "@openchart/server/agent/run/store";
import { Transactor, Transition } from "@openchart/server/lib/resource";
import { AlertEventId } from "@openchart/server/resources/alert-event";
import {
  TriggerId,
  triggerResource,
} from "@openchart/server/resources/trigger";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import { postResource } from "@openchart/server/resources/post";

const AlertIntent = Schema.Struct({
  triggerId: TriggerId,
  eventId: AlertEventId,
});

/** Parses only Trigger-owned Alert intents; other admission sources have no Alert provenance.
 * @example alertIntent("trigger:trg_example:ale_example");
 */
export function alertIntent(intent: string) {
  if (!intent.startsWith("trigger:")) return null;
  const [, triggerId, eventId, extra] = intent.split(":");
  return Schema.decodeUnknownSync(AlertIntent)({
    triggerId,
    eventId: extra === undefined ? eventId : undefined,
  });
}

/** Resolves the durable original Post even after Rule/Event deletion; never reads a mutable binding.
 * @example const original = yield* alertPostForIntent(run.sessionIntentID);
 */
export const alertPostForIntent = Effect.fn("Trigger.alertPostForIntent")(
  function* (intent: string) {
    const source = alertIntent(intent);
    if (!source) return null;
    return yield* Transactor.run(
      postResource.transitions.byAlertEvent({ eventId: source.eventId }),
    );
  },
);

/** Reads accepted Runs and publication presence for a bounded Feed page without executing Agent work.
 * @example const executions = yield* feedExecutions([eventId]);
 */
export const feedExecutions = Effect.fn("Trigger.feedExecutions")(function* (
  eventIds: readonly AlertEventId[],
) {
  const rows = yield* runsByIntent(
    "trigger:",
    eventIds.map((id) => `:${id}`),
  );
  const [triggers, rules, originals] = yield* Transactor.run(
    Transition.from((tx) =>
      Effect.all([
        triggerResource.transitions.listAll().apply(tx),
        alertRuleResource.transitions.listAll().apply(tx),
        Effect.forEach(eventIds, (eventId) =>
          postResource.transitions.byAlertEvent({ eventId }).apply(tx),
        ),
      ]),
    ),
  );
  const ruleIds = new Set<string>(rules.map((rule) => rule.id));
  const sourceRules = new Map(
    originals.flatMap((post) =>
      post?.origin.kind === "alert_event"
        ? [[post.origin.eventId, post.origin.ruleId] as const]
        : [],
    ),
  );
  const editableTriggers = new Map(
    triggers
      .filter(
        (trigger) =>
          trigger.target.kind === "agent_prompt" &&
          ruleIds.has(trigger.event.ruleId),
      )
      .map((trigger) => [trigger.id, trigger.event.ruleId]),
  );
  const published = new Set<string>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const ids = yield* Transactor.run(
      postResource.transitions.publishedRuns({
        runIds: rows.slice(offset, offset + 200).map(({ run }) => run.id),
      }),
    );
    for (const id of ids) published.add(id);
  }
  return eventIds.map((eventId) => ({
    eventId,
    runs: rows.flatMap(({ run, title }) => {
      const source = alertIntent(run.sessionIntentID);
      return source?.eventId === eventId
        ? [
            {
              runId: run.id,
              sessionId: run.sessionID,
              title,
              providerId: run.input.model.providerID,
              status: run.status,
              triggerId: source.triggerId,
              canEditPrompt:
                editableTriggers.has(source.triggerId) &&
                editableTriggers.get(source.triggerId) ===
                  sourceRules.get(eventId),
              hasPublished: published.has(run.id),
            },
          ]
        : [];
    }),
  }));
});
