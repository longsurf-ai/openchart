// Purpose: Unifies direct tool and workflow child relationships on ToolPart.

import type { DatabaseMigration } from "@openchart/server/db/migration";
import { Effect } from "effect";

const migration: DatabaseMigration.Migration = {
  id: "20260918214003_tool-child-session-links",
  /**
   * Converts scalar links and workflow trace links to a unique child collection.
   * Existing trace payloads and all other tool facts stay unchanged.
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      const invalid = yield* tx.all(`
        SELECT id FROM agent_parts
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_type(data, '$.childSessionId') IS NOT NULL
          AND (json_type(data, '$.childSessionId') <> 'text'
            OR length(json_extract(data, '$.childSessionId')) = 0)
        UNION
        SELECT agent_parts.id FROM agent_parts,
          json_tree(agent_parts.data, '$.state.metadata.trace') AS entry
        WHERE json_extract(agent_parts.data, '$.type') = 'tool'
          AND json_extract(agent_parts.data, '$.tool') = 'workflow'
          AND entry.key = 'key' AND entry.value = 'openchart.session.id'
          AND (json_type(agent_parts.data, entry.path || '.value.stringValue') IS NOT 'text'
            OR length(json_extract(agent_parts.data, entry.path || '.value.stringValue')) = 0)
      `);
      if (invalid.length > 0)
        return yield* Effect.die("Tool contains an invalid child Session link");

      yield* tx.run(`
        UPDATE agent_parts
        SET data = json_set(json_remove(data, '$.childSessionId'), '$.childSessionIds', json((
          SELECT json_group_array(child_id) FROM (
            SELECT json_extract(agent_parts.data, '$.childSessionId') AS child_id
            WHERE json_type(agent_parts.data, '$.childSessionId') = 'text'
            UNION
            SELECT json_extract(agent_parts.data, entry.path || '.value.stringValue') AS child_id
            FROM json_tree(agent_parts.data, '$.state.metadata.trace') AS entry
            WHERE json_extract(agent_parts.data, '$.tool') = 'workflow'
              AND entry.key = 'key' AND entry.value = 'openchart.session.id'
            ORDER BY child_id
          )
        )))
        WHERE json_extract(data, '$.type') = 'tool'
      `);
    });
  },
};

export default migration;
