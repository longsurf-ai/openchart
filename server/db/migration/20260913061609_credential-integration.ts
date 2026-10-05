// Purpose: Applies the 20260913061609_credential-integration forward-only SQLite migration.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect, Schema} from 'effect';

// Frozen predecessor shapes: migration history must not import live contracts.
const integrationID = Schema.decodeUnknownEffect(
  Schema.TemplateLiteralParser(['integration:', Schema.NonEmptyString]),
);
const decode = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({
        type: Schema.Literal('key'),
        key: Schema.String,
        metadata: Schema.optionalKey(
          Schema.Record(Schema.String, Schema.Unknown),
        ),
      }),
      Schema.Struct({
        type: Schema.Literal('oauth'),
        access: Schema.String,
        refresh: Schema.String,
        expires: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        metadata: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ]),
  ),
);
const decodeMethod = Schema.decodeUnknownEffect(Schema.String);

const migration: DatabaseMigration.Migration = {
  id: '20260913061609_credential-integration',
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
      yield* tx.run(
        'ALTER TABLE `credential` RENAME COLUMN `owner` TO `integration_id`;',
      );
      const rows = yield* tx.all<{
        id: string;
        integration_id: string;
        value: string;
      }>(sql`SELECT id, integration_id, value FROM credential
        WHERE integration_id IS NOT NULL AND integration_id <> ''`);
      for (const row of rows) {
        const [, id] = yield* integrationID(row.integration_id).pipe(
          Effect.mapError(
            () =>
              new Error(
                'Unsupported credential owner during integration migration',
              ),
          ),
        );
        const previous = yield* decode(row.value).pipe(
          Effect.mapError(
            () => new Error('Invalid credential during integration migration'),
          ),
        );
        let value = row.value;
        if (previous.type === 'oauth') {
          const {metadata, ...tokens} = previous;
          const {methodID: storedMethod, ...providerMetadata} = metadata;
          const methodID = yield* decodeMethod(storedMethod).pipe(
            Effect.mapError(
              () =>
                new Error('Invalid OAuth method during integration migration'),
            ),
          );
          value = JSON.stringify({
            ...tokens,
            methodID,
            ...(Object.keys(providerMetadata).length > 0
              ? {metadata: providerMetadata}
              : {}),
          });
        }
        yield* tx.run(sql`UPDATE credential
          SET integration_id = ${id}, value = ${value} WHERE id = ${row.id}`);
      }
    });
  },
};

export default migration;
