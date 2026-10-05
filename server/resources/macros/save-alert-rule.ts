// Purpose: Save an Alert Rule and its complete action snapshot atomically.
import { isDeepStrictEqual } from "node:util";
import { Array, Effect, Schema } from "effect";
import { AlertSaveConflict } from "@openchart/server/alert/errors";
import {
  Revision,
  Transition,
  type PatchOperation,
} from "@openchart/server/lib/resource";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import {
  TriggerId,
  triggerResource,
  type Trigger,
} from "@openchart/server/resources/trigger";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const actionFields = {
  name: triggerResource.body.fields.name,
  enabled: Schema.Boolean,
  target: triggerResource.body.fields.target,
};

/** Every existing action is either retained or explicitly removed, at its captured revision. */
export const SaveAlertRuleInput = Schema.Struct({
  ...alertRuleResource.transitionDefinitions.save.input.fields,
  actions: Schema.Array(
    Schema.Union([
      Schema.Struct({
        ...actionFields,
        id: TriggerId,
        expectedRevision: Revision,
      }).annotate(strict),
      Schema.Struct(actionFields).annotate(strict),
    ]),
  ),
  removedActions: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ id: TriggerId, expectedRevision: Revision }).annotate(
        strict,
      ),
    ),
  ),
}).annotate(strict);

function changes(
  before: Schema.JsonObject,
  after: Schema.JsonObject,
): PatchOperation[] {
  return Object.entries(after).flatMap(([key, value]) =>
    isDeepStrictEqual(before[key], value)
      ? []
      : [{ op: "replace" as const, path: `/${key}`, value }],
  );
}

/**
 * Reuse the Rule save transition before writing the action snapshot; saving never starts Feed or
 * dispatches an action. Revision checks and all writes share one transaction.
 * Unchanged bodies keep their revisions, so delivery edits do not restart Tea.
 * @example yield* Transactor.run(saveAlertRule(input));
 */
export function saveAlertRule(input: typeof SaveAlertRuleInput.Type) {
  const saveRule = alertRuleResource.transitions.save(input);
  return Transition.make({
    resolve: saveRule.resolve,
    apply: (tx, resolved) =>
      Effect.gen(function* () {
        const rule = yield* saveRule.apply(tx, resolved);
        const attached = input.rule
          ? (yield* triggerResource.transitions
              .listAll()
              .apply(tx, undefined)).filter(
              (action) => action.event.ruleId === rule.id,
            )
          : [];
        const expected = [
          ...input.actions.flatMap((action) =>
            "id" in action ? [action] : [],
          ),
          ...(input.removedActions ?? []),
        ];
        const byId = new Map(attached.map((action) => [action.id, action]));
        if (
          expected.length !== attached.length ||
          new Set(expected.map((action) => action.id)).size !==
            expected.length ||
          expected.some(
            (action) =>
              byId.get(action.id)?.revision !== action.expectedRevision,
          )
        )
          return yield* Effect.fail(new AlertSaveConflict());

        for (const action of input.removedActions ?? [])
          yield* triggerResource.transitions
            .remove(action.id)
            .apply(tx, undefined);
        const actions: Trigger[] = [];
        for (const action of input.actions) {
          const value = {
            name: action.name,
            enabled: action.enabled,
            event: { kind: "alert" as const, ruleId: rule.id },
            target: action.target,
          };
          if ("id" in action) {
            const current = byId.get(action.id)!;
            const operations = changes(current, value);
            actions.push(
              Array.isArrayNonEmpty(operations)
                ? yield* triggerResource.transitions
                    .patch({
                      id: current.id,
                      expectedRevision: current.revision,
                      operations,
                    })
                    .apply(tx, undefined)
                : current,
            );
          } else {
            actions.push(
              yield* triggerResource.transitions
                .create(value)
                .apply(tx, undefined),
            );
          }
        }
        return { rule, actions };
      }),
  });
}
