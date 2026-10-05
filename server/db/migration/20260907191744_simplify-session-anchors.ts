// Purpose: Converts anchored sessions and persisted prompt context to dig-in-only contracts.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect} from 'effect';
import {z} from 'zod';

// Frozen migration shapes: never import evolving application contracts here.
// Object parsing drops obsolete context/kind; missing identity or location fails
// instead of inventing an intent or guessing source offsets from rendered text.
const Anchors = z.array(
  z
    .object({
      partId: z.string().min(1),
      text: z.string().refine(value => value.trim().length > 0),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      childSessionId: z.string().min(1),
      sessionIntentId: z.string().min(1),
    })
    .refine(anchor => anchor.endOffset > anchor.startOffset),
);
const StoredAnchors = z.codec(z.string(), Anchors, {
  decode: value => JSON.parse(value),
  encode: value => JSON.stringify(value),
});
const JsonObject = z.record(z.string(), z.json());
type JsonObject = z.infer<typeof JsonObject>;
const StoredObject = z.codec(z.string(), JsonObject, {
  decode: value => JSON.parse(value),
  encode: value => JSON.stringify(value),
});

function convertPrompt(value: unknown): JsonObject {
  const prompt = JsonObject.parse(value);
  const parts = z.array(JsonObject).parse(prompt.parts);
  return {
    ...prompt,
    parts: parts.map(part => {
      if (part.type !== 'dig_in_context') return part;
      const converted = {...part};
      delete converted.kind;
      return converted;
    }),
  };
}

const migration: DatabaseMigration.Migration = {
  id: '20260907191744_simplify-session-anchors',
  /**
   * Converts anchors and prompt contexts atomically, preserving their identities.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      const sessions = yield* tx.all<{id: string; anchors: string}>(sql`
        SELECT id, anchors FROM agent_sessions WHERE anchors IS NOT NULL
      `);
      for (const session of sessions) {
        const anchors = StoredAnchors.parse(session.anchors);
        yield* tx.run(sql`
          UPDATE agent_sessions SET anchors = ${JSON.stringify(anchors)}
          WHERE id = ${session.id}
        `);
      }
      yield* tx.run(sql`
        UPDATE agent_sessions SET kind = 'dig_in' WHERE kind = 'claim'
      `);
      yield* tx.run(`
        UPDATE agent_parts SET data = json_remove(data, '$.kind')
        WHERE json_extract(data, '$.type') = 'dig_in_context'
      `);
      const runs = yield* tx.all<{id: string; input: string}>(sql`
        SELECT id, input FROM agent_run
        WHERE EXISTS (
          SELECT 1 FROM json_each(input, '$.parts')
          WHERE json_extract(value, '$.type') = 'dig_in_context'
        )
      `);
      for (const run of runs) {
        const input = convertPrompt(StoredObject.parse(run.input));
        yield* tx.run(sql`
          UPDATE agent_run SET input = ${JSON.stringify(input)} WHERE id = ${run.id}
        `);
      }
      const schedules = yield* tx.all<{id: string; target_json: string}>(sql`
        SELECT id, target_json FROM agent_schedule
        WHERE EXISTS (
          SELECT 1 FROM json_each(target_json, '$.prompt.parts')
          WHERE json_extract(value, '$.type') = 'dig_in_context'
        )
      `);
      for (const schedule of schedules) {
        const target = StoredObject.parse(schedule.target_json);
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
