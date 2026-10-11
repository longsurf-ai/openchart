// Purpose: Record the collection script content a person approved, so scheduled runs execute only that content.
import { Transition } from "@openchart/server/lib/resource";
import {
  checkRevision,
  loadExisting,
  toEntity,
} from "@openchart/server/lib/resource/entity-operations";
import {
  ENVELOPE_FIELD_NAMES,
  Revision,
} from "@openchart/server/lib/resource/envelope";
import { Hash } from "@openchart/server/workspace/contract";
import { Effect, Schema, Struct } from "effect";

import { WorkspaceDatasetEntity, WorkspaceDatasetId } from "../entity";
import { workspaceDatasetStore } from "../store";

/**
 * Saves `hash`, the content hash of the script the person reviewed, at the
 * expected revision. Only the application calls it; generic Agent writes are
 * intrinsic and cannot reach it, so an Agent cannot approve its own script.
 * A Dataset without a script collection keeps no approval. An unchanged
 * approval writes nothing.
 * @example yield* Transactor.run(Transition.bindInput(approveCollection, {id, expectedRevision, hash}));
 */
export const approveCollection = Transition.make({
  input: Schema.Struct({
    id: WorkspaceDatasetId,
    expectedRevision: Revision,
    hash: Hash,
  }),
  resolve: () => Effect.void,
  apply: (tx, { id, expectedRevision, hash }) =>
    Effect.gen(function* () {
      const row = yield* loadExisting(
        workspaceDatasetStore,
        "workspace_dataset",
        tx,
        id,
      );
      yield* checkRevision("workspace_dataset", row, expectedRevision);
      const current = yield* toEntity(
        "workspace_dataset",
        WorkspaceDatasetEntity,
        row,
      );
      const approved = current.collection?.kind === "script" ? hash : null;
      if (current.approvedScriptHash === approved) return current;
      const saved = yield* workspaceDatasetStore.save(tx, id, {
        revision: row.revision + 1,
        body: {
          ...Struct.omit(current, ENVELOPE_FIELD_NAMES),
          approvedScriptHash: approved,
        },
      });
      return yield* toEntity(
        "workspace_dataset",
        WorkspaceDatasetEntity,
        saved,
      );
    }),
});
