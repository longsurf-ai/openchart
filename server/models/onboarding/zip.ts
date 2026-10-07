// Purpose: Validates and streams bounded ZIP provider archives into an unpublished payload.
import { createWriteStream } from "node:fs";
import { mkdir, open as openFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  fromRandomAccessReader,
  RandomAccessReader,
  type Entry,
  type ZipFile,
} from "yauzl";

const maximumUnpackedBytes = 2 * 1024 * 1024 * 1024;
const maximumEntries = 10_000;

/**
 * Extracts regular files/directories from a verified ZIP into a fresh directory.
 * Validates all names, types and cumulative sizes before writing, rejects Windows
 * aliases and duplicate paths, and closes streams/archive handles on failure or
 * cancellation. The installation owner removes the unpublished payload on error.
 * File-close failures reject independently of any earlier archive-read error.
 * @example await extractZip(archive, payload, "flat", signal);
 */
export async function extractZip(
  archive: string,
  payload: string,
  layout: "flat" | "npm",
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { zip, closeFile } = await openArchive(archive);
  // Keep an error listener throughout the lifetime, including streamed reads.
  let archiveError: Error | undefined;
  zip.on("error", (error: Error) => (archiveError = error));
  const closed = new Promise<void>((resolve) => zip.once("close", resolve));
  const abort = () => zip.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const entries = await new Promise<Entry[]>((resolve, reject) => {
      const result: Entry[] = [];
      const names = new Set<string>();
      let unpacked = 0;
      const onAbort = () => onError(signal.reason);
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        zip.removeListener("entry", onEntry);
        zip.removeListener("end", onEnd);
        zip.removeListener("error", onError);
      };
      const onError = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        resolve(result);
      };
      const onEntry = (entry: Entry) => {
        const name = entry.fileName;
        const directory = name.endsWith("/");
        const parts = name.replace(/\/$/, "").split("/");
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        unpacked += entry.uncompressedSize;
        const identity = parts.join("/").toLowerCase();
        if (
          (layout === "npm" && parts[0] !== "package") ||
          path.posix.isAbsolute(name) ||
          /[\\:<>"|?*]/.test(name) ||
          [...name].some((character) => character.charCodeAt(0) < 32) ||
          parts.some(
            (part) =>
              !part ||
              part === "." ||
              part === ".." ||
              /[. ]$/.test(part) ||
              /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
                part,
              ),
          ) ||
          (mode !== 0 && mode !== (directory ? 0x4000 : 0x8000)) ||
          (entry.generalPurposeBitFlag & 1) !== 0 ||
          (directory && entry.uncompressedSize !== 0) ||
          unpacked > maximumUnpackedBytes ||
          result.length >= maximumEntries ||
          names.has(identity)
        ) {
          onError(new Error("Provider archive contains unsupported entries."));
          return;
        }
        names.add(identity);
        result.push(entry);
        zip.readEntry();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      zip.on("entry", onEntry);
      zip.once("end", onEnd);
      zip.once("error", onError);
      zip.readEntry();
    });
    for (const entry of entries) {
      signal.throwIfAborted();
      if (archiveError) throw archiveError;
      const parts = entry.fileName.split("/");
      if (layout === "npm") parts.shift();
      const destination = path.join(payload, ...parts);
      if (entry.fileName.endsWith("/")) {
        await mkdir(destination, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(destination), { recursive: true });
      const source = await new Promise<import("node:stream").Readable>(
        (resolve, reject) => {
          zip.openReadStream(entry, (error, stream) => {
            if (error) reject(error);
            else resolve(stream!);
          });
        },
      );
      await pipeline(source, createWriteStream(destination, { flags: "wx" }), {
        signal,
      });
    }
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      zip.close();
      await closed;
    } finally {
      await closeFile();
    }
  }
}

/** Keeps file closure separate from ZIP read errors, which yauzl emits only once. */
async function openArchive(archive: string) {
  const file = await openFile(archive, "r");
  const streams = new Set<Readable>();
  const streamClosures: Promise<void>[] = [];
  const closeFile = async () => {
    for (const stream of streams) stream.destroy();
    await Promise.all(streamClosures);
    await file.close();
  };
  // The public reader's close drains yauzl's references; this owner then closes
  // the actual file and observes its Promise even after an earlier ZIP error.
  const reader = new (class extends RandomAccessReader {
    override _readStreamForRange(start: number, end: number) {
      const stream = file.createReadStream({
        start,
        end: end - 1,
        autoClose: false,
      });
      streams.add(stream);
      streamClosures.push(
        new Promise<void>((resolve) => {
          stream.once("close", () => {
            streams.delete(stream);
            resolve();
          });
        }),
      );
      // autoClose:false keeps the shared fd open, but the stream's FileHandle
      // reference must still be released when its range ends.
      stream.once("end", () => stream.destroy());
      return stream;
    }
    override read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
      callback: (error: Error | null) => void,
    ) {
      void file.read(buffer, offset, length, position).then(
        ({ bytesRead }) =>
          callback(
            bytesRead === length
              ? null
              : new Error("Unexpected end of ZIP archive."),
          ),
        (cause: Error) => callback(cause),
      );
    }
  })();
  try {
    const size = (await file.stat()).size;
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      fromRandomAccessReader(
        reader,
        size,
        { lazyEntries: true, autoClose: false, strictFileNames: true },
        (error, value) => {
          if (error) reject(error);
          else resolve(value!);
        },
      );
    });
    return { zip, closeFile };
  } catch (cause) {
    await closeFile();
    throw cause;
  }
}
