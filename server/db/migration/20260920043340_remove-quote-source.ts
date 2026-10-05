// Purpose: Removes unused quote source metadata from transcripts and saved prompts.

import type { DatabaseMigration } from "@openchart/server/db/migration";
import { Effect } from "effect";

const migration: DatabaseMigration.Migration = {
  id: "20260920043340_remove-quote-source",
  /**
   * Drops only quote sources, preserving text, Part order, identities and row metadata.
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE agent_parts
        SET data = json_remove(data, '$.context.source')
        WHERE json_extract(data, '$.type') = 'context'
          AND json_extract(data, '$.context.kind') = 'quote'
          AND json_type(data, '$.context.source') IS NOT NULL
      `);
      yield* tx.run(`
        UPDATE agent_run
        SET input = json_set(input, '$.parts', (
          SELECT json_group_array(json(CASE
            WHEN json_extract(value, '$.type') = 'context'
              AND json_extract(value, '$.context.kind') = 'quote'
            THEN json_remove(value, '$.context.source')
            ELSE value
          END))
          FROM json_each(agent_run.input, '$.parts')
        ))
        WHERE EXISTS (
          SELECT 1 FROM json_each(agent_run.input, '$.parts')
          WHERE json_extract(value, '$.type') = 'context'
            AND json_extract(value, '$.context.kind') = 'quote'
            AND json_type(value, '$.context.source') IS NOT NULL
        )
      `);
      yield* tx.run(`
        UPDATE agent_schedule
        SET target_json = json_set(target_json, '$.prompt.parts', (
          SELECT json_group_array(json(CASE
            WHEN json_extract(value, '$.type') = 'context'
              AND json_extract(value, '$.context.kind') = 'quote'
            THEN json_remove(value, '$.context.source')
            ELSE value
          END))
          FROM json_each(agent_schedule.target_json, '$.prompt.parts')
        ))
        WHERE EXISTS (
          SELECT 1 FROM json_each(agent_schedule.target_json, '$.prompt.parts')
          WHERE json_extract(value, '$.type') = 'context'
            AND json_extract(value, '$.context.kind') = 'quote'
            AND json_type(value, '$.context.source') IS NOT NULL
        )
      `);
    });
  },
};

export default migration;
