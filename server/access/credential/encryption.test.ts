// Purpose: Verifies standard JWE encryption with deployment-owned keys on Node.

import { randomBytes } from "node:crypto";
import { compactDecrypt } from "jose";
import { expect, test } from "vitest";
import { jweEncryption } from "./encryption";

test("uses randomized interoperable JWE and retains an independent key copy", async () => {
  const key = randomBytes(32);
  const savedKey = new Uint8Array(key);
  const encryption = jweEncryption(key);
  key.fill(0);
  const first = await encryption.encrypt("€ secret token");
  const second = await encryption.encrypt("€ secret token");
  expect(first).not.toBe(second);
  const { plaintext, protectedHeader } = await compactDecrypt(first, savedKey);
  expect(protectedHeader).toEqual({ alg: "dir", enc: "A256GCM" });
  expect(new TextDecoder().decode(plaintext)).toBe("€ secret token");
  expect(await jweEncryption(savedKey).decrypt(first)).toBe("€ secret token");
});

test.each([0, 16, 24, 33])("rejects a %i-byte deployment key", (length) => {
  expect(() => jweEncryption(randomBytes(length))).toThrow("32-byte key");
});
