// Purpose: Tell clients that some Monitoring Status changed state or reason.
import { EventDefinition } from "@openchart/server/events";

/**
 * An invalidation without payload: clients re-read `monitoring.status`.
 * Routine evidence renewals never publish it.
 *
 * @example
 * ```ts
 * const events = yield* Events.Service;
 * yield* events.publish(MonitoringChanged, {});
 * ```
 */
export const MonitoringChanged = EventDefinition.define({
  type: "monitoring.changed",
  schema: {},
});
