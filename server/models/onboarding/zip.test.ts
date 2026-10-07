// Purpose: Exercises safe ZIP extraction with real archives on every supported host.
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { extractZip } from "./zip";
import { zipFixture } from "./zip.test-utils";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture(entries: Parameters<typeof zipFixture>[0]) {
  const root = await mkdtemp(path.join(tmpdir(), "openchart-zip-"));
  directories.push(root);
  const archive = path.join(root, "archive.zip");
  const payload = path.join(root, "payload");
  await mkdir(payload);
  await writeFile(archive, zipFixture(entries));
  return { archive, payload };
}

test("extracts complete flat and npm ZIP payloads", async () => {
  for (const layout of ["flat", "npm"] as const) {
    const f = await fixture([
      {
        name: `${layout === "npm" ? "package/" : ""}bin/antigravity.exe`,
        body: "executable",
      },
    ]);
    await extractZip(
      f.archive,
      f.payload,
      layout,
      new AbortController().signal,
    );
    expect(
      await readFile(path.join(f.payload, "bin/antigravity.exe"), "utf8"),
    ).toBe("executable");
  }
});

test.each(
  [
    [{ name: "../escape" }],
    [{ name: "/escape" }],
    [{ name: "C:/escape" }],
    [{ name: "bin\\escape" }],
    [{ name: "bin/file:stream" }],
    [{ name: "bin/file?" }],
    [{ name: "bin/\u0001file" }],
    [{ name: "bin/CON.txt" }],
    [{ name: "bin/file. " }],
    [{ name: "bin/link", mode: 0o120777 }],
    [{ name: "bin/fifo", mode: 0o010644 }],
    [{ name: "bin/a" }, { name: "bin/A" }],
    [{ name: "huge", size: 2 * 1024 * 1024 * 1024 + 1 }],
  ].map((entries) => ({ entries })),
)(
  "rejects unsafe ZIP metadata before writing any files: %j",
  async ({ entries }) => {
    const f = await fixture([{ name: "valid", body: "first" }, ...entries]);
    await expect(
      extractZip(f.archive, f.payload, "flat", new AbortController().signal),
    ).rejects.toThrow();
    expect(await readdir(f.payload)).toEqual([]);
  },
);

test("rejects truncated ZIPs and mismatched declared sizes", async () => {
  const f = await fixture([{ name: "file", body: "bytes", size: 1 }]);
  await expect(
    extractZip(f.archive, f.payload, "flat", new AbortController().signal),
  ).rejects.toThrow();
  await writeFile(f.archive, Buffer.from("not a zip"));
  await expect(
    extractZip(f.archive, f.payload, "flat", new AbortController().signal),
  ).rejects.toThrow();
});

test("honors cancellation before opening an archive", async () => {
  const f = await fixture([{ name: "file", body: "bytes" }]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    extractZip(f.archive, f.payload, "flat", controller.signal),
  ).rejects.toThrow();
  expect(await readdir(f.payload)).toEqual([]);
});
