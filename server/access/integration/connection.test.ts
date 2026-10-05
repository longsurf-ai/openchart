// Purpose: Verifies registration, credential projection, API keys, events, and OAuth refresh parity.

import { Credential } from "@openchart/server/access/credential";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Stream } from "effect";
import { expect, test, vi } from "vitest";
import { Integration } from "./integration";
import { Event } from "./events";
import { integrationID, keyMethod, oauth, run, value } from "./test-fixture";

test.each(["key", "oauth"] as const)(
  "inactive %s credentials remain discoverable but cannot be resolved or refreshed",
  (type) => {
    const refresh = vi.fn(() =>
      Effect.succeed({ ...value, access: "renewed" }),
    );
    return run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const { db } = yield* Database.Service;
        const saved = yield* credentials.create({
          integrationID,
          value:
            type === "key"
              ? { type: "key", key: "stored-secret" }
              : { ...value, expires: 0 },
        });
        const before = yield* db.all(sql`SELECT value FROM credential`);
        const stream = yield* Events.allBounded(2);
        yield* service.connection.setActive(integrationID, false);
        expect(
          yield* service.connection.resolveCredential(integrationID),
        ).toBeUndefined();
        expect(refresh).not.toHaveBeenCalled();
        expect(
          yield* service.connection.getSavedCredential(integrationID),
        ).toEqual({ ...saved, active: false });
        expect(
          (yield* service.getIntegration(integrationID))?.credentialSources,
        ).toEqual([
          {
            type: "credential",
            id: saved.id,
            label: saved.label,
            active: false,
          },
        ]);
        expect(yield* db.all(sql`SELECT value FROM credential`)).toEqual(
          before,
        );
        yield* service.connection.setActive(integrationID, true);
        expect(
          (yield* service.connection.getSavedCredential(integrationID))?.active,
        ).toBe(true);
        expect(
          yield* service.connection.resolveCredential(integrationID),
        ).toMatchObject({ type });
        expect(refresh).toHaveBeenCalledTimes(type === "oauth" ? 1 : 0);
        const events = yield* stream.pipe(Stream.take(2), Stream.runCollect);
        expect(events.map(({ type, data }) => ({ type, data }))).toEqual([
          { type: Event.Updated.type, data: {} },
          { type: Event.Updated.type, data: {} },
        ]);
        yield* service.connection.disconnect(integrationID);
        expect(
          yield* service.connection.getSavedCredential(integrationID),
        ).toBeUndefined();
      }),
      { methods: [keyMethod, { ...oauth(Effect.never), refresh }] },
    );
  },
);

test("empty catalog leaves unknown integrations absent", () =>
  run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      expect(yield* service.listIntegrations()).toEqual([]);
      expect(yield* service.getIntegration(integrationID)).toBeUndefined();
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toBeUndefined();
    }),
  ));

test("registers identities and replaces methods using upstream identity and ordering rules", () => {
  const method = oauth(Effect.never);
  const other = Integration.IntegrationID.make("zeta");
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      expect(
        (yield* service.listIntegrations()).map((item) => item.name),
      ).toEqual(["Acme", "Zeta"]);
      expect(yield* service.getIntegration(integrationID)).toEqual({
        id: integrationID,
        name: "Acme",
        credentialSources: [],
        methods: [
          { type: "key", label: "Replacement" },
          { ...method.method, label: "OAuth replacement" },
        ],
      });
      expect(yield* service.getIntegration(other)).toMatchObject({
        methods: [],
        credentialSources: [],
      });
    }),
    {
      integrations: [
        { id: other, name: "Zeta" },
        { id: integrationID, name: "Old" },
        { id: integrationID, name: "Acme" },
      ],
      methods: [
        keyMethod,
        method,
        { ...keyMethod, method: { type: "key", label: "Replacement" } },
        { ...method, method: { ...method.method, label: "OAuth replacement" } },
      ],
    },
  );
});

test("key writes persist before invalidation, project no secrets, replace and disconnect by integration ID", () =>
  run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toBeUndefined();
      const events = yield* Events.Service;
      const stream = yield* events.allBounded(16);
      const firstEvents = yield* stream.pipe(
        Stream.take(1),
        Stream.mapEffect((event) =>
          Effect.gen(function* () {
            return { event, saved: yield* credentials.list(integrationID) };
          }),
        ),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* service.connection.setApiKey({
        integrationID,
        key: "first",
        label: "Work",
      });
      const received = yield* Fiber.join(firstEvents);
      expect(
        received.map(({ event }) => ({ type: event.type, data: event.data })),
      ).toEqual([{ type: Event.Updated.type, data: {} }]);
      expect(received[0]!.saved[0]!.value).toEqual(
        Credential.Key.make({ type: "key", key: "first" }),
      );
      expect(JSON.stringify(received.map(({ event }) => event))).not.toContain(
        "first",
      );
      const first = (yield* credentials.list(integrationID))[0]!;
      yield* service.connection.setApiKey({
        integrationID,
        key: "replacement",
      });
      const saved = (yield* credentials.list(integrationID))[0]!;
      expect(saved.id).not.toBe(first.id);
      expect(yield* credentials.get(first.id)).toBeUndefined();
      const source = {
        type: "credential" as const,
        id: saved.id,
        label: "default",
        active: true,
      };
      expect(yield* service.getIntegration(integrationID)).toEqual({
        id: integrationID,
        name: integrationID,
        methods: [{ type: "key" }],
        credentialSources: [source],
      });
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toEqual(Credential.Key.make({ type: "key", key: "replacement" }));
      yield* service.connection.disconnect(
        Integration.IntegrationID.make("other-provider"),
      );
      expect(yield* credentials.get(saved.id)).toEqual(saved);
      yield* service.connection.disconnect(integrationID);
      yield* service.connection.disconnect(integrationID);
      expect(yield* credentials.all()).toEqual([]);
      expect(
        (yield* service.getIntegration(integrationID))!.credentialSources,
      ).toEqual([]);
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toBeUndefined();
    }),
    { methods: [keyMethod] },
  ));

test("unsupported key methods fail without writing; disconnect still invalidates the catalog", () =>
  run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const events = yield* Events.Service;
      const stream = yield* events.allBounded(4);
      const received = yield* stream.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );
      const exit = yield* service.connection
        .setApiKey({ integrationID, key: "secret" })
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(yield* credentials.all()).toEqual([]);
      yield* service.connection.disconnect(integrationID);
      expect((yield* Fiber.join(received)).map((event) => event.type)).toEqual([
        Event.Updated.type,
      ]);
    }),
  ));

test("refreshes at the five-minute boundary and persists the result", () => {
  const refresh = vi.fn((credential: Credential.OAuth) =>
    Effect.succeed({ ...credential, access: "renewed", expires: 900_000 }),
  );
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const saved = yield* credentials.create({
        integrationID,
        value: { ...value, expires: 300_001 },
      });
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toEqual({
        ...value,
        expires: 300_001,
      });
      expect(refresh).not.toHaveBeenCalled();
      yield* credentials.update(saved.id, {
        value: { ...value, expires: 300_000 },
      });
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toEqual({
        ...value,
        access: "renewed",
      });
      expect(refresh).toHaveBeenCalledExactlyOnceWith({
        ...value,
        expires: 300_000,
      });
      expect((yield* credentials.get(saved.id))?.value).toEqual({
        ...value,
        access: "renewed",
      });
      yield* service.connection.resolveCredential(integrationID);
      expect(refresh).toHaveBeenCalledTimes(1);
    }),
    { methods: [{ ...oauth(Effect.never), refresh }] },
  );
});

test("refresh failure stays typed and preserves tokens", () => {
  const cause = new Error("Refresh rejected");
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const saved = yield* credentials.create({
        integrationID,
        value: { ...value, expires: 0 },
      });
      const error = yield* service.connection
        .resolveCredential(integrationID)
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Integration.AuthorizationError);
      expect(error.cause).toBe(cause);
      expect(yield* credentials.get(saved.id)).toEqual(saved);
    }),
    {
      methods: [{ ...oauth(Effect.never), refresh: () => Effect.fail(cause) }],
    },
  );
});

test.each([false, true])(
  "OAuth without a refresh implementation returns its stored value (registered=%s)",
  (registered) =>
    run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const saved = yield* credentials.create({
          integrationID,
          value: { ...value, expires: 0 },
        });
        expect(
          yield* service.connection.resolveCredential(integrationID),
        ).toEqual(saved.value);
      }),
      { methods: registered ? [oauth(Effect.never)] : [] },
    ),
);

test("resolves only the requested integration", () =>
  run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const otherID = Integration.IntegrationID.make("other");
      yield* credentials.create({
        integrationID: otherID,
        value: { type: "key", key: "other-secret" },
      });
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toBeUndefined();
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: "requested-secret" },
      });
      expect(
        yield* service.connection.resolveCredential(integrationID),
      ).toEqual({ type: "key", key: "requested-secret" });
      expect(yield* service.connection.resolveCredential(otherID)).toEqual({
        type: "key",
        key: "other-secret",
      });
    }),
  ));

test("credential storage failure remains an error", () =>
  run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const { db } = yield* Database.Service;
      yield* db.run(sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
        VALUES ('cred_broken', ${integrationID}, 'Broken', 'invalid-ciphertext', 1, 1)`);
      const error = yield* service.connection
        .resolveCredential(integrationID)
        .pipe(Effect.flip);
      expect(error).toEqual(new Credential.StorageFailed({}));
    }),
  ));
