// Purpose: Read one Rule's event history in occurrence order without changing stored events.
import { Effect, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { Timestamp } from "@openchart/server/lib/resource/envelope";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import {
  DEFAULT_PAGE_SIZE,
  ListOrder,
  MAX_PAGE_SIZE,
} from "@openchart/server/lib/resource/pagination";
import { AlertRuleId } from "@openchart/server/resources/alert-rule/entity";
import { AlertEventEntity, AlertEventId } from "../entity";
import { readAlertHistory } from "../store";

const position = Schema.Struct({ time: Timestamp, id: AlertEventId }).annotate({
  parseOptions: { onExcessProperty: "error" },
});
const cursor = Schema.String.pipe(
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(Schema.fromJsonString(position)),
);
const encodeCursor = Schema.encodeSync(cursor);

/**
 * Page saved fires by occurrence time, then ID, with a count of all this Rule's
 * events. Defaults to newest first; keep ruleId/order unchanged when following
 * nextCursor. Repeated fires remain separate. A missing/deleted Rule returns an
 * empty history. Transactor owns read consistency and cleanup; malformed inputs
 * fail boundary validation and database failures propagate to the caller.
 * @example yield* Transactor.run(alertEventResource.transitions.history({ruleId, limit: 20}));
 */
export const history = Transition.make({
  kind: "query",
  input: Schema.Struct({
    ruleId: AlertRuleId,
    order: Schema.optionalKey(ListOrder),
    limit: Schema.optionalKey(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: MAX_PAGE_SIZE }),
      ),
    ),
    cursor: Schema.optionalKey(cursor),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    Effect.gen(function* () {
      const limit = input.limit ?? DEFAULT_PAGE_SIZE;
      const { rows, total } = yield* readAlertHistory(tx, {
        ...input,
        order: input.order ?? "desc",
        limit: limit + 1,
      });
      const items = yield* Effect.forEach(rows.slice(0, limit), (row) =>
        toEntity("alert_event", AlertEventEntity, row),
      );
      const last = items.at(-1);
      return {
        items,
        total,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ time: last.time, id: last.id })
            : null,
      };
    }),
});
