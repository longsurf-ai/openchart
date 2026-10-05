// Purpose: Verify account mutations reset the shared OpenChart transport through the real application runtime.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { ConfigProvider, Effect, Stream } from "effect";
import { createServer } from "node:http";
import { expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { Credential } from "@openchart/server/access/credential";
import { Integration } from "@openchart/server/access/integration";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { OpenChartClient } from "@openchart/server/data/providers/openchart/client";
import { router } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";

const signIn = {
  apiKeyID: "ak_account_a",
  key: "account-a",
  user: {
    id: "user-a",
    firstName: "A",
    lastName: "User",
    email: "a@example.com",
  },
};
const series = {
  listing: 12526,
  session: "regular",
  resolution: "1m",
  adjustment: "raw",
} as const;
const search = { query: "AAPL" };
const nextListing = { id: 12526, symbol: "AAPL", currency: "USD" };

const thirdParty = Integration.IntegrationID.make("test-provider");

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(openchart?: unknown) {
  const encryption = jweEncryption(randomBytes(32));
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    credentialEncryption: encryption,
    auth: { integrationID: OPENCHART_CLOUD.integrationID },
    integrations: {
      methods: [
        OPENCHART_CLOUD,
        { integrationID: thirdParty, method: { type: "key" } },
      ],
    },
    config: ConfigProvider.fromUnknown({
      providers: { openchart: { enabled: false } },
      ...(openchart === undefined ? {} : { openchart }),
    }),
    models: {
      fetchEnabled: false,
      userAgent: "test",
    },
  });
  return { runtime, encryption, caller: router.createCaller({ runtime }) };
}

test("login and logout work without OpenChart config; OpenChart calls require the signed-in account", async () => {
  const { runtime, caller } = fixture();
  try {
    const openchart = await runtime.runPromise(OpenChartClient);
    await caller.access.auth.completeSignIn(signIn);
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
    await caller.access.auth.logout();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-out",
    });
    const calls: Effect.Effect<unknown, unknown>[] = [
      openchart.searchListings(search),
      openchart.readBarsPage({
        ...series,
        start: 0,
        end: 1000,
        limit: 1,
        order: "asc",
      }),
      openchart
        .subscribeBars(series)
        .pipe(Effect.flatMap(Stream.runCollect), Effect.scoped),
    ];
    for (const call of calls) {
      await expect(runtime.runPromise(call)).rejects.toMatchObject({
        _tag: "OpenChart.CredentialUnavailable",
      });
    }
  } finally {
    await runtime.dispose();
  }
});

test("account routes expose only a saved key ID and restore the matching inactive account", async () => {
  const { runtime, caller } = fixture();
  try {
    const auth = caller.access.auth;
    expect(await auth.getSavedKey({ userID: signIn.user.id })).toBeNull();
    await auth.completeSignIn(signIn);
    await auth.logout();
    const saved = await auth.getSavedKey({ userID: signIn.user.id });
    expect(saved).toEqual({ apiKeyID: signIn.apiKeyID });
    expect(JSON.stringify(saved)).not.toContain(signIn.key);
    expect(await auth.getSavedKey({ userID: "other-user" })).toBeNull();
    await expect(
      auth.restoreSignIn({ userID: signIn.user.id, apiKeyID: "wrong-key" }),
    ).rejects.toBeDefined();
    expect(await auth.getState()).toEqual({ status: "signed-out" });
    await auth.restoreSignIn({
      userID: signIn.user.id,
      apiKeyID: signIn.apiKeyID,
    });
    expect(await auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
  } finally {
    await runtime.dispose();
  }
});

test("login and restoration boundaries reject missing or empty identities and unexpected secret input", async () => {
  const { runtime, caller } = fixture();
  try {
    const auth = caller.access.auth;
    await expect(
      auth.completeSignIn({ ...signIn, apiKeyID: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      // @ts-expect-error Clerk key identity is now required at the handoff boundary.
      auth.completeSignIn({ key: signIn.key, user: signIn.user }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(auth.getSavedKey({ userID: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    for (const input of [
      { userID: "", apiKeyID: signIn.apiKeyID },
      { userID: signIn.user.id, apiKeyID: "" },
      { userID: signIn.user.id, apiKeyID: signIn.apiKeyID, key: signIn.key },
    ]) {
      await expect(auth.restoreSignIn(input)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(await auth.getState()).toEqual({ status: "signed-out" });
  } finally {
    await runtime.dispose();
  }
});

test.each([
  { baseUrl: "invalid" },
  { baseUrl: "https://openchart.example.com", requestTimeout: "0 seconds" },
])("invalid supplied OpenChart config fails startup: %j", async (config) => {
  const { runtime } = fixture(config);
  try {
    await expect(runtime.context()).rejects.toBeDefined();
  } finally {
    await runtime.dispose();
  }
});

test("login resets pending credential acquisition before returning", async () => {
  const { runtime, caller } = fixture({ baseUrl: "http://127.0.0.1:1" });
  try {
    const openchart = await runtime.runPromise(OpenChartClient);
    const integration = await runtime.runPromise(Integration.Service);
    const entered = deferred<void>();
    const cancelled = vi.fn();
    vi.spyOn(integration.connection, "resolveCredential").mockReturnValueOnce(
      Effect.callback(() => {
        entered.resolve();
        return Effect.sync(cancelled);
      }),
    );
    const pending = runtime
      .runPromise(openchart.searchListings(search))
      .catch((error) => error as unknown);
    await entered.promise;
    await caller.access.auth.completeSignIn(signIn);
    expect(await pending).toMatchObject({ reason: "changed" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
  } finally {
    await runtime.dispose();
  }
});

test("logout cancels pending HTTP and closes the old socket; the next login uses its own key", async () => {
  const headers: Array<string | undefined> = [];
  const received = deferred<void>();
  const response = deferred<unknown>();
  const operation = vi
    .fn()
    .mockImplementationOnce(() => response.promise)
    .mockResolvedValue({ results: [nextListing] });
  const server = createServer((req, res) => {
    headers.push(req.headers.authorization);
    received.resolve();
    void operation().then((body: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    });
  });
  const ws = new WebSocketServer({ server, path: "/marketfeed/live" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const { runtime, caller } = fixture({
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
  try {
    const openchart = await runtime.runPromise(OpenChartClient);
    await caller.access.auth.completeSignIn(signIn);
    const pending = runtime
      .runPromise(openchart.searchListings(search))
      .catch((error) => error as unknown);
    await received.promise;
    const connected = once(ws, "connection");
    const stream = runtime
      .runPromise(
        openchart
          .subscribeBars(series)
          .pipe(Effect.flatMap(Stream.runCollect), Effect.scoped),
      )
      .catch((error) => error as unknown);
    await connected;
    await caller.access.auth.logout();
    expect(await pending).toMatchObject({ reason: "changed" });
    expect(await stream).toMatchObject({ reason: "changed" });
    await vi.waitFor(() => expect(ws.clients.size).toBe(0));
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-out",
    });
    await expect(
      runtime.runPromise(openchart.searchListings(search)),
    ).rejects.toMatchObject({ reason: "missing" });
    await caller.access.auth.completeSignIn({
      ...signIn,
      key: "account-b",
      apiKeyID: "ak_account_b",
      user: { ...signIn.user, id: "user-b" },
    });
    expect(await runtime.runPromise(openchart.searchListings(search))).toEqual([
      nextListing,
    ]);
    expect(headers).toEqual(["Bearer account-a", "Bearer account-b"]);
  } finally {
    response.resolve({ results: [] });
    await runtime.dispose();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("failed account writes leave the shared OpenChart transport intact", async () => {
  const { runtime, caller, encryption } = fixture();
  try {
    const openchart = await runtime.runPromise(OpenChartClient);
    const reset = vi.spyOn(openchart, "reset");
    const encrypt = vi
      .spyOn(encryption, "encrypt")
      .mockRejectedValueOnce(new Error("Unavailable"));
    await expect(
      caller.access.auth.completeSignIn(signIn),
    ).rejects.toBeDefined();
    expect(reset).not.toHaveBeenCalled();
    encrypt.mockRestore();
    await caller.access.auth.completeSignIn(signIn);
    reset.mockClear();
    await expect(
      caller.access.auth.completeSignIn(signIn),
    ).rejects.toBeDefined();
    expect(reset).not.toHaveBeenCalled();
    const credentials = await runtime.runPromise(Credential.Service);
    vi.spyOn(credentials, "setActive").mockReturnValueOnce(
      Effect.fail(new Credential.StorageFailed({})),
    );
    await expect(caller.access.auth.logout()).rejects.toBeDefined();
    expect(reset).not.toHaveBeenCalled();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
  } finally {
    await runtime.dispose();
  }
});

test("Integration routes reject account writes while third-party disconnect preserves the account", async () => {
  const { runtime, caller } = fixture();
  try {
    const openchart = await runtime.runPromise(OpenChartClient);
    const reset = vi.spyOn(openchart, "reset");
    const integration = await runtime.runPromise(Integration.Service);
    const connection = caller.access.integration.connection;
    await caller.access.auth.completeSignIn(signIn);
    reset.mockClear();
    await expect(
      connection.setApiKey({
        integrationID: OPENCHART_CLOUD.integrationID,
        key: "direct",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await connection.setApiKey({
      integrationID: thirdParty,
      key: "third-party",
    });
    await connection.disconnect({ integrationID: thirdParty });
    expect(
      (await runtime.runPromise(integration.getIntegration(thirdParty)))!
        .credentialSources,
    ).toEqual([]);
    await expect(
      connection.disconnect({ integrationID: OPENCHART_CLOUD.integrationID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(reset).not.toHaveBeenCalled();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
    await caller.access.auth.logout();
    expect(reset).toHaveBeenCalledOnce();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-out",
    });
  } finally {
    await runtime.dispose();
  }
});
