// Purpose: Reject wrong-architecture native payloads before releasing desktop bundles.
import { execFile } from "node:child_process";
import { glob, lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  targetArch,
  targetPlatform,
  type DesktopTarget,
} from "../src/targets.ts";

const run = promisify(execFile);
const machO = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
  0xcafebabf, 0xbfbafeca,
]);

/**
 * Inspects native headers in a staged runtime or packaged app. Mac verification
 * also uses lipo; Windows reads the PE machine directly. Symlinks are skipped.
 * Staging permits native files only inside Windows node-pty prebuilds. A mismatch
 * throws, with file handles closed before returning. No files are mutated.
 * @example await verifyNativeFiles(bundle, 'darwin-x64');
 */
export async function verifyNativeFiles(
  directory: string,
  target: DesktopTarget,
  staging = false,
): Promise<string[]> {
  const native: string[] = [];
  for await (const entry of glob("**/*", { cwd: directory })) {
    const filename = join(directory, entry);
    if (!(await lstat(filename)).isFile()) continue;
    const file = await open(filename, "r");
    try {
      const header = Buffer.alloc(64);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      if (bytesRead < 4) continue;
      const mac = machO.has(header.readUInt32BE(0));
      const pe = bytesRead >= 64 && header.toString("ascii", 0, 2) === "MZ";
      const elf = header.readUInt32BE(0) === 0x7f454c46;
      if (!mac && !pe && !elf) continue;
      const normalized = entry.replaceAll("\\", "/");
      if (
        staging &&
        !(
          target === "win32-x64" &&
          normalized.startsWith("node_modules/node-pty/prebuilds/win32-x64/")
        )
      )
        throw new Error(`Unexpected native staged runtime: ${entry}`);
      if (mac && targetPlatform(target) === "darwin") {
        const { stdout } = await run("lipo", ["-archs", filename]);
        const expected = targetArch(target) === "x64" ? "x86_64" : "arm64";
        if (!stdout.trim().split(/\s+/).includes(expected))
          throw new Error(
            `Wrong Mac architecture in ${entry}: ${stdout.trim()}`,
          );
      } else if (pe && target === "win32-x64") {
        const signature = Buffer.alloc(6);
        const read = await file.read(signature, 0, 6, header.readUInt32LE(60));
        if (
          read.bytesRead !== 6 ||
          signature.readUInt32LE(0) !== 0x4550 ||
          signature.readUInt16LE(4) !== 0x8664
        )
          throw new Error(`Expected Windows x64 PE in ${entry}`);
      } else
        throw new Error(`Foreign native executable in ${target}: ${entry}`);
      native.push(normalized);
    } finally {
      await file.close();
    }
  }
  return native;
}
