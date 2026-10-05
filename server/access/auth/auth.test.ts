// Purpose: Verify local key persistence, independent backend access, and ordered account changes.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ConfigProvider, Effect, Layer, ManagedRuntime, Stream } from "effect";
import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { Credential } from "@openchart/server/access/credential";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { Integration } from "@openchart/server/access/integration";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { layer as integrationLayer } from "@openchart/server/access/integration/layer";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import {
  OpenChartClient,
  layer as openchartLayer,
} from "@openchart/server/data/providers/openchart/client";
import { Auth } from "./auth";
import { layer } from "./layer";

const input = {
  apiKeyID: "ak_test_backend_id",
  key: "ak_test_backend_credential",
  user: {
    id: "user_test",
    firstName: "A",
    lastName: "User",
    email: "a@example.com",
  },
};
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "openchart-auth-"));
  const database = join(directory, "account.sqlite3");
  const encryption = jweEncryption(randomBytes(32));
  const create = (protection = encryption) =>
    ManagedRuntime.make(
      Layer.unwrap(
        Effect.map(OpenChartClient, (openchart) =>
          layer({
            integrationID: OPENCHART_CLOUD.integrationID,
            resetConnections: () => openchart.reset(),
          }),
        ),
      ).pipe(
        Layer.provideMerge(openchartLayer()),
        Layer.provideMerge(
          integrationLayer({ methods: [OPENCHART_CLOUD] }).pipe(
            Layer.provideMerge(Credential.layer(protection)),
            Layer.provideMerge(Database.layer(database, () => Effect.void)),
            Layer.provideMerge(Events.layer),
          ),
        ),
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
      ),
    );
  return {
    database,
    encryption,
    create,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test("SDK handoff persists encrypted key/profile and restores backend access without a frontend", async () => {
  const f = await setup();
  let runtime = f.create();
  try {
    let auth = await runtime.runPromise(Auth.Service);
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    await runtime.runPromise(auth.completeSignIn(input));
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-in",
      user: input.user,
    });
    await runtime.dispose();
    const stored = await readFile(f.database);
    expect(stored.includes(Buffer.from(input.key))).toBe(false);
    expect(stored.includes(Buffer.from(input.user.email))).toBe(false);
    runtime = f.create();
    auth = await runtime.runPromise(Auth.Service);
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-in",
      user: input.user,
    });
    expect(
      await runtime.runPromise(
        Integration.Service.use((service) =>
          service.connection.resolveCredential(OPENCHART_CLOUD.integrationID),
        ),
      ),
    ).toEqual({
      type: "key",
      key: input.key,
      metadata: { user: input.user, apiKeyID: input.apiKeyID },
    });
    await runtime.runPromise(auth.logout());
    await runtime.runPromise(auth.logout());
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    expect(
      await runtime.runPromise(
        Integration.Service.use((service) =>
          service.connection.resolveCredential(OPENCHART_CLOUD.integrationID),
        ),
      ),
    ).toBeUndefined();
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("an existing account rejects another handoff until logout", async () => {
  const f = await setup();
  const runtime = f.create();
  try {
    const auth = await runtime.runPromise(Auth.Service);
    await runtime.runPromise(auth.completeSignIn(input));
    await expect(
      runtime.runPromise(auth.completeSignIn({ ...input, key: "other" })),
    ).rejects.toMatchObject({ reason: "busy" });
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-in",
      user: input.user,
    });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test.each(["save", "restore"] as const)(
  "direct Auth %s finishes reset before logout, even when the caller aborts",
  async (operation) => {
    const f = await setup();
    const runtime = f.create();
    let release = () => {};
    try {
      const auth = await runtime.runPromise(Auth.Service);
      if (operation === "restore") {
        await runtime.runPromise(auth.completeSignIn(input));
        await runtime.runPromise(auth.logout());
      }
      const openchart = await runtime.runPromise(OpenChartClient);
      let entered!: () => void;
      const resetting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const reset = vi.spyOn(openchart, "reset").mockReturnValueOnce(
        Effect.callback((resume) => {
          release = () => resume(Effect.void);
          entered();
        }),
      );
      const controller = new AbortController();
      const save = runtime.runPromiseExit(
        operation === "save"
          ? auth.completeSignIn(input)
          : auth.restoreSignIn({
              userID: input.user.id,
              apiKeyID: input.apiKeyID,
            }),
        {
          signal: controller.signal,
        },
      );
      await resetting;
      controller.abort();
      const logout = runtime.runPromise(auth.logout());
      expect(await runtime.runPromise(auth.getState())).toEqual({
        status: "signed-in",
        user: input.user,
      });
      expect(reset).toHaveBeenCalledOnce();
      release();
      expect((await save)._tag).toBe("Failure");
      await logout;
      expect(reset).toHaveBeenCalledTimes(2);
      expect(await runtime.runPromise(auth.getState())).toEqual({
        status: "signed-out",
      });
    } finally {
      release();
      await runtime.dispose();
      await f.close();
    }
  },
);

test("logout persists an inactive key and restores the same record after restart without rewriting ciphertext", async () => {
  const f = await setup();
  let runtime = f.create();
  const rows = Database.Service.use(({ db }) =>
    db.all<{ id: string; value: string; active: number }>(
      sql`SELECT * FROM credential`,
    ),
  );
  try {
    let auth = await runtime.runPromise(Auth.Service);
    expect(
      await runtime.runPromise(auth.getSavedKey(input.user.id)),
    ).toBeNull();
    await runtime.runPromise(auth.completeSignIn(input));
    const before = await runtime.runPromise(rows);
    await runtime.runPromise(auth.logout());
    await runtime.dispose();
    runtime = f.create();
    auth = await runtime.runPromise(Auth.Service);
    const inactive = await runtime.runPromise(rows);
    expect(inactive).toHaveLength(1);
    expect(inactive[0]).toMatchObject({
      id: before[0]!.id,
      value: before[0]!.value,
      active: 0,
    });
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    expect(
      await runtime.runPromise(auth.getSavedKey("another-user")),
    ).toBeNull();
    expect(await runtime.runPromise(auth.getSavedKey(input.user.id))).toEqual({
      apiKeyID: input.apiKeyID,
    });
    const openchart = await runtime.runPromise(OpenChartClient);
    const reset = vi.spyOn(openchart, "reset");
    const notifications = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events = yield* Events.allBounded(1);
          yield* auth.restoreSignIn({
            userID: input.user.id,
            apiKeyID: input.apiKeyID,
          });
          yield* auth.restoreSignIn({
            userID: input.user.id,
            apiKeyID: input.apiKeyID,
          });
          return yield* events.pipe(Stream.take(1), Stream.runCollect);
        }),
      ),
    );
    expect(notifications.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: "integration.updated", data: {} },
    ]);
    expect(reset).toHaveBeenCalledOnce();
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-in",
      user: input.user,
    });
    const restored = await runtime.runPromise(rows);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: before[0]!.id,
      value: before[0]!.value,
      active: 1,
    });
    expect(
      await runtime.runPromise(
        Integration.Service.use((service) =>
          service.connection.resolveCredential(OPENCHART_CLOUD.integrationID),
        ),
      ),
    ).toMatchObject({ key: input.key });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("restore rejects missing, mismatched, and replaced credentials without enabling another account", async () => {
  const f = await setup();
  const runtime = f.create();
  try {
    const auth = await runtime.runPromise(Auth.Service);
    const restore = { userID: input.user.id, apiKeyID: input.apiKeyID };
    await expect(
      runtime.runPromise(auth.restoreSignIn(restore)),
    ).rejects.toMatchObject({ reason: "credential-mismatch" });
    await runtime.runPromise(auth.completeSignIn(input));
    await runtime.runPromise(auth.logout());
    const openchart = await runtime.runPromise(OpenChartClient);
    const reset = vi.spyOn(openchart, "reset");
    for (const mismatch of [
      { ...restore, userID: "another-user" },
      { ...restore, apiKeyID: "another-key" },
    ]) {
      await expect(
        runtime.runPromise(auth.restoreSignIn(mismatch)),
      ).rejects.toMatchObject({ reason: "credential-mismatch" });
    }
    expect(reset).not.toHaveBeenCalled();
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    await runtime.runPromise(
      auth.completeSignIn({
        ...input,
        apiKeyID: "replacement-id",
        key: "replacement",
      }),
    );
    await runtime.runPromise(auth.logout());
    reset.mockClear();
    await expect(
      runtime.runPromise(auth.restoreSignIn(restore)),
    ).rejects.toMatchObject({ reason: "credential-mismatch" });
    expect(reset).not.toHaveBeenCalled();
    const saved = await runtime.runPromise(
      Integration.Service.use((service) =>
        service.connection.getSavedCredential(OPENCHART_CLOUD.integrationID),
      ),
    );
    expect(saved).toMatchObject({
      active: false,
      value: { key: "replacement" },
    });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("failed restore or replacement preserves the inactive key and does not reset OpenChart", async () => {
  const f = await setup();
  const runtime = f.create();
  try {
    const auth = await runtime.runPromise(Auth.Service);
    const credentials = await runtime.runPromise(Credential.Service);
    await runtime.runPromise(auth.completeSignIn(input));
    await runtime.runPromise(auth.logout());
    const before = await runtime.runPromise(
      credentials.list(OPENCHART_CLOUD.integrationID),
    );
    const reset = vi.spyOn(await runtime.runPromise(OpenChartClient), "reset");
    vi.spyOn(credentials, "setActive").mockReturnValueOnce(
      Effect.fail(new Credential.StorageFailed({})),
    );
    await expect(
      runtime.runPromise(
        auth.restoreSignIn({ userID: input.user.id, apiKeyID: input.apiKeyID }),
      ),
    ).rejects.toMatchObject({ reason: "storage" });
    vi.spyOn(f.encryption, "encrypt").mockRejectedValueOnce(
      new Error("Unavailable"),
    );
    await expect(
      runtime.runPromise(
        auth.completeSignIn({ ...input, apiKeyID: "new-id", key: "new-key" }),
      ),
    ).rejects.toMatchObject({ reason: "storage" });
    expect(
      await runtime.runPromise(credentials.list(OPENCHART_CLOUD.integrationID)),
    ).toEqual(before);
    expect(reset).not.toHaveBeenCalled();
    vi.spyOn(credentials, "list").mockReturnValueOnce(
      Effect.fail(new Credential.StorageFailed({})),
    );
    await expect(
      runtime.runPromise(auth.getSavedKey(input.user.id)),
    ).rejects.toMatchObject({ _tag: "SessionUnavailable" });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("pre-ID handoffs keep existing access but do not fabricate a restorable Clerk key ID", async () => {
  const f = await setup();
  const runtime = f.create();
  try {
    const integration = await runtime.runPromise(Integration.Service);
    await runtime.runPromise(
      integration.connection.setApiKey({
        integrationID: OPENCHART_CLOUD.integrationID,
        key: input.key,
        metadata: { user: input.user },
      }),
    );
    const auth = await runtime.runPromise(Auth.Service);
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-in",
      user: input.user,
    });
    expect(
      await runtime.runPromise(auth.getSavedKey(input.user.id)),
    ).toBeNull();
    await runtime.runPromise(auth.logout());
    await expect(
      runtime.runPromise(
        auth.restoreSignIn({ userID: input.user.id, apiKeyID: input.apiKeyID }),
      ),
    ).rejects.toMatchObject({ reason: "credential-mismatch" });
    await runtime.runPromise(auth.completeSignIn(input));
    expect(await runtime.runPromise(auth.getSavedKey(input.user.id))).toEqual({
      apiKeyID: input.apiKeyID,
    });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("logout waits for an in-flight encrypted save and leaves its credential inactive", async () => {
  const f = await setup();
  let release!: () => void;
  let entered!: () => void;
  const arrived = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = f.create({
    ...f.encryption,
    encrypt: async (value) => {
      entered();
      await pause;
      return f.encryption.encrypt(value);
    },
  });
  try {
    const auth = await runtime.runPromise(Auth.Service);
    const save = runtime.runPromise(auth.completeSignIn(input));
    await arrived;
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    const logout = runtime.runPromise(auth.logout());
    release();
    await save;
    await logout;
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    expect(
      await runtime.runPromise(
        Integration.Service.use((service) =>
          service.connection.resolveCredential(OPENCHART_CLOUD.integrationID),
        ),
      ),
    ).toBeUndefined();
  } finally {
    release();
    await runtime.dispose();
    await f.close();
  }
});

test("failed encryption does not report signed in or persist plaintext", async () => {
  const f = await setup();
  const runtime = f.create({
    ...f.encryption,
    encrypt: async () => {
      throw new Error("Unavailable");
    },
  });
  try {
    const auth = await runtime.runPromise(Auth.Service);
    await expect(
      runtime.runPromise(auth.completeSignIn(input)),
    ).rejects.toMatchObject({ reason: "storage" });
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
    expect(
      await runtime.runPromise(
        Credential.Service.use((store) =>
          store.list(OPENCHART_CLOUD.integrationID),
        ),
      ),
    ).toEqual([]);
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("malformed saved profile is an error, and removing credentials updates the Auth projection", async () => {
  const f = await setup();
  let runtime = f.create();
  try {
    const integration = await runtime.runPromise(Integration.Service);
    await runtime.runPromise(
      integration.connection.setApiKey({
        integrationID: OPENCHART_CLOUD.integrationID,
        key: input.key,
      }),
    );
    await runtime.dispose();
    runtime = f.create();
    // Corrupt persisted metadata must not prevent the backend from starting.
    const auth = await runtime.runPromise(Auth.Service);
    await expect(runtime.runPromise(auth.getState())).rejects.toMatchObject({
      _tag: "SessionUnavailable",
    });
    await runtime.runPromise(auth.logout());
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("unavailable decryption fails the account query but still permits logout", async () => {
  const f = await setup();
  let runtime = f.create();
  try {
    await runtime.runPromise(
      Auth.Service.use((auth) => auth.completeSignIn(input)),
    );
    await runtime.dispose();
    runtime = f.create({
      ...f.encryption,
      decrypt: async () => {
        throw new Error("Unavailable");
      },
    });
    const auth = await runtime.runPromise(Auth.Service);
    await expect(runtime.runPromise(auth.getState())).rejects.toMatchObject({
      _tag: "SessionUnavailable",
    });
    const openchart = await runtime.runPromise(OpenChartClient);
    const reset = vi.spyOn(openchart, "reset");
    await runtime.runPromise(auth.logout());
    expect(reset).toHaveBeenCalledOnce();
    expect(await runtime.runPromise(auth.getState())).toEqual({
      status: "signed-out",
    });
  } finally {
    await runtime.dispose();
    await f.close();
  }
});

test("Auth and direct Integration writes share one credential notification", async () => {
  const f = await setup();
  const runtime = f.create();
  try {
    const notifications = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* Auth.Service;
          const integration = yield* Integration.Service;
          const events = yield* Events.allBounded(4);
          yield* auth.completeSignIn(input);
          yield* integration.connection.disconnect(
            OPENCHART_CLOUD.integrationID,
          );
          expect(yield* auth.getState()).toEqual({ status: "signed-out" });
          yield* auth.completeSignIn(input);
          yield* auth.logout();
          expect(yield* auth.getState()).toEqual({ status: "signed-out" });
          return yield* events.pipe(Stream.take(4), Stream.runCollect);
        }),
      ),
    );
    expect(notifications.map(({ type, data }) => ({ type, data }))).toEqual(
      Array.from({ length: 4 }, () => ({
        type: "integration.updated",
        data: {},
      })),
    );
  } finally {
    await runtime.dispose();
    await f.close();
  }
});
