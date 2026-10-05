// Purpose: Save validated Alert definitions through the Alert Rule's own transition.
import { Effect } from "effect";
import { Tool } from "@openchart/server/agent/tool/tool";
import { Transactor } from "@openchart/server/lib/resource";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import { ask, result } from "./resource-shared";

const Parameters = alertRuleResource.transitionDefinitions.save.input;

/**
 * Creates or updates one Rule after permission, using its shared validation/write
 * transition. Failures return diagnostics; cancellation and permission outcomes
 * propagate. Triggers are independent and this tool never dispatches an action.
 * @example const result = yield* tool.execute({value: definition}, context);
 */
export const SaveAlertRuleTool = Tool.define(
  "save_alert_rule",
  Effect.succeed({
    description:
      "Create or update an Alert Rule with complete name, enabled, repeat and alertable values. Omit rule when creating; when updating, supply rule.id and rule.expectedRevision from a fresh resource_read. alertable contains self-contained Tea source plus its config, or a Drawing reference with its operator and market inputs. A Tea config is either the NodeConfig that tea_check and tea_run take, with Bars inputs only, or {indicatorId, parameters, requests} to follow an Indicator on a chart: the rule then runs on that chart's market and reads the Indicator's numeric and plot outputs as indicator.<name> columns. Its parameters and requests are the rule script's own; the Indicator keeps its parameters. tea_check and tea_run can't take this form, so this save is what validates it against the Indicator. All definitions, including disabled rules, must compile, emit an Alert and pass configuration validation before saving. Failed validation leaves the Rule unchanged and returns diagnostics. enabled controls background monitoring only. This tool saves no notification or Agent actions; manage those as separate trigger Resources referencing the returned Rule id. Use resource_mutate for Rule name/enabled/repeat changes or deletion, never for alertable.",
    parameters: Parameters,
    execute: (input: typeof Parameters.Type, context: Tool.Context) =>
      result(
        "Save alert rule",
        Effect.gen(function* () {
          yield* ask(context, "save_alert_rule", ["alert_rule"], input);
          const entity = yield* Transactor.run(
            alertRuleResource.transitions.save(input),
          );
          return { resource: alertRuleResource.name, entity };
        }),
      ),
  }),
);
