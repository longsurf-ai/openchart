// Purpose: Applies the 20260913041915_credential-owner forward-only SQLite migration.

import type {DatabaseMigration} from '@openchart/server/db/migration';
import {sql} from 'drizzle-orm';
import {Effect, Schema} from 'effect';

// Frozen predecessor shape: applied migrations must not import live contracts.
const metadata = Schema.optionalKey(
  Schema.Record(Schema.String, Schema.Unknown),
);
const decode = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({
        type: Schema.Literal('key'),
        key: Schema.String,
        metadata,
      }),
      Schema.Struct({
        type: Schema.Literal('oauth'),
        methodID: Schema.String,
        access: Schema.String,
        refresh: Schema.String,
        expires: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        metadata,
      }),
    ]),
  ),
);

const migration: DatabaseMigration.Migration = {
  id: '20260913041915_credential-owner',
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
        'ALTER TABLE `credential` RENAME COLUMN `integration_id` TO `owner`;',
      );
      const rows = yield* tx.all<{id: string; value: string}>(sql`
        SELECT id, value FROM credential WHERE owner IS NOT NULL AND owner <> ''
      `);
      for (const row of rows) {
        const previous = yield* decode(row.value).pipe(
          Effect.mapError(
            () => new Error('Invalid credential during owner migration'),
          ),
        );
        let value;
        if (previous.type === 'oauth') {
          const {methodID, ...tokens} = previous;
          value = {...tokens, metadata: {...tokens.metadata, methodID}};
        } else {
          value = previous;
        }
        yield* tx.run(sql`
          UPDATE credential SET owner = 'integration:' || owner,
            value = ${JSON.stringify(value)}
          WHERE id = ${row.id}
        `);
      }
    });
  },
};

export default migration;
