// Purpose: Keep the saved-credential encryption key protected by the OS.

import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";

/**
 * Loads the 32-byte key used to encrypt saved credentials, or creates it on
 * first run. Uses asynchronous OS protection so permission prompts do not block
 * Electron. Refreshes the encrypted file when the OS recommends it, keeping the
 * same credential key.
 * Throws if protection is unavailable, the file cannot be decrypted, or the
 * key has the wrong length. Failed writes preserve the existing file and remove
 * temporary files. Never stores an unprotected key. Call after Electron is ready.
 * @example const key = await loadCredentialKey(join(home, 'credential.key'));
 */
export async function loadCredentialKey(file: string): Promise<Uint8Array> {
  // Wait for OS protection without blocking window events or Quit.
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error("Protected credential storage is unavailable");
  const stored = await readFile(file).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return undefined;
    throw cause;
  });
  let key: Buffer;
  if (stored) {
    // Reuse the saved key so credentials remain readable after restarting.
    const { result, shouldReEncrypt } =
      await safeStorage.decryptStringAsync(stored);
    key = Buffer.from(result, "base64");
    if (key.byteLength !== 32)
      throw new Error("Credential key file is corrupt");
    if (!shouldReEncrypt) return key;
    // Refresh OS protection around the same key; saved credentials still use it.
  } else key = randomBytes(32);
  const encrypted = await safeStorage.encryptStringAsync(
    key.toString("base64"),
  );
  const staging = `${file}.${randomUUID()}`;
  // Replace only with a complete encrypted file, preserving the old one on failure.
  try {
    await writeFile(staging, encrypted, { mode: 0o600 });
    await rename(staging, file);
  } finally {
    await rm(staging, { force: true });
  }
  return key;
}
