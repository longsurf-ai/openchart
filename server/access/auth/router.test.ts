// Purpose: Verify account state and credential boundaries independently of retired market data.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { randomBytes } from "node:crypto";
import { ConfigProvider } from "effect";
import { expect, test } from "vitest";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { Integration } from "@openchart/server/access/integration";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
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
const thirdParty = Integration.IntegrationID.make("test-provider");

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
      providers: {
        openchart: { enabled: true },
        binance: { enabled: false },
        yfinance: { enabled: false },
        tradingview: { enabled: false },
      },
      ...(openchart === undefined ? {} : { openchart }),
    }),
    models: {
      fetchEnabled: false,
      userAgent: "test",
    },
  });
  return { runtime, encryption, caller: router.createCaller({ runtime }) };
}

test("login and logout work independently of retired market data", async () => {
  const { runtime, caller } = fixture();
  try {
    await caller.access.auth.completeSignIn(signIn);
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
    await caller.access.auth.logout();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-out",
    });
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
])(
  "retired OpenChart endpoint configuration cannot block startup: %j",
  async (config) => {
    const { runtime } = fixture(config);
    try {
      await runtime.context();
    } finally {
      await runtime.dispose();
    }
  },
);

test("Integration routes reject account writes while third-party disconnect preserves the account", async () => {
  const { runtime, caller } = fixture();
  try {
    const integration = await runtime.runPromise(Integration.Service);
    const connection = caller.access.integration.connection;
    await caller.access.auth.completeSignIn(signIn);
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
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-in",
      user: signIn.user,
    });
    await caller.access.auth.logout();
    expect(await caller.access.auth.getState()).toEqual({
      status: "signed-out",
    });
  } finally {
    await runtime.dispose();
  }
});
