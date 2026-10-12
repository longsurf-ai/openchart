// Purpose: Derive the Custom Widget Resource entity; every field is written only by `save`.
import {
  listKey,
  serverManaged,
} from "@openchart/server/lib/resource/annotation";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { ReadInput } from "@openchart/server/workspace/contract";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { CustomWidgetId, customWidgetTable } from "./schema";

export { CustomWidgetId } from "./schema";

/** A widget's `kind`: lowercase letters, digits and hyphens, starting with a letter. */
export const CUSTOM_WIDGET_KIND = /^[a-z][a-z0-9-]{0,63}$/;
/** Longest title a widget may declare. */
export const CUSTOM_WIDGET_TITLE_MAX = 80;

/** A Workspace path to a widget file. */
export const CustomWidgetPath = ReadInput.fields.path.check(
  Schema.makeFilter((path) => path.endsWith(".widget.tsx"), {
    message: "Expected a .widget.tsx path",
  }),
);

const columns = createSelectSchema(customWidgetTable, {
  kind: (schema) => schema.check(Schema.isPattern(CUSTOM_WIDGET_KIND)),
  title: (schema) =>
    schema.check(
      Schema.isPattern(/\S/),
      Schema.isMaxLength(CUSTOM_WIDGET_TITLE_MAX),
    ),
  workspaceId: ReadInput.fields.workspaceId,
  path: CustomWidgetPath,
});

/**
 * One saved custom widget with its own revision. `snapshot` is the checked
 * source the renderer runs; `source` records the Workspace file it came from.
 * All fields are server-managed: `save` reads, checks and writes them together.
 */
export const CustomWidgetEntity = Schema.Struct({
  ...envelopeFields(CustomWidgetId),
  kind: listKey(serverManaged(columns.fields.kind)),
  title: serverManaged(columns.fields.title),
  source: serverManaged(
    Schema.Struct({
      workspaceId: columns.fields.workspaceId,
      path: columns.fields.path,
    }),
  ),
  snapshot: serverManaged(columns.fields.snapshot),
});

/** Complete Custom Widget returned by Resource reads. */
export type CustomWidgetEntity = typeof CustomWidgetEntity.Type;
