// Purpose: Removes creation intent IDs from persisted Dig In anchors.
import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260917184400_remove-dig-in-creation-intent",
  /** Preserve anchor order, selection and child links while dropping the retired field. @example yield* migration.up(tx); */
  up(tx) {
    return tx.run(`
      UPDATE agent_sessions
      SET anchors = (
        SELECT json_group_array(json_remove(value, '$.sessionIntentId'))
        FROM json_each(agent_sessions.anchors)
      )
      WHERE anchors IS NOT NULL
    `).pipe(Effect.asVoid);
  },
};

export default migration;
