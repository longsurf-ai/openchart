// Purpose: Validates and streams bounded ZIP provider archives into an unpublished payload.
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { open, type Entry, type ZipFile } from "yauzl";

const maximumUnpackedBytes = 2 * 1024 * 1024 * 1024;
const maximumEntries = 10_000;

/**
 * Extracts regular files/directories from a verified ZIP into a fresh directory.
 * Validates all names, types and cumulative sizes before writing, rejects Windows
 * aliases and duplicate paths, and closes streams/archive handles on failure or
 * cancellation. The installation owner removes the unpublished payload on error.
 * @example await extractZip(archive, payload, "flat", signal);
 */
export async function extractZip(
  archive: string,
  payload: string,
  layout: "flat" | "npm",
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    open(
      archive,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, value) => {
        if (error) reject(error);
        else resolve(value!);
      },
    );
  });
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
    zip.close();
    await closed;
  }
}
