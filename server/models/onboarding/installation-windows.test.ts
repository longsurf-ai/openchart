// Purpose: Exercises the Windows ZIP installation transaction while replacing only native executable launch and lock timing.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createInstallations } from "./installation";
import { zipFixture } from "./zip.test-utils";

const native = vi.hoisted(() => ({ execute: vi.fn(), rename: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: native.execute,
  }),
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: (...args: Parameters<typeof fs.rename>) => native.rename(...args),
  };
});

const cleanups: (() => Promise<void>)[] = [];
beforeEach(async () => {
  native.execute
    .mockReset()
    .mockResolvedValue({ stdout: "1.2.16\n", stderr: "" });
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  native.rename.mockReset().mockImplementation(fs.rename);
});
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "openchart-win-install-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const bytes = zipFixture([
    { name: "antigravity.exe", body: "fixture executable" },
  ]);
  const server = createServer((_request, response) => response.end(bytes));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture failed");
  const pin = {
    version: "1.2.16",
    url: `http://127.0.0.1:${address.port}/runtime.zip`,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    layout: "flat" as const,
    archive: "zip" as const,
    executable: "antigravity.exe",
  };
  const runtime = createInstallations(
    root,
    { codex: {}, "claude-code": {}, antigravity: { "win32-x64": pin } },
    "win32-x64",
  );
  return { root, runtime };
}

test("verifies the Windows ZIP and version, hides the console, and atomically publishes once", async () => {
  const f = await fixture();
  await f.runtime.install(
    "antigravity",
    new AbortController().signal,
    () => {},
  );
  expect(await f.runtime.installed("antigravity")).toBe(true);
  expect(await readFile(f.runtime.executables.antigravity, "utf8")).toBe(
    "fixture executable",
  );
  expect(native.execute).toHaveBeenCalledWith(
    expect.stringContaining("antigravity.exe"),
    ["--version"],
    expect.objectContaining({
      windowsHide: true,
      timeout: 10_000,
      env: expect.objectContaining({ AGY_CLI_DISABLE_AUTO_UPDATE: "true" }),
    }),
  );
  await f.runtime.install(
    "antigravity",
    new AbortController().signal,
    () => {},
  );
  expect(native.execute).toHaveBeenCalledOnce();
  expect(native.rename).toHaveBeenCalledOnce();
});

test("a wrong native version never publishes and cleans the complete download", async () => {
  const f = await fixture();
  native.execute.mockResolvedValue({ stdout: "9.9.9\n" });
  await expect(
    f.runtime.install("antigravity", new AbortController().signal, () => {}),
  ).rejects.toThrow("Expected provider version 1.2.16");
  expect(native.rename).not.toHaveBeenCalled();
  expect(await readdir(path.join(f.root, "antigravity", "win32-x64"))).toEqual(
    [],
  );
});

test.each(["EPERM", "EBUSY", "EACCES"])(
  "retries a transient Windows %s publish lock",
  async (code) => {
    const f = await fixture();
    native.rename.mockRejectedValueOnce(
      Object.assign(new Error("locked"), { code }),
    );
    await f.runtime.install(
      "antigravity",
      new AbortController().signal,
      () => {},
    );
    expect(native.rename).toHaveBeenCalledTimes(2);
    expect(await f.runtime.installed("antigravity")).toBe(true);
  },
);

test("permanent rename failures preserve failure and clean up without retry", async () => {
  const f = await fixture();
  native.rename.mockRejectedValue(
    Object.assign(new Error("disk error"), { code: "EIO" }),
  );
  await expect(
    f.runtime.install("antigravity", new AbortController().signal, () => {}),
  ).rejects.toThrow("disk error");
  expect(native.rename).toHaveBeenCalledOnce();
  expect(await readdir(path.join(f.root, "antigravity", "win32-x64"))).toEqual(
    [],
  );
});

test("cancellation interrupts transient rename backoff and awaits directory cleanup", async () => {
  const f = await fixture();
  const controller = new AbortController();
  native.rename.mockImplementation(() => {
    controller.abort();
    return Promise.reject(
      Object.assign(new Error("locked"), { code: "EBUSY" }),
    );
  });
  await expect(
    f.runtime.install("antigravity", controller.signal, () => {}),
  ).rejects.toThrow();
  expect(native.rename).toHaveBeenCalledOnce();
  expect(await readdir(path.join(f.root, "antigravity", "win32-x64"))).toEqual(
    [],
  );
});
