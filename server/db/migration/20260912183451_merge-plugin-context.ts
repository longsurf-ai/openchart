// Purpose: Moves plugin context into ContextPart in transcripts and prompt snapshots.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect, Schema, Struct} from 'effect';

// Frozen historical boundaries; migrations never import evolving Agent contracts.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeStoredObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const decodeParts = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeContext = Schema.decodeUnknownSync(
  Schema.Struct({
    pluginId: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
    contributionId: Schema.String.check(Schema.isMinLength(1)),
    content: Schema.String.check(Schema.isMinLength(1)),
  }),
);

function convertPart(part: Schema.JsonObject): Schema.JsonObject {
  if (part.type !== 'plugin_context') return part;
  return {
    ...Struct.omit(part, ['pluginId', 'contributionId', 'content']),
    type: 'context',
    context: {kind: 'plugin', ...decodeContext(part)},
  };
}

function convertPrompt(value: unknown): Schema.JsonObject {
  const prompt = decodeObject(value);
  return {...prompt, parts: decodeParts(prompt.parts).map(convertPart)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260912183451_merge-plugin-context',
  /**
   * Converts plugin context while preserving identities, order, and row metadata.
   * @example
   * yield* migration.up(transaction);
   */
  up(tx) {
    return Effect.gen(function* () {
      const parts = yield* tx.all<{id: string; data: string}>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') = 'plugin_context'
      `);
      for (const part of parts) {
        const data = convertPart(decodeStoredObject(part.data));
        yield* tx.run(sql`
          UPDATE agent_parts SET data = ${JSON.stringify(data)} WHERE id = ${part.id}
        `);
      }
      const runs = yield* tx.all<{id: string; input: string}>(sql`
        SELECT id, input FROM agent_run WHERE EXISTS (
          SELECT 1 FROM json_each(input, '$.parts')
          WHERE json_extract(value, '$.type') = 'plugin_context'
        )
      `);
      for (const run of runs) {
        const input = convertPrompt(decodeStoredObject(run.input));
        yield* tx.run(sql`
          UPDATE agent_run SET input = ${JSON.stringify(input)} WHERE id = ${run.id}
        `);
      }
      const schedules = yield* tx.all<{id: string; target_json: string}>(sql`
        SELECT id, target_json FROM agent_schedule WHERE EXISTS (
          SELECT 1 FROM json_each(target_json, '$.prompt.parts')
          WHERE json_extract(value, '$.type') = 'plugin_context'
        )
      `);
      for (const schedule of schedules) {
        const target = decodeStoredObject(schedule.target_json);
        const converted = {...target, prompt: convertPrompt(target.prompt)};
        yield* tx.run(sql`
          UPDATE agent_schedule SET target_json = ${JSON.stringify(converted)}
          WHERE id = ${schedule.id}
        `);
      }
    });
  },
};

export default migration;
