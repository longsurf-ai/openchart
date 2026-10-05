// Purpose: UUID helper that works in browser and Node runtimes, including insecure HTTP origins
// Module:  @openchart/chart-core / util

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function fallbackBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export const UUID = {
  random(): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }

    const bytes =
      typeof cryptoApi?.getRandomValues === "function"
        ? cryptoApi.getRandomValues(new Uint8Array(16))
        : fallbackBytes();

    // Both sources allocate 16 bytes; apply the RFC 4122 version 4 bit layout.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = bytesToHex(bytes);
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  },
};
