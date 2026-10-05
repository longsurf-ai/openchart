// Purpose: Replaces plugin contribution identity with hook provenance in durable context.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect, Schema} from 'effect';

// Frozen predecessor shapes; migration replay never imports live Agent schemas.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeStoredObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const decodeParts = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeContext = Schema.decodeUnknownSync(
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    pluginId: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
    contributionId: Schema.String.check(Schema.isMinLength(1)),
    content: Schema.String.check(Schema.isMinLength(1)),
  }),
);

function convertPart(part: Schema.JsonObject): Schema.JsonObject {
  if (part.type !== 'context') return part;
  const context = decodeObject(part.context);
  if (context.kind !== 'plugin') return part;
  const previous = decodeContext(context);
  return {
    ...part,
    // run.before was the only lifecycle that produced persisted plugin context.
    context: {
      kind: 'plugin',
      pluginId: previous.pluginId,
      hook: 'run.before',
      content: previous.content,
    },
  };
}

function convertPrompt(value: unknown): Schema.JsonObject {
  const prompt = decodeObject(value);
  return {...prompt, parts: decodeParts(prompt.parts).map(convertPart)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260912204736_plugin-context-hook',
  /**
   * Records hook provenance while preserving Part identities, content, and order.
   * @example
   * yield* migration.up(transaction);
   */
  up(tx) {
    return Effect.gen(function* () {
      const parts = yield* tx.all<{id: string; data: string}>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') = 'context'
          AND json_extract(data, '$.context.kind') = 'plugin'
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
          WHERE json_extract(value, '$.type') = 'context'
            AND json_extract(value, '$.context.kind') = 'plugin'
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
          WHERE json_extract(value, '$.type') = 'context'
            AND json_extract(value, '$.context.kind') = 'plugin'
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
