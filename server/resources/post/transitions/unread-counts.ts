// Purpose: Counts unread published Posts using transient client preferences and retained Rule identities.
import { Effect, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { AlertRuleId } from "@openchart/server/resources/alert-rule/entity";
import { PostReadFilter } from "@openchart/server/resources/post/schema";
import { countUnreadPosts } from "@openchart/server/resources/post/store";

/** Exact counts including source-deleted history and explicit zeroes for requested Rules. */
export const unreadCounts = Transition.make({
  kind: "query",
  input: Schema.Struct({
    ruleIds: Schema.Array(AlertRuleId).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200),
    ),
    ...PostReadFilter.fields,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    countUnreadPosts(tx, input).pipe(
      Effect.map((rows) => {
        const counts = new Map(rows.map((row) => [row.ruleId, row.count]));
        return input.ruleIds.map((ruleId) => ({
          ruleId,
          count: counts.get(ruleId) ?? 0,
        }));
      }),
    ),
});
