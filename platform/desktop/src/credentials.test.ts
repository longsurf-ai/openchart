// Purpose: Verify the credential key file is created once, protected by safeStorage, and never plaintext.

import {
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeStorage } from "electron";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const vault = vi.hoisted(() => ({
  available: true,
  backend: "gnome_libsecret",
  version: 1,
  shouldReEncrypt: false,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
vi.mock("electron", () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => vault.available),
    getSelectedStorageBackend: () => vault.backend,
    encryptStringAsync: vi.fn(async (value: string) =>
      Buffer.from(
        `cipher:${vault.version}:${Buffer.from(value).toString("base64")}`,
      ),
    ),
    decryptStringAsync: vi.fn(async (value: Buffer) => {
      const match = /^cipher:\d+:(.*)$/.exec(value.toString());
      if (!match) throw new Error("Error while decrypting the ciphertext");
      return {
        result: Buffer.from(match[1]!, "base64").toString(),
        shouldReEncrypt: vault.shouldReEncrypt,
      };
    }),
  },
}));
import { loadCredentialKey } from "./credentials";

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openchart-credential-"));
  file = join(directory, "credential.key");
});
afterEach(async () => {
  vault.available = true;
  vault.backend = "gnome_libsecret";
  vault.version = 1;
  vault.shouldReEncrypt = false;
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

test("creates a protected 32-byte key once and reloads the same key", async () => {
  const key = Buffer.from(await loadCredentialKey(file));
  expect(key.byteLength).toBe(32);
  expect(Buffer.from(await loadCredentialKey(file))).toEqual(key);
  const stored = await readFile(file);
  expect(stored.toString()).toMatch(/^cipher:/);
  expect(stored.includes(key)).toBe(false);
  for (const encoding of ["base64", "base64url", "hex"] as const)
    expect(stored.includes(key.toString(encoding))).toBe(false);
  expect(await readdir(directory)).toEqual(["credential.key"]);
  if (process.platform !== "win32")
    expect((await stat(file)).mode & 0o777).toBe(0o600);
});

test("rejects a file that does not decrypt to a 32-byte key", async () => {
  await writeFile(file, "not a safeStorage ciphertext");
  await expect(loadCredentialKey(file)).rejects.toThrow("decrypting");
  await writeFile(
    file,
    `cipher:1:${Buffer.from(Buffer.alloc(5).toString("base64")).toString("base64")}`,
  );
  await expect(loadCredentialKey(file)).rejects.toThrow("corrupt");
});

test("fails without protected storage, including Linux basic_text, and writes nothing", async () => {
  vault.available = false;
  await expect(loadCredentialKey(file)).rejects.toThrow(
    "Protected credential storage",
  );
  vault.available = true;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "linux" });
  vault.backend = "basic_text";
  try {
    await expect(loadCredentialKey(file)).rejects.toThrow(
      "Protected credential storage",
    );
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
  expect(await readdir(directory)).toEqual([]);
});

test("refreshes OS protection without replacing the credential key", async () => {
  const key = await loadCredentialKey(file);
  const original = await readFile(file);
  vault.version = 2;
  vault.shouldReEncrypt = true;
  expect(await loadCredentialKey(file)).toEqual(key);
  expect(await readFile(file)).not.toEqual(original);
  vault.shouldReEncrypt = false;
  expect(await loadCredentialKey(file)).toEqual(key);
  expect(await readdir(directory)).toEqual(["credential.key"]);
});

test.each([
  "isAsyncEncryptionAvailable",
  "decryptStringAsync",
  "encryptStringAsync",
] as const)(
  "rejects failed %s without losing the saved key",
  async (method) => {
    const key = await loadCredentialKey(file);
    const original = await readFile(file);
    vault.shouldReEncrypt = true;
    vi.mocked(safeStorage[method]).mockRejectedValueOnce(
      new Error("Access denied"),
    );
    await expect(loadCredentialKey(file)).rejects.toThrow("Access denied");
    expect(await readFile(file)).toEqual(original);
    expect(await readdir(directory)).toEqual(["credential.key"]);
    vault.shouldReEncrypt = false;
    expect(await loadCredentialKey(file)).toEqual(key);
  },
);

test("writes nothing when first-run encryption is denied", async () => {
  vi.mocked(safeStorage.encryptStringAsync).mockRejectedValueOnce(
    new Error("Access denied"),
  );
  await expect(loadCredentialKey(file)).rejects.toThrow("Access denied");
  expect(await readdir(directory)).toEqual([]);
});

test("keeps the old ciphertext and removes staging when replacement fails", async () => {
  const key = await loadCredentialKey(file);
  const original = await readFile(file);
  vault.shouldReEncrypt = true;
  vi.mocked(rename).mockRejectedValueOnce(new Error("Rename failed"));
  await expect(loadCredentialKey(file)).rejects.toThrow("Rename failed");
  expect(await readFile(file)).toEqual(original);
  expect(await readdir(directory)).toEqual(["credential.key"]);
  vault.shouldReEncrypt = false;
  expect(await loadCredentialKey(file)).toEqual(key);
});
