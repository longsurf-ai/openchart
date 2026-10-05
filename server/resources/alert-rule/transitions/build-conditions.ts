// Purpose: Expose existing condition-to-Tea generation as a Resource query.
import { Transition } from "@openchart/server/lib/resource";
import { Effect, Schema } from "effect";
import {
  buildConditions as build,
  ConditionQuery,
} from "@openchart/server/alert/conditions";

/** Builds the existing standalone source/config projection without saving a Rule. */
export const buildConditions = Transition.make({
  kind: "query",
  input: Schema.Struct({ query: ConditionQuery }),
  resolve: () => Effect.void,
  apply: (_tx, input) =>
    Effect.try({ try: () => build(input.query), catch: (cause) => cause }),
});
