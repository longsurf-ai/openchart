// Purpose: Register persisted drawings on the existing Resource surfaces.
import { defineResource } from "@openchart/server/lib/resource/definition";

import { DrawingEntity } from "./entity";
import { drawingStore } from "./store";

export { DrawingEntity, DrawingId } from "./entity";

/** Independent Drawing CRUD, revisions, pagination and events. @example resources.drawing.get({ id }); */
export const drawingResource = defineResource({
  name: "drawing",
  description:
    "A saved drawing or annotation on a dashboard for a provider-specific listing, including its geometry, style, and visibility. Drawing-based Alert Rules reference this Resource.",
  entity: DrawingEntity,
  store: drawingStore,
});
