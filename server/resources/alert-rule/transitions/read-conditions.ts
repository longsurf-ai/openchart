// Purpose: Expose exact saved Tea condition projection as a Resource query.
import { Transition } from "@openchart/server/lib/resource";
import { Effect, Schema } from "effect";
import { readConditions as read } from "@openchart/server/alert/conditions";

/** Reads the existing condition projection; custom Tea remains unmodified. */
export const readConditions = Transition.make({
  kind: "query",
  input: Schema.Struct({
    source: Schema.String.check(Schema.isMaxLength(65536)),
    parameters: Schema.Record(
      Schema.String,
      Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
    ),
  }),
  resolve: () => Effect.void,
  apply: (_tx, input) =>
    Effect.try({
      try: () => read(input.source, input.parameters),
      catch: (cause) => cause,
    }),
});
