// Purpose: Exercise real local billing HTTP, account isolation, cancellation, and public errors.
import { temporaryHome } from "@openchart/server/home.test-utils";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequestHandler, type AppRouter } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { Auth } from "@openchart/server/access/auth";
import { Integration } from "@openchart/server/access/integration";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { createTRPCClient, httpLink } from "@trpc/client";
import { onTestFinished, expect, test, vi } from "vitest";
import { Billing } from "./billing";
import { Cause, Effect } from "effect";

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const active = {
  status: "active",
  planId: "openchart",
  interval: "month",
  currentPeriodStart: "2026-09-15T00:00:00.000Z",
  currentPeriodEnd: "2026-10-15T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
};
const identity = (key: string) => ({
  apiKeyID: `id:${key}`,
  key,
  user: { id: key, firstName: "Test", lastName: "", email: "test@example.com" },
});
const json = (response: ServerResponse, body: unknown, status = 200) => {
  response
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(body));
};
async function fixture(
  options: { configured?: boolean; timeout?: number } = {},
) {
  const requests: { path: string; key: string | undefined; body: string }[] =
    [];
  let handle = (_request: IncomingMessage, response: ServerResponse) =>
    json(response, { status: "none" });
  const cloud = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      path: request.url!,
      key: request.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    });
    handle(request, response);
  });
  cloud.listen(0, "127.0.0.1");
  await once(cloud, "listening");
  const address = cloud.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    credentialEncryption: jweEncryption(randomBytes(32)),
    integrations: {
      methods: [
        OPENCHART_CLOUD,
        {
          integrationID: Integration.IntegrationID.make("billing-unrelated"),
          method: { type: "key" },
        },
      ],
    },
    auth: { integrationID: OPENCHART_CLOUD.integrationID },
    billing:
      options.configured === false
        ? undefined
        : { baseUrl, requestTimeoutMs: options.timeout ?? 2000 },
    models: {
      fetchEnabled: false,
      userAgent: "OpenChart/Billing test",
    },
  });
  const local = createServer(createRequestHandler(runtime));
  local.listen(0, "127.0.0.1");
  await once(local, "listening");
  const localAddress = local.address();
  if (!localAddress || typeof localAddress === "string")
    throw new Error("No local port");
  const url = `http://127.0.0.1:${localAddress.port}/trpc`;
  onTestFinished(async () => {
    local.closeAllConnections();
    cloud.closeAllConnections();
    await Promise.all(
      [local, cloud].map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    await runtime.dispose();
  });
  const auth = await runtime.runPromise(Auth.Service);
  const billing = await runtime.runPromise(Billing.Service);
  return {
    runtime,
    billing,
    requests,
    baseUrl,
    url,
    client: createTRPCClient<AppRouter>({ links: [httpLink({ url })] }).access
      .billing,
    reply: (handler: typeof handle) => {
      handle = handler;
    },
    signIn: (key = "private-first") =>
      runtime.runPromise(auth.completeSignIn(identity(key))),
    logout: () => runtime.runPromise(auth.logout()),
  };
}

test("all three routes use the Integration key and cloud shapes; requests never carry caller identity", async () => {
  const f = await fixture();
  await f.signIn();
  f.reply((request, response) =>
    json(
      response,
      request.url === "/billing/subscription"
        ? active
        : { url: "https://checkout.stripe.com/c/pay/test" },
    ),
  );
  expect(await f.client.getSubscription.query()).toEqual(active);
  expect(
    await f.client.createCheckout.mutate({
      planId: "openchart",
      interval: "month",
    }),
  ).toEqual({ url: "https://checkout.stripe.com/c/pay/test" });
  await f.client.createPortal.mutate();
  expect(f.requests).toEqual([
    { path: "/billing/subscription", key: "Bearer private-first", body: "" },
    {
      path: "/billing/checkout",
      key: "Bearer private-first",
      body: '{"planId":"openchart","interval":"month"}',
    },
    { path: "/billing/portal", key: "Bearer private-first", body: "" },
  ]);
  const response = await fetch(`${f.url}/access.billing.createCheckout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planId: "openchart",
      interval: "month",
      customerId: "private-customer",
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("private-customer");
  expect(f.requests).toHaveLength(3);
});

test("missing credentials and unconfigured hosts fail without contacting cloud", async () => {
  for (const configured of [true, false]) {
    const f = await fixture({ configured });
    await expect(
      f.runtime.runPromise(f.billing.getSubscription()),
    ).rejects.toMatchObject({
      reason: configured ? "missing-credential" : "not-configured",
    });
    expect(f.requests).toHaveLength(0);
  }
});

test("referrals preserve none and route current-account operations with strict input", async () => {
  const f = await fixture();
  await f.signIn();
  const code = "ABC123";
  const access = {
    canAccess: true,
    complimentaryAccessUntil: "2026-11-02T00:00:00.000Z",
  };
  const referrals = {
    canInvite: false,
    codes: [],
    redeemedCode: code,
  };
  const methods: string[] = [];
  f.reply((request, response) => {
    methods.push(request.method!);
    json(
      response,
      request.url === "/billing/subscription"
        ? { status: "none" }
        : request.url === "/billing/referrals"
          ? referrals
          : access,
    );
  });
  expect(await f.client.getAccess.query()).toEqual(access);
  expect(await f.client.getReferrals.query()).toEqual(referrals);
  expect(await f.client.issueReferrals.mutate()).toEqual(referrals);
  expect(await f.client.redeemReferral.mutate({ code })).toEqual(access);
  expect(await f.client.getSubscription.query()).toEqual({ status: "none" });
  expect(methods).toEqual(["GET", "GET", "POST", "POST", "GET"]);
  expect(f.requests.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/billing/access", body: "" },
    { path: "/billing/referrals", body: "" },
    { path: "/billing/referrals", body: "" },
    { path: "/billing/referrals/redeem", body: JSON.stringify({ code }) },
    { path: "/billing/subscription", body: "" },
  ]);
  expect(
    f.requests.every((request) => request.key === "Bearer private-first"),
  ).toBe(true);
  const rejected = await fetch(`${f.url}/access.billing.redeemReferral`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, userId: "someone-else" }),
  });
  expect(rejected.status).toBe(400);
  expect(f.requests).toHaveLength(5);
});

test.each([
  [400, "referral_invalid", "referral-invalid"],
  [409, "referral_used", "referral-used"],
  [409, "referral_already_redeemed", "referral-already-redeemed"],
  [400, "referral_self", "referral-self"],
  [409, "subscription_required", "subscription-required"],
  [401, "unauthorized", "unauthorized"],
  [429, "anything", "rate-limited"],
  [409, "subscription_exists", "already-subscribed"],
  [409, "checkout_in_progress", "checkout-in-progress"],
  [409, "checkout_changed", "checkout-changed"],
  [400, "unsupported_plan", "invalid-plan"],
  [404, "customer_not_found", "customer-not-found"],
  [502, "upstream_unavailable", "provider"],
  [500, "unexpected-provider-secret", "provider"],
])(
  "cloud %i/%s remains a safe failure, never none",
  async (status, code, reason) => {
    const f = await fixture();
    await f.signIn();
    f.reply((_request, response) =>
      json(
        response,
        { error: { code, message: "private-upstream-payload" } },
        status,
      ),
    );
    await expect(
      f.runtime.runPromise(f.billing.getSubscription()),
    ).rejects.toMatchObject({ reason });
    const response = await fetch(`${f.url}/access.billing.getSubscription`);
    expect(response.ok).toBe(false);
    const body = await response.text();
    expect(body).not.toContain("private-");
    expect(body).not.toContain('"stack"');
    expect(body).not.toContain('"status":"none"');
  },
);

test("malformed subscription and hosted links fail instead of reaching the renderer", async () => {
  const f = await fixture();
  await f.signIn();
  for (const body of [
    { status: "unknown" },
    { ...active, currentPeriodEnd: "not-a-date" },
    { ...active, cancelAt: undefined },
    { ...active, secret: "private-value" },
  ]) {
    f.reply((_request, response) => json(response, body));
    await expect(
      f.runtime.runPromise(f.billing.getSubscription()),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  }
  for (const url of [
    "http://checkout.stripe.com",
    "javascript:alert(1)",
    "https://user:pass@checkout.stripe.com",
  ]) {
    f.reply((_request, response) => json(response, { url }));
    await expect(
      f.runtime.runPromise(f.billing.createPortal()),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  }
});

test.each(
  (["query", "checkout", "portal"] as const).flatMap((kind) =>
    [false, true].map((switchAccount) => ({ kind, switchAccount })),
  ),
)(
  "rejects a late $kind result after logout (switchAccount=$switchAccount)",
  async ({ kind, switchAccount }) => {
    const f = await fixture();
    await f.signIn();
    const arrived = latch();
    let release!: () => void;
    f.reply((_request, response) => {
      release = () =>
        json(
          response,
          kind === "query"
            ? active
            : {
                url: "https://billing.stripe.com/p/session/test",
              },
        );
      arrived.resolve();
    });
    const operation: Effect.Effect<
      Billing.Subscription | Billing.HostedLink,
      Billing.Error
    > =
      kind === "query"
        ? f.billing.getSubscription()
        : kind === "portal"
          ? f.billing.createPortal()
          : f.billing.createCheckout({
              planId: "openchart",
              interval: "month",
            });
    const pending = f.runtime.runPromise(operation);
    const rejected = expect(pending).rejects.toMatchObject({
      reason: switchAccount ? "credential-changed" : "missing-credential",
    });
    await arrived.promise;
    await f.logout();
    if (switchAccount) await f.signIn("private-second");
    release();
    await rejected;
    if (!switchAccount) await f.signIn("private-second");
    f.reply((_request, response) => json(response, { status: "none" }));
    expect(await f.client.getSubscription.query()).toEqual({ status: "none" });
    expect(f.requests.at(-1)?.key).toBe("Bearer private-second");
  },
);

test("caller abort and response-body timeout close the outbound connection", async () => {
  const f = await fixture({ timeout: 150 });
  await f.signIn();
  for (const callerAbort of [true, false]) {
    const arrived = latch();
    const closed = latch();
    f.reply((_request, response) => {
      response.on("close", () => closed.resolve());
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
      arrived.resolve();
    });
    const controller = new AbortController();
    const pending = f.runtime.runPromise(f.billing.getSubscription(), {
      signal: controller.signal,
    });
    const rejected = callerAbort
      ? expect(pending).rejects.toBeDefined()
      : expect(pending).rejects.toMatchObject({ reason: "timeout" });
    await arrived.promise;
    if (callerAbort) controller.abort();
    await rejected;
    await closed.promise;
  }
});

test("redirects are rejected before forwarding the account credential", async () => {
  const f = await fixture();
  await f.signIn();
  const followed = vi.fn();
  f.reply((request, response) => {
    if (request.url === "/leak") {
      followed();
      json(response, { status: "none" });
    } else response.writeHead(302, { Location: `${f.baseUrl}/leak` }).end();
  });
  await expect(
    f.runtime.runPromise(f.billing.getSubscription()),
  ).rejects.toMatchObject({ reason: "network" });
  expect(followed).not.toHaveBeenCalled();
});

test("unrelated provider credential updates do not cancel current-account billing", async () => {
  const f = await fixture();
  await f.signIn();
  const arrived = latch();
  let release!: () => void;
  f.reply((_request, response) => {
    release = () => json(response, { status: "none" });
    arrived.resolve();
  });
  const completed = expect(
    f.runtime.runPromise(f.billing.getSubscription()),
  ).resolves.toEqual({ status: "none" });
  await arrived.promise;
  const integration = await f.runtime.runPromise(Integration.Service);
  await f.runtime.runPromise(
    integration.connection.setApiKey({
      integrationID: Integration.IntegrationID.make("billing-unrelated"),
      key: "private-third-party",
    }),
  );
  release();
  await completed;
});

test.each([
  [401, "unauthorized"],
  [429, "rate-limited"],
] as const)(
  "HTTP %i closes its unread response body",
  async (status, reason) => {
    const f = await fixture();
    await f.signIn();
    const closed = latch();
    f.reply((_request, response) => {
      response.on("close", closed.resolve);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.write("{");
    });
    await expect(
      f.runtime.runPromise(f.billing.getSubscription()),
    ).rejects.toMatchObject({ reason });
    await closed.promise;
  },
);

test.each([false, true])(
  "runtime disposal interrupts the request and closes HTTP (headersSent=%s)",
  async (headersSent) => {
    const f = await fixture();
    await f.signIn();
    const arrived = latch();
    const closed = latch();
    f.reply((_request, response) => {
      response.on("close", closed.resolve);
      if (headersSent) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write("{");
      }
      arrived.resolve();
    });
    const pending = f.runtime.runPromiseExit(f.billing.getSubscription());
    await arrived.promise;
    await f.runtime.dispose();
    const exit = await pending;
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure")
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    await closed.promise;
  },
);
