// Purpose: Retires legacy text visibility flags without exposing hidden or ignored content.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect, Schema, Struct} from 'effect';

// Frozen JSON boundaries; migrations never import evolving Agent contracts.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeStoredObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const decodeParts = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));

function convertPart(part: Schema.JsonObject): Schema.JsonObject {
  if (part.type !== 'text') return part;
  const metadata =
    part.metadata === undefined ? undefined : decodeObject(part.metadata);
  if (part.ignored === undefined && metadata?.hiddenContext === undefined)
    return part;

  // Keep identities and nonempty prompt arrays, but never replay ignored content.
  // Hidden model context retains its text under the existing synthetic policy.
  return {
    ...Struct.omit(part, ['ignored']),
    ...(part.ignored === true ? {text: ''} : {}),
    ...(part.ignored === true || metadata?.hiddenContext === true
      ? {synthetic: true}
      : {}),
    ...(metadata === undefined
      ? {}
      : {metadata: Struct.omit(metadata, ['hiddenContext'])}),
  };
}

function convertPrompt(value: unknown): Schema.JsonObject {
  const prompt = decodeObject(value);
  return {...prompt, parts: decodeParts(prompt.parts).map(convertPart)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260910182114_remove-text-visibility-flags',
  /**
   * Converts transcript text and Run/Schedule prompts without changing row metadata.
   * @example
   * yield* migration.up(transaction);
   */
  up(tx) {
    return Effect.gen(function* () {
      const parts = yield* tx.all<{id: string; data: string}>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') = 'text' AND (
          json_type(data, '$.ignored') IS NOT NULL
          OR json_type(data, '$.metadata.hiddenContext') IS NOT NULL
        )
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
          WHERE json_extract(value, '$.type') = 'text' AND (
            json_type(value, '$.ignored') IS NOT NULL
            OR json_type(value, '$.metadata.hiddenContext') IS NOT NULL
          )
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
          WHERE json_extract(value, '$.type') = 'text' AND (
            json_type(value, '$.ignored') IS NOT NULL
            OR json_type(value, '$.metadata.hiddenContext') IS NOT NULL
          )
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
