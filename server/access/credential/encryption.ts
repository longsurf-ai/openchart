// Purpose: Supplies authenticated credential encryption without a desktop dependency.

import { CompactEncrypt, compactDecrypt } from "jose";
import type { Credential } from "./credential";

/**
 * Encrypts values as standard JWE using a deployment-owned random 32-byte key.
 * The host loads and retains the key across restarts, outside the database and
 * ordinary application config. Invalid key sizes throw; cryptographic failures
 * reject. Credential maps operation failures to StorageFailed.
 * @example
 * const encryption = jweEncryption(await secrets.loadCredentialKey());
 * const runtime = makeRuntime({home: '/var/lib/openchart', credentialEncryption: encryption});
 */
export function jweEncryption(key: Uint8Array): Credential.Encryption {
  if (key.byteLength !== 32)
    throw new Error("Credential encryption requires a 32-byte key");
  const secret = new Uint8Array(key);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return {
    encrypt: (plaintext) =>
      new CompactEncrypt(encoder.encode(plaintext))
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .encrypt(secret),
    async decrypt(ciphertext) {
      const { plaintext } = await compactDecrypt(ciphertext, secret, {
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      return decoder.decode(plaintext);
    },
  };
}
