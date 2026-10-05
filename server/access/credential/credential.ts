// Purpose: Persists integration credentials with atomic replacement per integration.

export * as Credential from "./credential";

import { ascending } from "@openchart/identifier";
import { Integration } from "@openchart/server/access/integration";
import { Database } from "@openchart/server/db";
import { and, asc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema, SchemaGetter } from "effect";

import { StorageFailed } from "./errors";
import { CredentialTable } from "./schema";

export { StorageFailed } from "./errors";

const id = Schema.String.pipe(Schema.brand("Credential.ID"));

/**
 * Credential identity with an ascending cred_ constructor.
 * @example
 * const credentialID = Credential.ID.create();
 */
export const ID = Object.assign(id, {
  /**
   * Mints an ascending credential ID.
   * @example
   * const id = Credential.ID.create();
   */
  create: () => id.make(`cred_${ascending()}`),
});
export type ID = typeof ID.Type;

// Optional metadata omits undefined values on encode.
const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(
        Option.filter((value) => value !== undefined),
      ),
    }),
  );

/** Persisted OAuth tokens, their method, and epoch-millisecond expiry. */
export const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  methodID: Integration.MethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Provider-owned data, such as account details. */
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.OAuth" });
export type OAuth = typeof OAuth.Type;

/** Persisted API key and optional provider-owned metadata. */
export const Key = Schema.Struct({
  type: Schema.Literal("key"),
  /** Secret sent to the external system to authenticate requests. */
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.Key" });
export type Key = typeof Key.Type;

/** Canonical persisted credential union; reads decode this schema. */
export const Value = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Value" });
export type Value = typeof Value.Type;

/** Internal credential record, including its secret; never a client response. */
export class Info extends Schema.Class<Info>("Credential.Info")({
  /**
   * Identifies this local credential record, such as `cred_001`.
   * Replacing it through `create` assigns a new ID; `update` preserves this ID.
   */
  id: ID,
  /** External system this credential belongs to, such as openchart-cloud. */
  integrationID: Integration.IntegrationID,
  label: Schema.String,
  /** Persisted local enablement; inactive records retain their encrypted value. */
  active: Schema.Boolean,
  /** Secret material and caller metadata; restricted to the local backend. */
  value: Value,
}) {}

/**
 * Internal credential storage used by Integration, without remote I/O.
 * Storage failures fail with StorageFailed, never an absent credential.
 * Returned secrets stay in the local backend. Complete values, including
 * metadata, are encrypted by the host before persistence.
 * Integration owns authorization and renewal; providers own metadata schemas.
 */
export interface Interface {
  /**
   * Returns every bound credential; legacy rows without an integration are ignored.
   * @example
   * const all = yield* credentials.all();
   */
  readonly all: () => Effect.Effect<Info[], StorageFailed>;
  /**
   * Lists one integration's credentials in creation order; no matches returns [].
   * Optional active filtering happens in SQL before any secret is decrypted.
   * @example
   * const saved = yield* credentials.list(integrationID);
   */
  readonly list: (
    integrationID: Integration.IntegrationID,
    active?: boolean,
  ) => Effect.Effect<Info[], StorageFailed>;
  /**
   * Changes local enablement without reading or rewriting encrypted values.
   * Missing credentials are a no-op; remote validity is unaffected.
   * @example yield* credentials.setActive(integrationID, false);
   */
  readonly setActive: (
    integrationID: Integration.IntegrationID,
    active: boolean,
  ) => Effect.Effect<void, StorageFailed>;
  /**
   * Reads one credential; missing IDs and legacy unbound rows return undefined.
   * Invalid stored values fail with StorageFailed.
   * @example
   * const saved = yield* credentials.get(credentialID);
   */
  readonly get: (id: ID) => Effect.Effect<Info | undefined, StorageFailed>;
  /**
   * Atomically replaces all credentials for one integration with this credential.
   * A failed replacement preserves the previous credential. Other integrations are
   * untouched; the replacement receives a new ID and defaults its label to default.
   * @example
   * const saved = yield* credentials.create({
   *   integrationID,
   *   value: Credential.OAuth.make({type: 'oauth', methodID, access, refresh, expires}),
   * });
   */
  readonly create: (input: {
    readonly integrationID: Integration.IntegrationID;
    readonly value: Value;
    readonly label?: string;
  }) => Effect.Effect<Info, StorageFailed>;
  /**
   * Updates the label or complete secret value; missing IDs are unchanged.
   * The ID and integration stay the same; a failed write preserves the old value.
   * An empty update or an empty label alone is a no-op.
   * @example
   * yield* credentials.update(credentialID, {label: 'Work'});
   */
  readonly update: (
    id: ID,
    updates: Partial<Pick<Info, "label" | "value">>,
  ) => Effect.Effect<void, StorageFailed>;
  /**
   * Clears an integration's currently stored credentials without reading secrets.
   * Missing credentials are a no-op; other integrations remain untouched.
   * Remote access is not revoked. Storage failures must not report success.
   * @example
   * yield* credentials.clear(integrationID);
   */
  readonly clear: (
    integrationID: Integration.IntegrationID,
  ) => Effect.Effect<void, StorageFailed>;
}

/**
 * Internal credential storage capability shared by the application runtime.
 * @example
 * const credentials = yield* Credential.Service;
 * const saved = yield* credentials.list(integrationID);
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Credential",
) {}

/** Host-owned protection of opaque values; never fall back to plaintext. */
export interface Encryption {
  /** Encrypts a complete serialized value; rejects when protection is unavailable.
   * @example const ciphertext = await encryption.encrypt(serialized);
   */
  readonly encrypt: (plaintext: string) => Promise<string>;
  /** Decrypts ciphertext; rejects corrupt values and unavailable keys.
   * @example const serialized = await encryption.decrypt(ciphertext);
   */
  readonly decrypt: (ciphertext: string) => Promise<string>;
}

const unavailable = async (): Promise<never> => {
  throw new StorageFailed({});
};

/**
 * Supplies encrypted persistence using the existing Database and host encryption.
 * Missing encryption permits startup and removal, but secret reads/writes fail.
 * SQL, codec, and encryption failures return StorageFailed without raw causes.
 * @example
 * const layer = Credential.layer(encryption).pipe(Layer.provide(database));
 */
export const layer = (
  encryption: Encryption = { encrypt: unavailable, decrypt: unavailable },
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      const serialized = Schema.fromJsonString(Value);
      const decode = Schema.decodeUnknownEffect(serialized);
      const encode = Schema.encodeEffect(serialized);
      const storageError = Effect.mapError(() => new StorageFailed({}));
      const encrypt = Effect.fn("Credential.encrypt")(function* (value: Value) {
        const plaintext = yield* encode(value);
        return yield* Effect.tryPromise(() => encryption.encrypt(plaintext));
      }, storageError);
      const decrypt = Effect.fn("Credential.decrypt")(function* (
        value: string,
      ) {
        const plaintext = yield* Effect.tryPromise(() =>
          encryption.decrypt(value),
        );
        return yield* decode(plaintext);
      }, storageError);
      const stored = Effect.fn("Credential.decode")(function* (
        row: typeof CredentialTable.$inferSelect,
      ) {
        if (!row.integration_id) return;
        return new Info({
          id: row.id,
          integrationID: row.integration_id,
          label: row.label,
          active: row.active,
          value: yield* decrypt(row.value),
        });
      });

      return Service.of({
        all: Effect.fn("Credential.all")(function* () {
          const rows = yield* db
            .select()
            .from(CredentialTable)
            .orderBy(asc(CredentialTable.time_created))
            .all()
            .pipe(storageError);
          const values = yield* Effect.forEach(rows, stored).pipe(storageError);
          return values.filter((value): value is Info => value !== undefined);
        }),
        list: Effect.fn("Credential.list")(function* (integrationID, active) {
          const rows = yield* db
            .select()
            .from(CredentialTable)
            .where(
              and(
                eq(CredentialTable.integration_id, integrationID),
                active === undefined
                  ? undefined
                  : eq(CredentialTable.active, active),
              ),
            )
            .orderBy(asc(CredentialTable.time_created))
            .all()
            .pipe(storageError);
          const values = yield* Effect.forEach(rows, stored).pipe(storageError);
          return values.filter((value): value is Info => value !== undefined);
        }),
        setActive: Effect.fn("Credential.setActive")(
          function* (integrationID, active) {
            yield* db
              .update(CredentialTable)
              .set({ active })
              .where(eq(CredentialTable.integration_id, integrationID))
              .run()
              .pipe(storageError);
          },
        ),
        get: Effect.fn("Credential.get")(function* (id) {
          const row = yield* db
            .select()
            .from(CredentialTable)
            .where(eq(CredentialTable.id, id))
            .get()
            .pipe(storageError);
          return row ? yield* stored(row).pipe(storageError) : undefined;
        }),
        create: Effect.fn("Credential.create")(function* (input) {
          const credential = new Info({
            id: ID.create(),
            integrationID: input.integrationID,
            label: input.label ?? "default",
            active: true,
            value: input.value,
          });
          const value = yield* encrypt(credential.value);
          yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx
                  .delete(CredentialTable)
                  .where(
                    eq(
                      CredentialTable.integration_id,
                      credential.integrationID,
                    ),
                  )
                  .run();
                yield* tx
                  .insert(CredentialTable)
                  .values({
                    id: credential.id,
                    integration_id: credential.integrationID,
                    label: credential.label,
                    active: credential.active,
                    value,
                  })
                  .run();
              }),
            )
            .pipe(storageError);
          return credential;
        }),
        update: Effect.fn("Credential.update")(function* (id, updates) {
          if (!updates.label && !updates.value) return;
          const value =
            updates.value === undefined
              ? undefined
              : yield* encrypt(updates.value);
          yield* db
            .update(CredentialTable)
            .set({ label: updates.label, value })
            .where(eq(CredentialTable.id, id))
            .run()
            .pipe(storageError);
        }),
        clear: Effect.fn("Credential.clear")(function* (integrationID) {
          yield* db
            .delete(CredentialTable)
            .where(eq(CredentialTable.integration_id, integrationID))
            .run()
            .pipe(storageError);
        }),
      });
    }),
  );
