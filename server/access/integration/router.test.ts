// Purpose: Verifies the public Integration HTTP contract and keeps credential capabilities internal.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequestHandler, type AppRouter } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { Credential } from "@openchart/server/access/credential";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { randomBytes } from "node:crypto";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { inferRouterInputs } from "@trpc/server";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { expect, expectTypeOf, test, vi } from "vitest";

import { Integration } from "./integration";

const integrationID = Integration.IntegrationID.make("example-provider");
const credentialID = Credential.ID.make("cred_example");
const details: Integration.Details = {
  id: integrationID,
  name: "Example Provider",
  methods: [{ type: "key" }],
  credentialSources: [
    { type: "credential", id: credentialID, label: "Work", active: true },
  ],
};

function implementation() {
  const internal = () =>
    Effect.die(new Error("Internal Integration operation invoked"));
  return {
    getIntegration: vi.fn(internal),
    listIntegrations: vi.fn(() => Effect.succeed([details])),
    connection: {
      getSavedCredential: vi.fn(internal),
      setActive: vi.fn(internal),
      resolveCredential: vi.fn(internal),
      setApiKey: vi.fn<Integration.Interface["connection"]["setApiKey"]>(
        () => Effect.void,
      ),
      disconnect: vi.fn(() => Effect.void),
    },
    oauthAttempt: {
      start: vi.fn(internal),
      getStatus: vi.fn(internal),
      complete: vi.fn(internal),
      cancel: vi.fn(internal),
    },
  } satisfies Integration.Interface;
}

async function serve(
  service?: Integration.Interface,
  integrations?: Integration.Configuration,
) {
  const application = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    credentialEncryption: jweEncryption(randomBytes(32)),
    integrations,
  });
  // Override only this test's request context; application composition stays fixed.
  const runtime = service
    ? ManagedRuntime.make(
        Layer.succeedContext(
          Context.add(
            await application.context(),
            Integration.Service,
            service,
          ),
        ),
      )
    : application;
  const server = createServer(createRequestHandler(runtime));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server port");
  const url = `http://127.0.0.1:${address.port}/trpc`;
  return {
    url,
    client: createTRPCClient<AppRouter>({ links: [httpLink({ url })] }),
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await runtime.dispose();
      if (runtime !== application) await application.dispose();
    },
  };
}

test("mounts only provider listing and API-key management under access.integration", async () => {
  const service = implementation();
  const server = await serve(service);
  const client = server.client.access.integration;
  try {
    expect(await client.listIntegrations.query()).toEqual([details]);

    const keyInput = {
      integrationID: "example-provider",
      key: "private-api-key",
      label: "Work",
    };
    expect(await client.connection.setApiKey.mutate(keyInput)).toBeUndefined();
    expect(service.connection.setApiKey).toHaveBeenCalledExactlyOnceWith(
      keyInput,
    );
    await client.connection.disconnect.mutate({ integrationID });
    expect(service.connection.disconnect).toHaveBeenCalledExactlyOnceWith(
      integrationID,
    );

    type Inputs = inferRouterInputs<AppRouter>["access"]["integration"];
    expectTypeOf<keyof Inputs>().toEqualTypeOf<
      "listIntegrations" | "connection"
    >();
    expectTypeOf<
      Inputs["connection"]["setApiKey"]["integrationID"]
    >().toEqualTypeOf<string>();
    expectTypeOf<keyof Inputs["connection"]>().toEqualTypeOf<
      "setApiKey" | "disconnect"
    >();
  } finally {
    await server.close();
  }
});

test("rejects malformed inputs, query writes, and excluded Service operations", async () => {
  const service = implementation();
  const server = await serve(service);
  try {
    for (const input of [
      {},
      { integrationID: 42 },
      { credentialID },
      { integrationID, credentialID, key: "private-api-key" },
    ]) {
      const response = await fetch(
        `${server.url}/access.integration.connection.disconnect`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("private-api-key");
    }
    expect(service.connection.disconnect).not.toHaveBeenCalled();
    const queryWrite = await fetch(
      `${server.url}/access.integration.connection.setApiKey`,
    );
    expect(queryWrite.status).toBe(405);
    expect(service.connection.setApiKey).not.toHaveBeenCalled();

    for (const path of [
      "access.integration.getIntegration",
      "access.integration.oauthAttempt.start",
      "access.integration.oauthAttempt.getStatus",
      "access.integration.oauthAttempt.complete",
      "access.integration.oauthAttempt.cancel",
      "access.integration.connection.resolveCredential",
      "access.integration.connection.getSavedCredential",
      "access.integration.connection.setActive",
      "access.integration.connection.removeCredential",
      "access.credential.get",
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await fetch(`${server.url}/${path}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status).toBe(404);
      }
    }
    expect(service.getIntegration).not.toHaveBeenCalled();
    for (const operation of Object.values(service.oauthAttempt)) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(service.connection.resolveCredential).not.toHaveBeenCalled();
    expect(service.connection.setActive).not.toHaveBeenCalled();
  } finally {
    await server.close();
  }
});

test("maps authorization failures without exposing keys or provider causes", async () => {
  const service = implementation();
  const secret = new Error("private-api-key and provider details");
  service.connection.setApiKey
    .mockReturnValueOnce(
      Effect.fail(new Integration.AuthorizationError({ cause: secret })),
    )
    .mockReturnValueOnce(Effect.die(secret));
  const server = await serve(service);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const expected of [
      { status: 400, message: "Authorization failed" },
      { status: 500, message: "Internal server error" },
    ]) {
      const response = await fetch(
        `${server.url}/access.integration.connection.setApiKey`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ integrationID, key: "private-api-key" }),
        },
      );
      expect(response.status).toBe(expected.status);
      const body = await response.text();
      expect(body).toContain(expected.message);
      expect(body).not.toContain("private-");
      expect(body).not.toContain('"stack"');
      expect(body).not.toContain('"cause"');
    }
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      "Server request failed",
      secret,
    );
  } finally {
    logged.mockRestore();
    await server.close();
  }
});

test("the application has no model API integration", async () => {
  const server = await serve();
  try {
    const response = await fetch(
      `${server.url}/access.integration.listIntegrations`,
    );
    expect(response.status).toBe(200);
    expect(
      await server.client.access.integration.listIntegrations.query(),
    ).toEqual([]);
  } finally {
    await server.close();
  }
});

test("real application HTTP routes save, replace, and remove credentials without exposing secrets", async () => {
  const server = await serve(undefined, {
    integrations: [{ id: integrationID, name: "Example Provider" }],
    methods: [{ integrationID, method: { type: "key" } }],
  });
  const client = server.client.access.integration;
  try {
    expect(await client.listIntegrations.query()).toEqual([
      { ...details, credentialSources: [] },
    ]);
    await client.connection.setApiKey.mutate({
      integrationID,
      key: "private-first-key",
      label: "Work",
    });
    const first = (await client.listIntegrations.query()).find(
      (item) => item.id === integrationID,
    )!.credentialSources[0]!;
    expect(first).toMatchObject({ type: "credential", label: "Work" });
    await client.connection.setApiKey.mutate({
      integrationID,
      key: "private-replacement",
    });
    const second = (await client.listIntegrations.query()).find(
      (item) => item.id === integrationID,
    )!.credentialSources[0]!;
    expect(second.id).not.toBe(first.id);
    const response = await fetch(
      `${server.url}/access.integration.listIntegrations`,
    );
    expect(await response.text()).not.toContain("private-");
    expect(
      (await client.listIntegrations.query()).find(
        (item) => item.id === integrationID,
      )!.credentialSources,
    ).toEqual([second]);
    await client.connection.disconnect.mutate({ integrationID });
    await client.connection.disconnect.mutate({ integrationID });
    expect(
      (await client.listIntegrations.query()).find(
        (item) => item.id === integrationID,
      )!.credentialSources,
    ).toEqual([]);
  } finally {
    await server.close();
  }
});
