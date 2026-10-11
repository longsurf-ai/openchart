// Purpose: Constructs tiny ZIP fixtures including malformed metadata the production reader must reject.
import { crc32, deflateRawSync } from "node:zlib";

/** Builds an in-memory ZIP fixture, allowing unsafe names/types for rejection tests. */
export function zipFixture(
  entries: Array<{ name: string; body?: string; mode?: number; size?: number }>,
) {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = Buffer.from(entry.body ?? "");
    const compressed = deflateRawSync(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.size ?? body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(body), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.size ?? body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100755) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    files.push(local, name, compressed);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, end]);
}
