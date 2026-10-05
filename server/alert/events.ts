// Purpose: Announce a recorded Alert fire on the backend Bus with identifiers only.
import { EventDefinition } from "@openchart/server/events";
import { AlertEventId } from "@openchart/server/resources/alert-event";
import { AlertRuleId } from "@openchart/server/resources/alert-rule";

/**
 * Published on the Bus only after the alert_event row commits. It carries ids,
 * never the event payload: consumers read the alert_event Resource themselves.
 * The Bus is live-only, so a consumer that is down misses the fire.
 *
 * @example
 * ```ts
 * const bus = yield* Bus.Service;
 * yield* bus.publish(AlertFired, {ruleId: event.ruleId, eventId: event.id});
 * ```
 */
export const AlertFired = EventDefinition.define({
  type: "alert.fired",
  schema: {
    ruleId: AlertRuleId,
    eventId: AlertEventId,
  },
});
