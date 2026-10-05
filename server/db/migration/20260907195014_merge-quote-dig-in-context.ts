// Purpose: Moves standalone quote and dig-in Parts into distinct ContextPart kinds.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect, Schema, Struct} from 'effect';

// Frozen historical shapes; migrations never import evolving Agent contracts.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeStoredObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const decodeParts = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeQuote = Schema.decodeUnknownSync(
  Schema.Struct({
    text: Schema.String,
    source: Schema.optional(
      Schema.Struct({
        sessionId: Schema.optional(Schema.String),
        messageId: Schema.optional(Schema.String),
        partId: Schema.String,
        startOffset: Schema.Finite.check(Schema.isInt()),
        endOffset: Schema.Finite.check(Schema.isInt()),
      }),
    ),
  }),
);
const decodeDigIn = Schema.decodeUnknownSync(
  Schema.Struct({quoteText: Schema.String}),
);

function convertPart(part: Schema.JsonObject): Schema.JsonObject {
  if (part.type === 'quote') {
    const content = decodeQuote(part);
    return {
      ...Struct.omit(part, ['text', 'source']),
      type: 'context',
      context: {kind: 'quote', ...content},
    };
  }
  if (part.type === 'dig_in_context') {
    const content = decodeDigIn(part);
    return {
      ...Struct.omit(part, ['quoteText']),
      type: 'context',
      context: {kind: 'dig_in', ...content},
    };
  }
  return part;
}

function convertPrompt(value: unknown): Schema.JsonObject {
  const prompt = decodeObject(value);
  return {...prompt, parts: decodeParts(prompt.parts).map(convertPart)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260907195014_merge-quote-dig-in-context',
  /**
   * Converts transcript and prompt payloads without changing row metadata.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      const parts = yield* tx.all<{id: string; data: string}>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') IN ('quote', 'dig_in_context')
      `);
      for (const part of parts) {
        const data = convertPart(decodeStoredObject(part.data));
        yield* tx.run(sql`
          UPDATE agent_parts SET data = ${JSON.stringify(data)} WHERE id = ${part.id}
        `);
      }
      const runs = yield* tx.all<{id: string; input: string}>(sql`
        SELECT id, input FROM agent_run
        WHERE EXISTS (
          SELECT 1 FROM json_each(input, '$.parts')
          WHERE json_extract(value, '$.type') IN ('quote', 'dig_in_context')
        )
      `);
      for (const run of runs) {
        const input = convertPrompt(decodeStoredObject(run.input));
        yield* tx.run(sql`
          UPDATE agent_run SET input = ${JSON.stringify(input)} WHERE id = ${run.id}
        `);
      }
      const schedules = yield* tx.all<{id: string; target_json: string}>(sql`
        SELECT id, target_json FROM agent_schedule
        WHERE EXISTS (
          SELECT 1 FROM json_each(target_json, '$.prompt.parts')
          WHERE json_extract(value, '$.type') IN ('quote', 'dig_in_context')
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
