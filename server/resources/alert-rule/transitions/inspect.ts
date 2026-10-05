// Purpose: Inspect inline Alert Tea through a Resource query without retaining its compilation.
import { Transition } from "@openchart/server/lib/resource";
import { Effect, Schema } from "effect";

import { AlertableDefinition } from "@openchart/server/resources/alert-rule/schema";
import * as Tea from "@openchart/server/tea";

/**
 * Compiles inline alert source and returns its Definition as JSON, with Arrow
 * JSON schemas, plus its alert outputs. The compilation is released before the
 * read transaction; no Feed or Rule writes.
 */
export const inspect = Transition.make({
  kind: "query",
  input: Schema.Struct({
    source: AlertableDefinition.members[0].fields.source,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const tea = yield* Tea.Service;
        const node = yield* Effect.acquireRelease(
          tea.compile({
            entry: "<inline>",
            sources: { "<inline>": input.source },
          }),
          (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
        );
        const alertOutputs = Tea.teaAlertOutputs(node.definition.outputs);
        if (!alertOutputs.length)
          return yield* Effect.fail(
            new Tea.Error({
              code: "invalid_request",
              message:
                "An alert script must emit at least one alert condition.",
            }),
          );
        return {
          node: Schema.encodeSync(Tea.Definition)(node.definition),
          alertOutputs,
        };
      }),
    ),
  apply: (_tx, _input, result) => Effect.succeed(result),
});
