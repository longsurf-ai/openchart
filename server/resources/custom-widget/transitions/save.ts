// Purpose: Check a Workspace widget file and save it as the live snapshot of the widget it declares.
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Transition } from "@openchart/server/lib/resource";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import { ENVELOPE_FIELD_NAMES } from "@openchart/server/lib/resource/envelope";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import {
  CustomWidgetEntity,
  CustomWidgetId,
  CustomWidgetPath,
} from "@openchart/server/resources/custom-widget/entity";
import { customWidgetStore } from "@openchart/server/resources/custom-widget/store";
import { WorkspaceId } from "@openchart/server/resources/workspace";
import { checkWidget } from "@openchart/server/widget/compile";
import { WidgetInvalid } from "@openchart/server/widget/errors";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { Effect, Schema, Struct } from "effect";

/**
 * Reads the file and checks it against the widget SDK outside the
 * transaction, then saves it under the `kind` it declares. A new kind creates
 * a widget. The file that saved a kind updates it freely; another file is
 * refused until that widget is deleted. An unchanged snapshot from the same
 * file writes nothing. A failed read or check leaves every widget unchanged.
 * @example yield* Transactor.run(customWidgetResource.transitions.save({ workspaceId, path: "widgets/rates.widget.tsx" }));
 */
export const save = Transition.make({
  input: Schema.Struct({
    workspaceId: WorkspaceId,
    path: CustomWidgetPath,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: ({ workspaceId, path }) =>
    Effect.gen(function* () {
      const workspace = yield* (yield* Workspaces).open(workspaceId);
      const { base64 } = yield* workspace.read(path);
      const snapshot = yield* Effect.try({
        try: () =>
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(base64, "base64"),
          ),
        catch: () =>
          new WidgetInvalid({ message: `${path} is not UTF-8 text.` }),
      });
      const declared = yield* Effect.try({
        try: () => checkWidget(snapshot, join(workspace.root, path)),
        catch: (cause) =>
          cause instanceof WidgetInvalid
            ? cause
            : new WidgetInvalid({ message: String(cause) }),
      });
      return { ...declared, snapshot };
    }),
  apply: (tx, { workspaceId, path }, resolved) =>
    Effect.gen(function* () {
      const body = {
        kind: resolved.kind,
        title: resolved.title,
        source: { workspaceId, path },
        snapshot: resolved.snapshot,
      };
      const [row] = yield* customWidgetStore.list(
        tx,
        { kind: resolved.kind },
        { limit: 1 },
      );
      if (!row) {
        const created = yield* customWidgetStore.insert(tx, {
          id: CustomWidgetId.create(),
          revision: 1,
          body,
        });
        return yield* toEntity("custom_widget", CustomWidgetEntity, created);
      }
      const current = yield* toEntity("custom_widget", CustomWidgetEntity, row);
      if (!isDeepStrictEqual(current.source, body.source)) {
        const reason = `Widget kind "${resolved.kind}" is saved from ${current.source.path}. Declare another kind, or delete custom_widget ${row.id} first.`;
        return yield* new ResourceStateInvalid({
          resource: "custom_widget",
          reason,
          issues: [
            {
              code: "custom_widget.kind_taken",
              path: "/kind",
              message: reason,
            },
          ],
        });
      }
      if (isDeepStrictEqual(Struct.omit(current, ENVELOPE_FIELD_NAMES), body))
        return current;
      const saved = yield* customWidgetStore.save(tx, row.id, {
        revision: row.revision + 1,
        body,
      });
      return yield* toEntity("custom_widget", CustomWidgetEntity, saved);
    }),
});
