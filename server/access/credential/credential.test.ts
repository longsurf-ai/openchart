// Purpose: Locks the Credential API, durable values, and atomic replacement behavior.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Integration } from "@openchart/server/access/integration";
import { Database } from "@openchart/server/db";
import { makeRuntime } from "@openchart/server/runtime";
import { sql } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { expect, test } from "vitest";

import { Credential } from "./credential";
import { jweEncryption } from "./encryption";

const integrationID = Integration.IntegrationID.make("openchart-cloud");
const otherIntegrationID = Integration.IntegrationID.make("marketfeed");
const methodID = Integration.MethodID.make("browser");
const encryption = jweEncryption(randomBytes(32));

function testLayer(filename = ":memory:", protection = encryption) {
  return Credential.layer(protection).pipe(
    Layer.provideMerge(Database.layer(filename, () => Effect.void)),
  );
}

test("active filtering excludes unreadable inactive secrets and enablement preserves other integrations", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const { db } = yield* Database.Service;
      const saved = yield* credentials.create({
        integrationID,
        value: { type: "key", key: "secret" },
      });
      const other = yield* credentials.create({
        integrationID: otherIntegrationID,
        value: { type: "key", key: "other" },
      });
      expect(saved.active).toBe(true);
      yield* credentials.setActive(integrationID, false);
      expect(yield* credentials.list(integrationID, true)).toEqual([]);
      expect(yield* credentials.list(integrationID, false)).toEqual([
        { ...saved, active: false },
      ]);
      expect(yield* credentials.get(other.id)).toEqual(other);
      yield* db.run(
        sql`UPDATE credential SET value = 'unreadable ciphertext' WHERE id = ${saved.id}`,
      );
      yield* credentials.setActive(integrationID, false);
      expect(yield* credentials.list(integrationID, true)).toEqual([]);
      expect(
        yield* credentials.list(integrationID).pipe(Effect.flip),
      ).toBeInstanceOf(Credential.StorageFailed);
      yield* credentials.setActive(integrationID, true);
      expect(
        yield* credentials.list(integrationID, true).pipe(Effect.flip),
      ).toBeInstanceOf(Credential.StorageFailed);
      expect(yield* credentials.get(other.id)).toEqual(other);
    }).pipe(Effect.provide(testLayer())),
  ));

test("stores, updates, lists, replaces, and removes credentials", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      });
      const other = yield* credentials.create({
        integrationID: otherIntegrationID,
        value: Credential.Key.make({ type: "key", key: "other-secret" }),
      });
      expect(created.id).toMatch(/^cred_/);
      expect(other.label).toBe("default");
      expect(yield* credentials.get(created.id)).toEqual(created);
      expect(yield* credentials.all()).toEqual([created, other]);
      expect(yield* credentials.list(integrationID)).toEqual([created]);

      yield* credentials.update(created.id, { label: "Personal" });
      expect((yield* credentials.get(created.id))?.label).toBe("Personal");
      const replacement = yield* credentials.create({
        integrationID,
        label: "Replacement",
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      });
      expect(replacement.id).not.toBe(created.id);
      expect(yield* credentials.get(created.id)).toBeUndefined();
      expect(yield* credentials.list(integrationID)).toEqual([replacement]);
      expect(yield* credentials.get(other.id)).toEqual(other);
      yield* credentials.clear(integrationID);
      yield* credentials.clear(integrationID);
      expect(yield* credentials.list(integrationID)).toEqual([]);
      expect(yield* credentials.all()).toEqual([other]);
    }).pipe(Effect.provide(testLayer())),
  );
});

test("round-trips OAuth tokens and metadata across runtime restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openchart-credential-"));
  const filename = join(directory, "test.sqlite3");
  const first = ManagedRuntime.make(testLayer(filename));
  let saved: Credential.Info;
  const value = Credential.OAuth.make({
    type: "oauth",
    methodID,
    refresh: "refresh-token",
    access: "access-token",
    expires: 1_900_000_000_000,
    metadata: { organization: "work", nested: { enabled: true } },
  });
  try {
    saved = await first.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service;
        return yield* credentials.create({ integrationID, value });
      }),
    );
  } finally {
    await first.dispose();
  }
  const bytes = await readFile(filename);
  for (const secret of ["refresh-token", "access-token", "organization"]) {
    expect(bytes.includes(Buffer.from(secret))).toBe(false);
  }
  const second = ManagedRuntime.make(testLayer(filename));
  try {
    await second.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service;
        expect(yield* credentials.get(saved.id)).toEqual(saved);
        const replacement = Credential.Key.make({
          type: "key",
          key: "new-key",
          metadata: { account: "work" },
        });
        yield* credentials.update(saved.id, { value: replacement });
        expect((yield* credentials.get(saved.id))?.value).toEqual(replacement);
      }),
    );
  } finally {
    await second.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves the old credential when replacement insertion fails", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const { db } = yield* Database.Service;
      const created = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "old-key" }),
      });
      yield* db.run(sql`CREATE TEMP TRIGGER reject_credential_insert
      BEFORE INSERT ON credential BEGIN SELECT RAISE(ABORT, 'test rejection'); END`);
      const exit = yield* credentials
        .create({
          integrationID,
          value: Credential.Key.make({ type: "key", key: "new-key" }),
        })
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
        Credential.StorageFailed,
      );
      expect(yield* credentials.list(integrationID)).toEqual([created]);
    }).pipe(Effect.provide(testLayer())),
  );
});

test("retains missing-ID, empty-update, and unbound-row behavior", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const { db } = yield* Database.Service;
      const missing = Credential.ID.create();
      expect(yield* credentials.get(missing)).toBeUndefined();
      yield* credentials.update(missing, { label: "Missing" });
      yield* credentials.clear(integrationID);
      const created = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "key" }),
      });
      yield* credentials.update(created.id, {});
      yield* credentials.update(created.id, { label: "" });
      expect(yield* credentials.get(created.id)).toEqual(created);
      const unbound = Credential.ID.create();
      yield* db.run(sql`INSERT INTO credential
      (id, label, value, time_created, time_updated)
      VALUES (${unbound}, 'Unbound', '{}', 1, 1)`);
      expect(yield* credentials.get(unbound)).toBeUndefined();
      expect(yield* credentials.all()).toEqual([created]);
    }).pipe(Effect.provide(testLayer())),
  );
});

test("unencodable metadata fails without replacing the previous credential", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const saved = yield* credentials.create({
        integrationID,
        value: { type: "key", key: "old-secret" },
      });
      const value = Credential.Key.make({
        type: "key",
        key: "new-secret",
        metadata: { unsupported: 1n },
      });
      const error = yield* credentials
        .create({ integrationID, value })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Credential.StorageFailed);
      expect(JSON.stringify(error)).not.toContain("new-secret");
      expect(yield* credentials.list(integrationID)).toEqual([saved]);
    }).pipe(Effect.provide(testLayer())),
  ));

test.each(['{"type":"oauth"}', "not-json"])(
  "reports invalid persisted values as StorageFailed: %s",
  async (value) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service;
        const { db } = yield* Database.Service;
        const id = Credential.ID.create();
        yield* db.run(sql`INSERT INTO credential
      (id, integration_id, label, value, time_created, time_updated)
      VALUES (${id}, ${integrationID}, 'Broken', ${value}, 1, 1)`);
        const exit = yield* credentials.get(id).pipe(Effect.exit);
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
          Credential.StorageFailed,
        );
      }).pipe(Effect.provide(testLayer())),
    );
  },
);

test.each(["UPDATE", "DELETE"])(
  "failed %s preserves the credential and returns StorageFailed",
  async (operation) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service;
        const { db } = yield* Database.Service;
        const saved = yield* credentials.create({
          integrationID,
          value: { type: "key", key: "old-secret" },
        });
        yield* db.run(
          sql.raw(`CREATE TEMP TRIGGER reject_credential_change
        BEFORE ${operation} ON credential BEGIN SELECT RAISE(ABORT, 'old-secret'); END`),
        );
        const error = yield* (
          operation === "UPDATE"
            ? credentials.update(saved.id, {
                value: { type: "key", key: "new-secret" },
              })
            : credentials.clear(integrationID)
        ).pipe(Effect.flip);
        expect(error).toBeInstanceOf(Credential.StorageFailed);
        expect(JSON.stringify(error)).not.toContain("old-secret");
        expect(yield* credentials.get(saved.id)).toEqual(saved);
      }).pipe(Effect.provide(testLayer())),
    );
  },
);

test("preserves optional metadata encoding and OAuth expiry validation", () => {
  const value = Credential.Key.make({
    type: "key",
    key: "key",
    metadata: undefined,
  });
  expect(Schema.encodeSync(Credential.Value)(value)).toEqual({
    type: "key",
    key: "key",
  });
  expect(() =>
    Schema.decodeUnknownSync(Credential.Value)({
      type: "oauth",
      methodID,
      refresh: "r",
      access: "a",
      expires: -1,
    }),
  ).toThrow();
});

test("shares Credential through the application runtime", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    credentialEncryption: encryption,
  });
  try {
    const first = await runtime.runPromise(Credential.Service);
    const second = await runtime.runPromise(Credential.Service);
    expect(first).toBe(second);
    const saved = await runtime.runPromise(
      first.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "test-key" }),
      }),
    );
    expect(await runtime.runPromise(second.get(saved.id))).toEqual(saved);
  } finally {
    await runtime.dispose();
  }
});

test("encryption failures preserve existing values and never expose the cause", async () => {
  let fail = false;
  const protection: Credential.Encryption = {
    ...encryption,
    async encrypt(plaintext) {
      if (fail) throw new Error(`sensitive provider data: ${plaintext}`);
      return encryption.encrypt(plaintext);
    },
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const saved = yield* credentials.create({
        integrationID,
        value: { type: "key", key: "old-secret" },
      });
      fail = true;
      for (const operation of [
        credentials.create({
          integrationID,
          value: { type: "key", key: "new-secret" },
        }),
        credentials.update(saved.id, {
          label: "Changed",
          value: { type: "key", key: "new-secret" },
        }),
      ]) {
        const error = yield* operation.pipe(Effect.flip);
        expect(error).toEqual(new Credential.StorageFailed({}));
        expect(JSON.stringify(error)).not.toContain("new-secret");
        expect(yield* credentials.get(saved.id)).toEqual(saved);
      }
    }).pipe(Effect.provide(testLayer(":memory:", protection))),
  );
});

test.each(["wrong-key", "tampered", "plaintext", "invalid-value"])(
  "rejects %s through every Credential read API",
  async (mode) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service;
        const { db } = yield* Database.Service;
        const saved = yield* credentials.create({
          integrationID,
          value: { type: "key", key: "secret" },
        });
        const plaintext = JSON.stringify(saved.value);
        let value: string;
        if (mode === "wrong-key") {
          value = yield* Effect.promise(() =>
            jweEncryption(randomBytes(32)).encrypt(plaintext),
          );
        } else if (mode === "plaintext") {
          value = plaintext;
        } else if (mode === "invalid-value") {
          value = yield* Effect.promise(() =>
            encryption.encrypt('{"type":"oauth"}'),
          );
        } else {
          const ciphertext = yield* Effect.promise(() =>
            encryption.encrypt(plaintext),
          );
          const parts = ciphertext.split(".");
          parts[3] =
            (parts[3]!.startsWith("A") ? "B" : "A") + parts[3]!.slice(1);
          value = parts.join(".");
        }
        yield* db.run(
          sql`UPDATE credential SET value = ${value} WHERE id = ${saved.id}`,
        );
        const reads: Effect.Effect<unknown, Credential.StorageFailed>[] = [
          credentials.get(saved.id),
          credentials.list(integrationID),
          credentials.all(),
        ];
        for (const read of reads) {
          const error = yield* read.pipe(Effect.flip);
          expect(error).toEqual(new Credential.StorageFailed({}));
          expect(JSON.stringify(error)).not.toContain("secret");
        }
      }).pipe(Effect.provide(testLayer())),
    );
  },
);

test("starts without encryption but refuses secret reads and writes; removal remains available", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
  });
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service;
        const { db } = yield* Database.Service;
        expect(yield* credentials.all()).toEqual([]);
        const error = yield* credentials
          .create({ integrationID, value: { type: "key", key: "secret" } })
          .pipe(Effect.flip);
        expect(error).toEqual(new Credential.StorageFailed({}));
        expect(yield* db.all(sql`SELECT * FROM credential`)).toEqual([]);
        const value = yield* Effect.promise(() =>
          encryption.encrypt('{"type":"key","key":"secret"}'),
        );
        const id = Credential.ID.create();
        yield* db.run(sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
        VALUES (${id}, ${integrationID}, 'Saved', ${value}, 1, 1)`);
        expect(yield* credentials.get(id).pipe(Effect.flip)).toEqual(
          new Credential.StorageFailed({}),
        );
        expect(
          yield* credentials
            .update(id, { value: { type: "key", key: "replacement" } })
            .pipe(Effect.flip),
        ).toEqual(new Credential.StorageFailed({}));
        yield* credentials.clear(integrationID);
        expect(yield* credentials.all()).toEqual([]);
      }),
    );
  } finally {
    await runtime.dispose();
  }
});
