// Purpose: Resolves saved Post publication evidence without guessing Run success.
import { Effect, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { findPublishedRuns } from "@openchart/server/resources/post/store";

/** Requested Run IDs with at least one published Post, independently of execution status. */
export const publishedRuns = Transition.make({
  kind: "query",
  input: Schema.Struct({
    runIds: Schema.Array(
      Schema.String.check(Schema.isStartsWith("agr_")),
    ).check(Schema.isMaxLength(200)),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    input.runIds.length === 0
      ? Effect.succeed([])
      : findPublishedRuns(tx, input.runIds).pipe(
          Effect.map((rows) => rows.map((row) => row.runId)),
        ),
});
