import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyNativeFiles } from "./native-files";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const result = await mkdtemp(join(tmpdir(), "openchart-native-"));
  directories.push(result);
  return result;
}
function pe(machine: number) {
  const file = Buffer.alloc(128);
  file.write("MZ");
  file.writeUInt32LE(64, 60);
  file.writeUInt32LE(0x4550, 64);
  file.writeUInt16LE(machine, 68);
  return file;
}

it("accepts a Windows x64 package and rejects another architecture", async () => {
  const folder = await directory();
  await writeFile(join(folder, "OpenChart.exe"), pe(0x8664));
  expect(await verifyNativeFiles(folder, "win32-x64")).toEqual([
    "OpenChart.exe",
  ]);
  await writeFile(join(folder, "wrong.dll"), pe(0xaa64));
  await expect(verifyNativeFiles(folder, "win32-x64")).rejects.toThrow(
    "Expected Windows x64",
  );
});

it("rejects foreign binaries and unauthorized native staging", async () => {
  const folder = await directory();
  await writeFile(join(folder, "runtime.node"), pe(0x8664));
  await expect(verifyNativeFiles(folder, "darwin-arm64")).rejects.toThrow(
    "Foreign native",
  );
  await expect(verifyNativeFiles(folder, "win32-x64", true)).rejects.toThrow(
    "Unexpected native",
  );
});

it("permits only the target's PTY prebuild in Windows staging", async () => {
  const folder = await directory();
  const prebuild = join(folder, "node_modules/node-pty/prebuilds/win32-x64");
  await mkdir(prebuild, { recursive: true });
  await writeFile(join(prebuild, "conpty.node"), pe(0x8664));
  await writeFile(join(folder, "backend.js"), "export const x = 1;");
  expect(await verifyNativeFiles(folder, "win32-x64", true)).toHaveLength(1);
  await expect(verifyNativeFiles(folder, "darwin-x64", true)).rejects.toThrow(
    "Unexpected native",
  );
});

it("rejects ELF binaries hidden among JavaScript files", async () => {
  const folder = await directory();
  await writeFile(
    join(folder, "helper"),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  );
  await expect(verifyNativeFiles(folder, "win32-x64")).rejects.toThrow(
    "Foreign native",
  );
});
