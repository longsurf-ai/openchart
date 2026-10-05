// Purpose: Represents an unspecified User workspace by omission.

import type { DatabaseMigration } from "@openchart/server/db/migration";
import { Effect } from "effect";

const migration: DatabaseMigration.Migration = {
  id: "20260918061811_optional-user-message-workspace",
  up: (tx) =>
    Effect.gen(function* () {
      yield* tx.run(`
        UPDATE agent_messages
        SET data = json_remove(data, '$.workspaceId')
        WHERE role = 'user' AND json_type(data, '$.workspaceId') = 'null'
      `);
    }),
};

export default migration;
