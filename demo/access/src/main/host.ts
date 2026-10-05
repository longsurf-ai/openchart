// Purpose: Adapt private utility-process requests to Electron encryption capabilities.
import { safeStorage } from "electron";
import type { z } from "zod";
import type { HostRequest } from "./host-protocol";

/**
 * Executes one request from our backend. Renderer IPC never reaches this adapter.
 * Encryption failure is explicit; Linux plaintext key storage is rejected.
 * @example const value = await executeHostRequest(message);
 */
export async function executeHostRequest(request: z.infer<typeof HostRequest>) {
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error("Protected credential storage is unavailable");
  return request.operation === "encrypt"
    ? (await safeStorage.encryptStringAsync(request.value)).toString("base64")
    : (
        await safeStorage.decryptStringAsync(
          Buffer.from(request.value, "base64"),
        )
      ).result;
}
