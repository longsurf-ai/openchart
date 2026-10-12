// Purpose: Register saved custom widgets on the existing Resource surfaces.
import { defineResource } from "@openchart/server/lib/resource/definition";

import { CustomWidgetEntity } from "./entity";
import { customWidgetStore } from "./store";
import { compiled } from "./transitions/compiled";
import { save } from "./transitions/save";

/** Saved widget code, revisions, pagination and events; `save` is the only writer. @example resources.custom_widget.list({ filter: { kind } }); */
export const customWidgetResource = defineResource({
  name: "custom_widget",
  description:
    "Agent- or user-authored dashboard widget code. Each is a checked snapshot of a .widget.tsx Workspace file, saved with save_widget. Delete removes the widget; its file stays.",
  entity: CustomWidgetEntity,
  store: customWidgetStore,
  transitions: { save, compiled },
});
