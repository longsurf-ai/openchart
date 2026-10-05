// Purpose: Converts stored context Parts and prompt snapshots to one context payload.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect} from 'effect';
import {z} from 'zod';

// These historical shapes are frozen here; migrations never import live contracts.
const JsonObject = z.record(z.string(), z.json());
const StoredObject = z.codec(z.string(), JsonObject, {
  decode: value => JSON.parse(value),
  encode: value => JSON.stringify(value),
});
type JsonObject = z.infer<typeof JsonObject>;

const LegacyContext = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resource_reference'),
    scope: z.enum(['current', 'attached']),
    pointer: z.object({
      schema: z.literal('openchart.resource-pointer.v1'),
      type: z.string(),
      path: z.string(),
      snapshot: z.object({label: z.string()}),
    }),
  }),
  z.object({
    kind: z.literal('document'),
    label: z.string(),
    content: z.string(),
    evidence: z.array(z.json()).min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal('session_reference'),
    sessionId: z.string().startsWith('ses'),
    throughCreatedAt: z.string().datetime(),
  }),
]);

const resourcePaths: Record<string, RegExp> = {
  agent_schedule: /^\/agent_schedules\/([^/]+)\/?$/,
  news_feed_column: /^\/news_feed_columns\/([^/]+)\/?$/,
  dashboard: /^\/dashboards\/([^/]+)\/?$/,
  chart: /^\/dashboards\/[^/]+\/charts\/([^/]+)\/?$/,
  indicator_definition: /^\/indicator_definitions\/([^/]+)\/?$/,
  item: /^\/items\/([^/]+)\/?$/,
  document: /^\/documents\/([^/]+)\/?$/,
  listing_scope: /^\/dashboards\/([^/]+)\/listings\/([^/]+)\/?$/,
  basket: /^\/baskets\/([^/]+)\/?$/,
  watchlist: /^\/watchlists\/([^/]+)\/?$/,
  alert_rule: /^\/alert_rules\/([^/]+)\/?$/,
  annotation: /^\/dashboards\/[^/]+\/listings\/[^/]+\/annotations\/([^/]+)\/?$/,
  drawing: /^\/dashboards\/[^/]+\/listings\/[^/]+\/drawings\/([^/]+)\/?$/,
};

function convertContext(value: unknown): JsonObject {
  const model = LegacyContext.parse(value);
  if (model.kind === 'session_reference') {
    return {
      kind: 'session',
      sessionId: model.sessionId,
      throughCreatedAt: model.throughCreatedAt,
    };
  }
  if (model.kind === 'document') {
    return {
      kind: 'document',
      title: model.label,
      text: model.content,
      ...(model.evidence ? {evidence: model.evidence} : {}),
    };
  }
  const pathname = new URL(model.pointer.path, 'https://openchart.local')
    .pathname;
  const match = resourcePaths[model.pointer.type]?.exec(pathname);
  if (!match?.[1] || match[1] === '_') {
    throw new Error(`Invalid stored resource pointer: ${model.pointer.path}`);
  }
  const id = decodeURIComponent(match[1]);
  if (model.pointer.type === 'listing_scope') {
    // V2 has no virtual Resource for this dashboard/listing pair. Preserve both
    // identities as historical context instead of inventing a Resource ID.
    const listingId = z.string().min(1).parse(match[2]);
    return {
      kind: 'document',
      title: model.pointer.snapshot.label,
      text: `${model.scope === 'current' ? 'Current' : 'Attached'} listing context:\nDashboard ID: ${id}\nListing ID: ${decodeURIComponent(listingId)}`,
    };
  }
  return {
    kind: 'resource',
    resource: model.pointer.type,
    id,
    scope: model.scope,
  };
}

function convertPart(value: unknown): JsonObject {
  const part = JsonObject.parse(value);
  if (part.type !== 'context') return part;
  const converted: JsonObject = {...part, context: convertContext(part.model)};
  delete converted.model;
  delete converted.display;
  return converted;
}

function convertPrompt(value: unknown): JsonObject {
  const prompt = JsonObject.parse(value);
  const parts = z.array(JsonObject).parse(prompt.parts);
  return {...prompt, parts: parts.map(convertPart)};
}

const migration: DatabaseMigration.Migration = {
  id: '20260907190920_simplify-context-parts',
  /**
   * Converts transcript, queued-run, and scheduled contexts in the owned transaction.
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
        WHERE json_extract(data, '$.type') = 'context'
      `);
      for (const part of parts) {
        const data = convertPart(StoredObject.parse(part.data));
        yield* tx.run(sql`
          UPDATE agent_parts SET data = ${JSON.stringify(data)} WHERE id = ${part.id}
        `);
      }
      const runs = yield* tx.all<{id: string; input: string}>(sql`
        SELECT id, input FROM agent_run
        WHERE EXISTS (
          SELECT 1 FROM json_each(input, '$.parts')
          WHERE json_extract(value, '$.type') = 'context'
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
          WHERE json_extract(value, '$.type') = 'context'
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
