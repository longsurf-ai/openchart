// Purpose: Exercises safe ZIP extraction with real archives on every supported host.
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { extractZip } from "./zip";
import { zipFixture } from "./zip.test-utils";

const io = vi.hoisted(() => ({ opened: vi.fn<(file: FileHandle) => void>() }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args);
      io.opened(file);
      return file;
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  io.opened.mockReset();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test.each([false, true])(
  "rejects actual file-close failure, including after a ZIP read error (invalid archive: %s)",
  async (invalid) => {
    const f = await fixture([
      { name: invalid ? "../escape" : "file", body: "bytes" },
    ]);
    io.opened.mockImplementation((file) => {
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => {
        // Close the real descriptor so the fault injection itself leaks no handles.
        await close();
        throw Object.assign(new Error("fixture archive close failure"), {
          code: "EIO",
        });
      });
    });
    await expect(
      extractZip(f.archive, f.payload, "flat", new AbortController().signal),
    ).rejects.toThrow("fixture archive close failure");
  },
);

test("an earlier ZIP read error still waits for actual file closure", async () => {
  const f = await fixture([{ name: "../escape" }]);
  let release!: () => void;
  const closing = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closeRequested = false;
  let settled = false;
  io.opened.mockImplementation((file) => {
    const close = file.close.bind(file);
    vi.spyOn(file, "close").mockImplementation(async () => {
      closeRequested = true;
      await closing;
      await close();
    });
  });
  const pending = extractZip(
    f.archive,
    f.payload,
    "flat",
    new AbortController().signal,
  ).finally(() => {
    settled = true;
  });
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(closeRequested).toBe(true));
  expect(settled).toBe(false);
  release();
  await rejected;
});

test("cancellation during payload reading destroys the stream before closing the shared file", async () => {
  const f = await fixture([{ name: "file", body: "fixture contents" }]);
  const controller = new AbortController();
  let streamClosed = false;
  let fileClosed = false;
  io.opened.mockImplementation((file) => {
    const read = file.createReadStream.bind(file);
    vi.spyOn(file, "createReadStream").mockImplementation((options) => {
      const stream = read(options);
      stream.once("data", () => controller.abort());
      stream.once("close", () => {
        streamClosed = true;
      });
      return stream;
    });
    const close = file.close.bind(file);
    vi.spyOn(file, "close").mockImplementation(async () => {
      expect(streamClosed).toBe(true);
      await close();
      fileClosed = true;
    });
  });
  await expect(
    extractZip(f.archive, f.payload, "flat", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(streamClosed).toBe(true);
  expect(fileClosed).toBe(true);
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

test("streams a multi-chunk payload and releases every range before returning", async () => {
  const body = randomBytes(128 * 1024).toString("base64");
  const f = await fixture([{ name: "file", body }]);
  const streams: import("node:fs").ReadStream[] = [];
  io.opened.mockImplementation((file) => {
    const read = file.createReadStream.bind(file);
    vi.spyOn(file, "createReadStream").mockImplementation((options) => {
      const stream = read(options);
      streams.push(stream);
      return stream;
    });
  });
  await extractZip(f.archive, f.payload, "flat", new AbortController().signal);
  expect(await readFile(path.join(f.payload, "file"), "utf8")).toBe(body);
  expect(streams.length).toBeGreaterThan(0);
  expect(streams.every((stream) => stream.closed)).toBe(true);
});

test("extracts a stored empty file without requesting an invalid byte range", async () => {
  const f = await fixture([{ name: "empty" }]);
  const bytes = await readFile(f.archive);
  const central = bytes.readUInt32LE(bytes.length - 6);
  // Turn the fixture's empty DEFLATE entry into an empty stored entry. Its two
  // former payload bytes remain harmless padding before the central directory.
  bytes.writeUInt16LE(0, 8);
  bytes.writeUInt32LE(0, 18);
  bytes.writeUInt16LE(0, central + 10);
  bytes.writeUInt32LE(0, central + 20);
  await writeFile(f.archive, bytes);
  await extractZip(f.archive, f.payload, "flat", new AbortController().signal);
  expect(await readFile(path.join(f.payload, "empty"))).toHaveLength(0);
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
