// Purpose: Records one Alert fire, publishes its Rule Post, and retires a non-repeating Rule atomically.

import { isDeepStrictEqual } from "node:util";
import type { BarsSeries } from "@openchart/feed";
import { Transition } from "@openchart/server/lib/resource";
import { alertEventResource } from "@openchart/server/resources/alert-event";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import {
  alertEventPostContent,
  publishPost,
} from "@openchart/server/resources/post";
import {
  drawingResource,
  type DrawingId,
} from "@openchart/server/resources/drawing";
import type { IndicatorId } from "@openchart/server/resources/indicator";
import { Effect } from "effect";

import { followIndicator } from "./follow-indicator";

/**
 * Writes one Alert Event and its durable Rule Post for an enabled Rule and returns the Event. A missing or
 * disabled or revision-changed Rule writes nothing and returns null, as does a
 * changed drawing, Indicator, or Indicator cell market, so callers publish only
 * non-null results. A Rule with `repeat = false` is disabled in the same
 * transaction: however dense the ticks, it records exactly one event. Identical
 * `(ruleId, condition, time)` fires are separate events. Run it once through
 * Transactor; construction performs no I/O.
 *
 * @param input - Complete event body and the Rule revision captured by its observer.
 *
 * @example
 * ```ts
 * const event = yield* Transactor.run(
 *   recordAlertFire({ruleId, expectedRevision, condition: "crossed", time, detail}),
 * );
 * if (event) yield* bus.publish(AlertFired, {ruleId, eventId: event.id});
 * ```
 */
export function recordAlertFire(
  input: typeof alertEventResource.body.Type & {
    readonly expectedRevision: number;
    readonly expectedDrawing?: {
      readonly id: DrawingId;
      readonly revision: number;
    };
    readonly expectedIndicator?: {
      readonly id: IndicatorId;
      readonly revision: number;
      readonly market: BarsSeries;
    };
  },
) {
  const { expectedRevision, expectedDrawing, expectedIndicator, ...body } =
    input;
  return Transition.from((tx) =>
    Effect.gen(function* () {
      const rule = yield* alertRuleResource.transitions
        .get(input.ruleId)
        .apply(tx, undefined)
        .pipe(
          Effect.catchTag("Resource.NotFound", () => Effect.succeed(undefined)),
        );
      if (!rule?.enabled || rule.revision !== expectedRevision) return null;
      if (rule.alertable.kind === "drawing") {
        if (!expectedDrawing || expectedDrawing.id !== rule.alertable.drawingId)
          return null;
        const drawing = yield* drawingResource.transitions
          .get(expectedDrawing.id)
          .apply(tx, undefined)
          .pipe(
            Effect.catchTag("Resource.NotFound", () =>
              Effect.succeed(undefined),
            ),
          );
        // Commit-time validation closes the gap before ResourceChanged restarts the observer.
        if (!drawing || drawing.revision !== expectedDrawing.revision)
          return null;
      }
      const config =
        rule.alertable.kind === "tea" ? rule.alertable.config : undefined;
      if (config && "indicatorId" in config) {
        if (!expectedIndicator || expectedIndicator.id !== config.indicatorId)
          return null;
        // The observer may be running an older Indicator or cell market.
        const follow = yield* followIndicator(expectedIndicator.id).apply(
          tx,
          undefined,
        );
        if (
          !follow ||
          follow.indicator.revision !== expectedIndicator.revision ||
          !isDeepStrictEqual(follow.market, expectedIndicator.market)
        )
          return null;
      }
      const event = yield* alertEventResource.transitions
        .create(body)
        .apply(tx, undefined);
      yield* publishPost({
        publicationKey: `event:${event.id}`,
        author: { kind: "rule", ruleId: rule.id, name: rule.name },
        origin: {
          kind: "alert_event",
          eventId: event.id,
          ruleId: rule.id,
          occurredAt: event.time,
        },
        content: alertEventPostContent(event),
        quotedPostId: null,
      }).apply(tx, undefined);
      if (!rule.repeat) {
        yield* alertRuleResource.transitions
          .patch({
            id: rule.id,
            expectedRevision: rule.revision,
            operations: [{ op: "replace", path: "/enabled", value: false }],
          })
          .apply(tx, undefined);
      }
      return event;
    }),
  );
}
