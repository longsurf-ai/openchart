// Purpose: Validate and persist an Alert Rule definition independently of its Triggers.
import { isDeepStrictEqual } from "node:util";
import { Effect, Schema, Struct } from "effect";

import { validateAlertStarterParameters } from "@openchart/server/alert/starters";
import { drawingTeaDefinition } from "@openchart/server/alert/drawing-alerts";
import {
  drawingResource,
  type DrawingEntity,
} from "@openchart/server/resources/drawing";
import { indicatorResource } from "@openchart/server/resources/indicator";
import { ruleRequest } from "@openchart/server/resources/macros/follow-indicator";
import * as Tea from "@openchart/server/tea";
import {
  Revision,
  Transition,
  Transactor,
} from "@openchart/server/lib/resource";
import { ENVELOPE_FIELD_NAMES } from "@openchart/server/lib/resource/envelope";
import {
  checkRevision,
  loadExisting,
  toEntity,
} from "@openchart/server/lib/resource/entity-operations";
import {
  AlertRuleEntity,
  AlertRuleId,
  AlertRuleRunConfig,
  decodeAlertRuleRunConfig,
} from "@openchart/server/resources/alert-rule/entity";
import { alertRuleStore } from "@openchart/server/resources/alert-rule/store";

/**
 * Creates or replaces a Rule only after compilation and complete binding validation,
 * including disabled Rules. Resolve releases its compilations without acquiring Feed;
 * apply checks Rule/Drawing/Indicator revisions and preserves unchanged Rule revisions.
 * A Tea config is stored as the canonical JSON its decoding encodes back to, so an
 * unchanged definition compares equal. A rule that follows an Indicator validates
 * together with it on its cell's market, as the observer runs it ({@link ruleRequest}).
 * @example yield* Transactor.run(alertRuleResource.transitions.save({value}));
 */
export const save = Transition.make({
  input: Schema.Struct({
    rule: Schema.optionalKey(
      Schema.Struct({ id: AlertRuleId, expectedRevision: Revision }),
    ),
    value: Schema.Struct(
      Struct.omit(AlertRuleEntity.fields, ENVELOPE_FIELD_NAMES),
    ),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: (input) =>
    Effect.gen(function* () {
      const tea = yield* Tea.Service;
      const alertable = input.value.alertable;
      let stored = alertable;
      let drawing: DrawingEntity | undefined;
      let definition;
      if (alertable.kind === "drawing") {
        drawing = yield* Transactor.run(
          drawingResource.transitions.get(alertable.drawingId),
        );
        const current = drawing;
        definition = yield* Effect.try({
          try: () => drawingTeaDefinition(current, alertable),
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
        });
      } else {
        const config = yield* decodeAlertRuleRunConfig(alertable.config);
        // Store what decoding encodes back to: one JSON for equal configs.
        stored = {
          ...alertable,
          config: Schema.encodeSync(AlertRuleRunConfig)(config),
        };
        definition = { source: alertable.source, config };
      }
      const { source, config } = definition;
      const indicator = yield* Effect.scoped(
        Effect.gen(function* () {
          const invalidParameters = validateAlertStarterParameters(
            source,
            config.parameters,
          );
          if (invalidParameters)
            return yield* Effect.fail(
              new Tea.Error({
                code: "invalid_request",
                message: invalidParameters,
              }),
            );
          const node = yield* Effect.acquireRelease(
            tea.compile({ entry: "<inline>", sources: { "<inline>": source } }),
            (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
          );
          if (Tea.teaAlertOutputs(node.definition.outputs).length === 0)
            return yield* Effect.fail(
              new Tea.Error({
                code: "invalid_request",
                message:
                  "An alert script must emit at least one alert condition.",
              }),
            );
          const run = yield* ruleRequest(config);
          yield* tea.validate({ id: node.id, ...run.config, nodes: run.nodes });
          return run.follow?.indicator;
        }),
      );
      return { alertable: stored, drawing, indicator };
    }),
  apply: (tx, input, { alertable, drawing, indicator }) =>
    Effect.gen(function* () {
      const value = { ...input.value, alertable };
      if (indicator) {
        const current = yield* indicatorResource.transitions
          .get(indicator.id)
          .apply(tx, undefined);
        yield* checkRevision("indicator", current, indicator.revision);
      }
      if (drawing) {
        const current = yield* drawingResource.transitions
          .get(drawing.id)
          .apply(tx, undefined);
        yield* checkRevision("drawing", current, drawing.revision);
      }
      if (input.rule) {
        const current = yield* loadExisting(
          alertRuleStore,
          "alert_rule",
          tx,
          input.rule.id,
        );
        yield* checkRevision(
          "alert_rule",
          current,
          input.rule.expectedRevision,
        );
        const before = yield* toEntity("alert_rule", AlertRuleEntity, current);
        if (isDeepStrictEqual(Struct.omit(before, ENVELOPE_FIELD_NAMES), value))
          return before;
        const row = yield* alertRuleStore.save(tx, before.id, {
          revision: before.revision + 1,
          body: value,
        });
        return yield* toEntity("alert_rule", AlertRuleEntity, row);
      }
      const row = yield* alertRuleStore.insert(tx, {
        id: AlertRuleId.create(),
        revision: 1,
        body: value,
      });
      return yield* toEntity("alert_rule", AlertRuleEntity, row);
    }),
});
