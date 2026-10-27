// Purpose: Verify browser token binding, secret-free results and validated session persistence.

import { createHash } from "node:crypto";
import { Credential } from "@openchart/server/access/credential";
import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import { Integration } from "./integration";
import { run } from "./test-fixture";
import { tradingViewBrowserMethod, tradingViewLoginToken } from "./tradingview";

const link = "tradingview://browser-auth/?token=one-time-token";
const homepage =
  '<script>var user = {"username":"alice","auth_token":"chart-token","pro_plan":"pro_premium","is_pro":true};</script>';

function acceptedSession() {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "sessionid=private-session; Domain=.tradingview.com; Path=/; HttpOnly; Secure",
  );
  headers.append(
    "set-cookie",
    "sessionid_sign=private-signature; Domain=.tradingview.com; Path=/; HttpOnly; Secure",
  );
  headers.append("set-cookie", "unrelated=ignored; Path=/");
  headers.append(
    "set-cookie",
    "device_t=private-device; Domain=.tradingview.com; Path=/; HttpOnly; Secure",
  );
  return new Response("{}", { headers });
}

test("a browser attempt binds its copied token to a backend-only verifier and persists only after profile validation", async () => {
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return requests.length === 1 ? acceptedSession() : new Response(homepage);
  };
  const method = tradingViewBrowserMethod(fetcher);
  await run(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service;
      const attempt = yield* integrations.oauthAttempt.start({
        integrationID: method.integrationID,
        methodID: method.method.id,
        inputs: {},
      });
      const browser = new URL(attempt.url);
      expect(browser.origin).toBe("https://auth.tradingview.com");
      expect(browser.pathname).toBe("/accounts/tvd/connect/");
      expect(browser.searchParams.get("redirect_url")).toBe(
        "tradingview://browser-auth/",
      );
      expect(browser.searchParams.has("key_source")).toBe(false);
      expect(attempt.mode).toBe("code");
      expect(requests).toHaveLength(0);
      yield* integrations.oauthAttempt.complete({
        attemptID: attempt.attemptID,
        code: link,
      });
      expect(
        yield* integrations.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "complete" });
      const [exchange, profile] = requests;
      expect(exchange!.url.origin).toBe("https://auth.tradingview.com");
      expect(exchange!.url.pathname).toBe("/accounts/tvd/complete/");
      expect(exchange!.url.searchParams.get("token")).toBe("one-time-token");
      const verifier = exchange!.url.searchParams.get("key_source")!;
      expect(createHash("sha256").update(verifier).digest("hex")).toBe(
        browser.searchParams.get("key"),
      );
      expect(exchange!.init).toMatchObject({
        method: "POST",
        redirect: "error",
      });
      expect(exchange!.init?.signal).toBeInstanceOf(AbortSignal);
      expect(profile!.url.href).toBe("https://www.tradingview.com/");
      expect(new Headers(profile!.init?.headers).get("cookie")).toBe(
        "sessionid=private-session; sessionid_sign=private-signature; device_t=private-device",
      );
      const saved = yield* integrations.connection.resolveCredential(
        method.integrationID,
      );
      expect(saved).toMatchObject({
        type: "oauth",
        access: JSON.stringify({
          sessionid: "private-session",
          sessionid_sign: "private-signature",
          device_t: "private-device",
        }),
        metadata: { username: "alice" },
      });
      const visible = yield* integrations.listIntegrations();
      expect(visible[0]?.credentialSources[0]?.label).toBe("alice");
      expect(JSON.stringify({ attempt, visible })).not.toContain(
        "private-session",
      );
      expect(JSON.stringify({ attempt, visible })).not.toContain(verifier);
    }),
    { methods: [method] },
  );
});

test.each([
  "https://example.com/?token=private-token",
  "tradingview://browser-auth/?token=one&token=two",
  "tradingview://browser-auth/?token=one&redirect_url=https://example.com",
  "tradingview://other/?token=one",
  "tradingview://user:password@browser-auth/?token=one",
  "tradingview://browser-auth/?token=",
  "tradingview://browser-auth/?token=one#fragment",
  "tradingview://browser-auth/?token=bad%0Atoken",
])("invalid callback %s never becomes an arbitrary request", (value) => {
  expect(() => tradingViewLoginToken(value)).toThrow("Paste the login link");
  try {
    tradingViewLoginToken(value);
  } catch (error) {
    expect(String(error)).not.toContain(value);
  }
});

test("an unusable returned session preserves the previous connection", async () => {
  const fetcher: typeof fetch = async (input) =>
    String(input).includes("/complete/")
      ? acceptedSession()
      : new Response('<script>var user = {"username":"Guest"};</script>');
  const method = tradingViewBrowserMethod(fetcher);
  await run(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const previous = Credential.OAuth.make({
        type: "oauth",
        methodID: method.method.id,
        access: JSON.stringify({ sessionid: "previous-session" }),
        refresh: "",
        expires: 0,
      });
      yield* credentials.create({
        integrationID: method.integrationID,
        value: previous,
      });
      const attempt = yield* integrations.oauthAttempt.start({
        integrationID: method.integrationID,
        methodID: method.method.id,
        inputs: {},
      });
      yield* Effect.flip(
        integrations.oauthAttempt.complete({
          attemptID: attempt.attemptID,
          code: link,
        }),
      );
      expect(
        yield* integrations.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "failed" });
      expect(
        yield* integrations.connection.resolveCredential(method.integrationID),
      ).toEqual(previous);
    }),
    { methods: [method] },
  );
});

test("HTTP failures cannot expose the copied token or verifier in retained attempt state", async () => {
  const method = tradingViewBrowserMethod(async (input) => {
    throw new Error(`Network failure for ${String(input)}`);
  });
  await run(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service;
      const attempt = yield* integrations.oauthAttempt.start({
        integrationID: method.integrationID,
        methodID: method.method.id,
        inputs: {},
      });
      yield* Effect.flip(
        integrations.oauthAttempt.complete({
          attemptID: attempt.attemptID,
          code: link,
        }),
      );
      const state = yield* integrations.oauthAttempt.getStatus(
        attempt.attemptID,
      );
      expect(state.status).toBe("failed");
      expect(JSON.stringify(state)).not.toContain("one-time-token");
      expect(JSON.stringify(state)).not.toContain("key_source");
      expect(
        yield* integrations.connection.resolveCredential(method.integrationID),
      ).toBeUndefined();
    }),
    { methods: [method] },
  );
});

test("cancelling a browser attempt prevents its copied link from making HTTP requests", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const method = tradingViewBrowserMethod(fetcher);
  await run(
    Effect.gen(function* () {
      const integrations = yield* Integration.Service;
      const attempt = yield* integrations.oauthAttempt.start({
        integrationID: method.integrationID,
        methodID: method.method.id,
        inputs: {},
      });
      yield* integrations.oauthAttempt.cancel(attempt.attemptID);
      const exit = yield* Effect.exit(
        integrations.oauthAttempt.complete({
          attemptID: attempt.attemptID,
          code: link,
        }),
      );
      expect(exit._tag).toBe("Failure");
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        yield* integrations.connection.resolveCredential(method.integrationID),
      ).toBeUndefined();
    }),
    { methods: [method] },
  );
});
