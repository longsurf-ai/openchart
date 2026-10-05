// Purpose: Records the absence of a workspace selection in historical User Messages.

import type { DatabaseMigration } from "@openchart/server/db/migration";
import { Effect } from "effect";

const migration: DatabaseMigration.Migration = {
  id: "20260918053502_user-message-workspace",
  up: (tx) =>
    Effect.gen(function* () {
      yield* tx.run(`
        UPDATE agent_messages
        SET data = json_set(data, '$.workspaceId', NULL)
        WHERE role = 'user' AND json_type(data, '$.workspaceId') IS NULL
      `);
    }),
};

export default migration;
