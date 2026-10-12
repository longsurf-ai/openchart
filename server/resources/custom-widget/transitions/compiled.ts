// Purpose: Serve a saved widget's snapshot as JavaScript the renderer can evaluate.
import { Transition } from "@openchart/server/lib/resource";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import { CustomWidgetEntity } from "@openchart/server/resources/custom-widget/entity";
import { customWidgetStore } from "@openchart/server/resources/custom-widget/store";
import { transpileWidget } from "@openchart/server/widget/compile";
import { Effect, Schema } from "effect";

/**
 * The id, revision and CommonJS (with an inline source map) of the widget a
 * placement names by kind, or null when no widget has that kind. Transpiles in
 * one read transaction and stores nothing; `save` already type-checked it.
 * @example const widget = yield* Transactor.run(customWidgetResource.transitions.compiled({ kind }));
 */
export const compiled = Transition.make({
  kind: "query",
  input: Schema.Struct({ kind: Schema.String }),
  resolve: () => Effect.void,
  apply: (tx, { kind }) =>
    Effect.gen(function* () {
      const [row] = yield* customWidgetStore.list(tx, { kind }, { limit: 1 });
      if (!row) return null;
      const widget = yield* toEntity("custom_widget", CustomWidgetEntity, row);
      return {
        id: widget.id,
        revision: widget.revision,
        code: transpileWidget(widget.snapshot, widget.source.path),
      };
    }),
});
