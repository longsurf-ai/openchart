// Purpose: Register Workspace Datasets on the existing Resource surfaces.
import { defineResource } from "@openchart/server/lib/resource/definition";

import { WorkspaceDatasetEntity } from "./entity";
import { workspaceDatasetStore } from "./store";
import { approveCollection } from "./transitions/approve-collection";

export { WorkspaceDatasetEntity, WorkspaceDatasetId } from "./entity";

/** Workspace Dataset CRUD, revisions, pagination and events. @example resources.workspace_dataset.list({}); */
export const workspaceDatasetResource = defineResource({
  name: "workspace_dataset",
  description:
    "A timeseries kept as a CSV file in a Workspace: its time column, declared observation columns, and how the file is collected (an Agent prompt or a uv Python script). Charts plot its columns; schedules re-collect it.",
  entity: WorkspaceDatasetEntity,
  store: workspaceDatasetStore,
  transitions: { approveCollection },
});

/** Complete Workspace Dataset returned by Resource reads and writes. */
export type WorkspaceDataset = typeof workspaceDatasetResource.entity.Type;
