// Purpose: Derives Part Session ownership from Messages and removes redundant embedded ownership.

import {Effect, Schema, Struct} from 'effect';
import {sql} from 'drizzle-orm';
import type {DatabaseMigration} from '@openchart/server/db/migration';

// Frozen JSON boundaries; migrations never import evolving Agent contracts.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeStoredObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const decodeParts = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));

function removePartSession(part: Schema.JsonObject): Schema.JsonObject {
  const content = Struct.omit(part, ['sessionID']);
  if (part.type !== 'tool') return content;
  const state = decodeObject(part.state);
  if (state.attachments === undefined) return content;
  return {
    ...content,
    state: {
      ...state,
      attachments: decodeParts(state.attachments).map(attachment =>
        Struct.omit(attachment, ['sessionID']),
      ),
    },
  };
}

function removePromptSessions(value: unknown): Schema.JsonObject {
  const prompt = decodeObject(value);
  return {...prompt, parts: decodeParts(prompt.parts).map(removePartSession)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260907222714_remove-part-session',
  /**
   * Applies this migration inside the runner-owned transaction.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run('DROP INDEX IF EXISTS `idx_agent_parts_session`;');
      yield* tx.run('ALTER TABLE `agent_parts` DROP COLUMN `session_id`;');

      // Only ownership fields on known Parts are removed. Context references,
      // child Session links, and arbitrary tool input/output/metadata are facts.
      const parts = yield* tx.all<{id: string; data: string}>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') = 'tool' AND EXISTS (
          SELECT 1 FROM json_each(data, '$.state.attachments')
          WHERE json_type(value, '$.sessionID') IS NOT NULL
        )
      `);
      for (const part of parts) {
        const data = removePartSession(decodeStoredObject(part.data));
        yield* tx.run(sql`
          UPDATE agent_parts SET data = ${JSON.stringify(data)} WHERE id = ${part.id}
        `);
      }
      const runs = yield* tx.all<{id: string; input: string}>(sql`
        SELECT id, input FROM agent_run WHERE EXISTS (
          SELECT 1 FROM json_each(input, '$.parts')
          WHERE json_type(value, '$.sessionID') IS NOT NULL
        )
      `);
      for (const run of runs) {
        const input = removePromptSessions(decodeStoredObject(run.input));
        yield* tx.run(sql`
          UPDATE agent_run SET input = ${JSON.stringify(input)} WHERE id = ${run.id}
        `);
      }
      const schedules = yield* tx.all<{id: string; target_json: string}>(sql`
        SELECT id, target_json FROM agent_schedule WHERE EXISTS (
          SELECT 1 FROM json_each(target_json, '$.prompt.parts')
          WHERE json_type(value, '$.sessionID') IS NOT NULL
        )
      `);
      for (const schedule of schedules) {
        const target = decodeStoredObject(schedule.target_json);
        const converted = {
          ...target,
          prompt: removePromptSessions(target.prompt),
        };
        yield* tx.run(sql`
          UPDATE agent_schedule SET target_json = ${JSON.stringify(converted)}
          WHERE id = ${schedule.id}
        `);
      }
    });
  },
};

export default migration;
