// Purpose: Verify Desktop renderer development and build-time Clerk configuration.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, test } from "vitest";

test("serves the Desktop renderer over its configured loopback HTTP port", async () => {
  const root = dirname(
    createRequire(import.meta.url).resolve("@openchart/app/package.json"),
  );
  const cacheDir = await mkdtemp(join(tmpdir(), "openchart-vite-"));
  const shared = {
    root,
    configFile: join(root, "vite.config.ts"),
    cacheDir,
    logLevel: "silent" as const,
  };
  const desktop = await createServer({
    ...shared,
    server: { host: "127.0.0.1", port: 43875, strictPort: false, open: false },
  });
  try {
    expect(desktop.config.server.https).toBeUndefined();
    expect(desktop.config.server.port).toBe(43875);
    expect(desktop.config.server.strictPort).toBe(false);
    await desktop.listen();
    const address = desktop.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP port");
    expect(address.port).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${address.port}/`)).status).toBe(200);
    expect(desktop.config.env.VITE_APP_CLERK_PUBLISHABLE_KEY).toMatch(
      /^pk_test_/,
    );
  } finally {
    await desktop.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test.each(["", "pk_test_ZXhhbXBsZS5jb20k", "sk_live_invalid"])(
  "release builds reject an absent or non-production publishable key: %s",
  async (key) => {
    const desktop = dirname(
      createRequire(import.meta.url).resolve("@openchart/desktop/package.json"),
    );
    await expect(
      promisify(execFile)(
        process.execPath,
        [join(desktop, "scripts/tooling.ts"), "build"],
        {
          env: { ...process.env, VITE_APP_CLERK_PUBLISHABLE_KEY: key },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "VITE_APP_CLERK_PUBLISHABLE_KEY must be a pk_live_ publishable key",
      ),
    });
  },
);

test.each(["build", "package"])(
  "%s with development configuration requires a test key",
  async (command) => {
    const desktop = dirname(
      createRequire(import.meta.url).resolve("@openchart/desktop/package.json"),
    );
    await expect(
      promisify(execFile)(
        process.execPath,
        [join(desktop, "scripts/tooling.ts"), command, "development"],
        {
          env: {
            ...process.env,
            VITE_APP_CLERK_PUBLISHABLE_KEY: "pk_live_ZXhhbXBsZS5jb20k",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "VITE_APP_CLERK_PUBLISHABLE_KEY must be a pk_test_ publishable key",
      ),
    });
  },
);
