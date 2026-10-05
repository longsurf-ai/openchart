// Purpose: Removes transcript origins while preserving history, attachments, and prompt snapshots.

import {Effect, Schema, Struct} from 'effect';
import {sql} from 'drizzle-orm';
import type {DatabaseMigration} from '@openchart/server/db/migration';

// Frozen JSON boundaries; migrations never import evolving Agent contracts.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeStoredObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const decodeParts = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));

function removePartOrigin(part: Schema.JsonObject): Schema.JsonObject {
  const content = Struct.omit(part, ['origin']);
  if (part.type !== 'tool') return content;
  const state = decodeObject(part.state);
  if (state.attachments === undefined) return content;
  return {
    ...content,
    state: {
      ...state,
      attachments: decodeParts(state.attachments).map(attachment =>
        Struct.omit(attachment, ['origin']),
      ),
    },
  };
}

function removePromptOrigins(value: unknown): Schema.JsonObject {
  const prompt = decodeObject(value);
  return {...prompt, parts: decodeParts(prompt.parts).map(removePartOrigin)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260907210622_remove-message-origin',
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
      // @agent invariant: Preserve Parts before rebuilding their parent table.
      // Foreign keys stay enabled; dropping Messages would cascade into Parts.
      yield* tx.run(`
        CREATE TEMP TABLE origin_parts_backup AS
        SELECT id, message_id, session_id, data, created_at, updated_at
        FROM agent_parts;
      `);
      yield* tx.run('DROP TABLE `agent_parts`;');
      yield* tx.run(`
        CREATE TABLE \`__new_agent_messages\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`role\` text NOT NULL,
          \`data\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_messages_session_id_agent_sessions_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`agent_sessions\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_messages_role" CHECK("role" IN ('user', 'assistant')),
          CONSTRAINT "chk_agent_messages_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
              AND json_type("data", '$.role') IS NULL
            )
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_agent_messages`(`id`, `session_id`, `role`, `data`, `created_at`, `updated_at`) SELECT `id`, `session_id`, `role`, `data`, `created_at`, `updated_at` FROM `agent_messages`;',
      );
      yield* tx.run('DROP TABLE `agent_messages`;');
      yield* tx.run(
        'ALTER TABLE `__new_agent_messages` RENAME TO `agent_messages`;',
      );
      yield* tx.run(`
        CREATE TABLE \`__new_agent_parts\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          CONSTRAINT \`fk_agent_parts_message_id_agent_messages_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`agent_messages\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chk_agent_parts_data_columns" CHECK(
              json_valid("data") AND json_type("data") = 'object'
              AND json_type("data", '$.id') IS NULL
              AND json_type("data", '$.messageID') IS NULL
              AND json_type("data", '$.sessionID') IS NULL
            )
        );
      `);
      yield* tx.run(
        'INSERT INTO `__new_agent_parts`(`id`, `message_id`, `session_id`, `data`, `created_at`, `updated_at`) SELECT `id`, `message_id`, `session_id`, `data`, `created_at`, `updated_at` FROM `origin_parts_backup`;',
      );
      yield* tx.run('ALTER TABLE `__new_agent_parts` RENAME TO `agent_parts`;');
      yield* tx.run('DROP TABLE `origin_parts_backup`;');
      yield* tx.run(
        'CREATE INDEX `idx_agent_messages_session_created` ON `agent_messages` (`session_id`,`created_at`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_messages_session_canonical_id` ON `agent_messages` (`session_id`,`id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_parts_message` ON `agent_parts` (`message_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `idx_agent_parts_session` ON `agent_parts` (`session_id`);',
      );

      const parts = yield* tx.all<{id: string; data: string}>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') = 'tool' AND EXISTS (
          SELECT 1 FROM json_each(data, '$.state.attachments')
          WHERE json_type(value, '$.origin') IS NOT NULL
        )
      `);
      for (const part of parts) {
        const data = removePartOrigin(decodeStoredObject(part.data));
        yield* tx.run(sql`
          UPDATE agent_parts SET data = ${JSON.stringify(data)} WHERE id = ${part.id}
        `);
      }
      const runs = yield* tx.all<{id: string; input: string}>(sql`
        SELECT id, input FROM agent_run WHERE EXISTS (
          SELECT 1 FROM json_each(input, '$.parts')
          WHERE json_type(value, '$.origin') IS NOT NULL
        )
      `);
      for (const run of runs) {
        const input = removePromptOrigins(decodeStoredObject(run.input));
        yield* tx.run(sql`
          UPDATE agent_run SET input = ${JSON.stringify(input)} WHERE id = ${run.id}
        `);
      }
      const schedules = yield* tx.all<{id: string; target_json: string}>(sql`
        SELECT id, target_json FROM agent_schedule WHERE EXISTS (
          SELECT 1 FROM json_each(target_json, '$.prompt.parts')
          WHERE json_type(value, '$.origin') IS NOT NULL
        )
      `);
      for (const schedule of schedules) {
        const target = decodeStoredObject(schedule.target_json);
        const converted = {
          ...target,
          prompt: removePromptOrigins(target.prompt),
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
