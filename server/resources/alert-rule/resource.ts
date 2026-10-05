// Purpose: Register Alert Rule CRUD and existing authoring queries on shared Resource surfaces.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { AlertRuleEntity } from "./entity";
import { alertRuleStore } from "./store";
import { starters } from "./transitions/starters";
import { buildConditions } from "./transitions/build-conditions";
import { readConditions } from "./transitions/read-conditions";
import { inspect } from "./transitions/inspect";
import { save } from "./transitions/save";

export {
  AlertRuleEntity,
  AlertRuleId,
  AlertRuleRunConfig,
  decodeAlertRuleRunConfig,
} from "./entity";
export {
  AlertableDefinition,
  AlertRuleConfig,
  DrawingAlertDefinition,
  FollowIndicatorConfig,
} from "./schema";

/**
 * User-authored alert rules; persistence starts no Tea observation.
 *
 * @example
 * ```ts
 * const rule = yield* Transactor.run(alertRuleResource.transitions.get(id));
 * ```
 */
export const alertRuleResource = defineResource({
  name: "alert_rule",
  description:
    "A saved condition to monitor, defined by self-contained Tea source and configuration or a Drawing reference with an operator and market inputs. Enabled and repeat settings control observation and whether the rule remains active after firing.",
  entity: AlertRuleEntity,
  store: alertRuleStore,
  transitions: { starters, buildConditions, readConditions, inspect, save },
});

/** Complete Alert Rule returned by Resource reads and writes. */
export type AlertRule = typeof alertRuleResource.entity.Type;
