// Purpose: Verify the Electron backend's key handoff, encrypted persistence, and lifetime without a live login.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@openchart/server/contract";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("..", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "openchart-access-runtime-"));
let subscription: unknown = { status: "none" };
let billingQueries = 0;
const cloud = createServer((request, response) => {
  assert.equal(request.headers.authorization, "Bearer ak_test_backend_smoke");
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/billing/subscription") {
    billingQueries++;
    response.end(JSON.stringify(subscription));
  } else {
    response.end(
      JSON.stringify({
        url:
          request.url === "/billing/checkout"
            ? "https://checkout.stripe.com/c/pay/smoke"
            : "https://billing.stripe.com/p/session/smoke",
      }),
    );
  }
});
cloud.listen(0, "127.0.0.1");
await once(cloud, "listening");
const cloudAddress = cloud.address();
assert(cloudAddress && typeof cloudAddress !== "string");
const config = join(profile, "clerk.json");
// This test supplies the result of SDK login through the real local API.
// Clerk UI and Google OAuth require a separate live smoke test.
await writeFile(
  config,
  JSON.stringify({
    billingUrl: `http://127.0.0.1:${cloudAddress.port}`,
    publishableKey: `pk_test_${Buffer.from("smoke.clerk.accounts.dev$").toString("base64")}`,
  }),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
delete env.ELECTRON_RENDERER_URL;
env.OPENCHART_CLERK_CONFIG = config;
let application: ElectronApplication | undefined;
const input = {
  key: "ak_test_backend_smoke",
  apiKeyID: "ak_test_backend_smoke_id",
  user: {
    id: "user_smoke",
    firstName: "A",
    lastName: "User",
    email: "a@example.com",
  },
};
async function launch() {
  application = await _electron.launch({
    executablePath: require("electron") as string,
    args: [directory, `--user-data-dir=${profile}`],
    env,
  });
  await application.evaluate(({ session, shell }) => {
    // Observe the narrow browser capability without opening external test URLs.
    (
      globalThis as typeof globalThis & { billingLinks: string[] }
    ).billingLinks = [];
    shell.openExternal = async (url) => {
      (
        globalThis as typeof globalThis & { billingLinks: string[] }
      ).billingLinks.push(url);
    };
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["https://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
  });
  const page = await application.firstWindow({ timeout: 15_000 });
  await page.waitForLoadState();
  const endpoint = await page.evaluate(() => window.accessDemo.serverURL);
  const client = createTRPCClient<AppRouter>({
    links: [httpLink({ url: endpoint })],
  });
  return { page, endpoint, client };
}
try {
  let { page, endpoint, client } = await launch();
  assert.deepEqual(await client.access.auth.getState.query(), {
    status: "signed-out",
  });
  await client.access.auth.completeSignIn.mutate(input);
  const signedIn = { status: "signed-in", user: input.user };
  assert.deepEqual(await client.access.auth.getState.query(), signedIn);
  await page.getByText(input.user.email, { exact: true }).waitFor();
  await page.getByText("No subscription", { exact: true }).waitFor();
  assert(application);
  for (const value of [
    "file:///tmp/test",
    "https://evil.example",
    "https://checkout.stripe.com.evil.example",
    "https://user:pass@checkout.stripe.com",
  ]) {
    assert.equal(
      await page.evaluate(async (url) => {
        try {
          await window.accessDemo.openBilling(url);
          return false;
        } catch {
          return true;
        }
      }, value),
      true,
    );
  }
  await page
    .getByRole("button", { name: "Subscribe to OpenChart monthly" })
    .click();
  await page.getByText("Finish in your browser", { exact: false }).waitFor();
  assert.deepEqual(
    await application.evaluate(
      () =>
        (globalThis as typeof globalThis & { billingLinks: string[] })
          .billingLinks,
    ),
    ["https://checkout.stripe.com/c/pay/smoke"],
  );
  // Opening Checkout alone leaves the confirmed state unchanged.
  await page.getByText("No subscription", { exact: true }).waitFor();
  subscription = {
    status: "active",
    planId: "openchart",
    interval: "month",
    currentPeriodStart: "2026-09-15T00:00:00.000Z",
    currentPeriodEnd: "2026-10-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    cancelAt: null,
  };
  await application.evaluate(({ app }) =>
    app.emit("open-url", { preventDefault() {} }, "openchart://billing/return"),
  );
  await page.getByText("Active", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Manage subscription" }).click();
  await page.getByRole("button", { name: "Manage subscription" }).waitFor();
  subscription = {
    ...(subscription as object),
    cancelAtPeriodEnd: true,
    cancelAt: "2026-10-15T00:00:00.000Z",
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("Scheduled to end", { exact: false }).waitFor();
  assert(billingQueries >= 3);

  const runtime = await application.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .find((item) => item.name === "OpenChart Access Demo Server"),
  );
  assert(runtime && runtime.pid !== application.process().pid);
  await access(join(profile, "home", "openchart.sqlite3"));
  assert.equal(
    (
      await fetch(`${endpoint}/access.auth.getState`, {
        headers: { Origin: "https://example.invalid" },
      })
    ).status,
    403,
  );
  assert.deepEqual(
    await page.evaluate("({require: typeof require, process: typeof process})"),
    {
      require: "undefined",
      process: "undefined",
    },
  );
  await page.reload();
  assert.deepEqual(await client.access.auth.getState.query(), signedIn);
  if (process.platform === "darwin") {
    await page.close();
    assert.deepEqual(await client.access.auth.getState.query(), signedIn);
    await application.evaluate(({ app }) =>
      app.emit(
        "open-url",
        { preventDefault() {} },
        "openchart://billing/return",
      ),
    );
    page = await application.firstWindow();
    await page.waitForLoadState();
    assert.equal(
      await page.evaluate(() => window.accessDemo.serverURL),
      endpoint,
    );
  }
  const stoppingAt = Date.now();
  await application.close();
  application = undefined;
  assert(
    Date.now() - stoppingAt < 4500,
    "Shutdown must finish before forced termination",
  );
  await assert.rejects(fetch(`${endpoint}/echo`));
  assert.throws(() => process.kill(runtime.pid, 0));
  const stored = await readFile(join(profile, "home", "openchart.sqlite3"));
  for (const secret of [input.key, input.user.email])
    assert(!stored.includes(Buffer.from(secret)));
  ({ page, endpoint, client } = await launch());
  assert.deepEqual(await client.access.auth.getState.query(), signedIn);
  await page.getByText(input.user.email, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByText(input.user.email, { exact: true })
    .waitFor({ state: "hidden" });
  assert.deepEqual(await client.access.auth.getState.query(), {
    status: "signed-out",
  });
  console.log(
    "Access demo smoke passed: key handoff, safeStorage, billing checkout/portal, return/focus refresh, URL rejection, renderer closure, restart, logout, isolation, and process cleanup",
  );
} finally {
  if (application) {
    const child = application.process();
    const deadline = setTimeout(() => child.kill("SIGKILL"), 1500);
    try {
      await application.close();
    } finally {
      clearTimeout(deadline);
    }
  }
  cloud.closeAllConnections();
  await new Promise<void>((resolve) => cloud.close(() => resolve()));
  await rm(profile, { recursive: true, force: true });
}
