// Purpose: Describe verified release files once for the builder and publisher.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { targets } from "../src/targets.ts";

/** Build evidence validated before publication; filenames are flat and cannot escape their target directory. */
export const BuildReceipt = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  target: z.enum(targets),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  signing: z.enum(["signed", "unsigned"]),
  builder: z.string().min(1),
  toolchain: z.strictObject({ node: z.string(), electron: z.string() }),
  files: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type BuildReceipt = z.infer<typeof BuildReceipt>;

/** Streams a file into a SHA-256 digest; stream errors reject and the stream closes itself. @example await sha256('/build/app.zip'); */
export async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Writes provenance and checksums after platform verification has succeeded.
 * Owns only these three files in the supplied temporary release directory;
 * callers publish the directory atomically. I/O or invalid metadata rejects.
 * @example await writeBuildReceipt(output, metadata, ['app.zip', 'RELEASES.json']);
 */
export async function writeBuildReceipt(
  output: string,
  metadata: Omit<BuildReceipt, "files">,
  names: string[],
): Promise<BuildReceipt> {
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sha256: await sha256(join(output, name)),
      size: (await stat(join(output, name))).size,
    })),
  );
  const receipt = BuildReceipt.parse({ ...metadata, files });
  await writeFile(
    join(output, "SHA256SUMS"),
    `${files.map((file) => `${file.sha256}  ${file.name}`).join("\n")}\n`,
  );
  await writeFile(join(output, "SOURCE"), `${receipt.commit}\n`);
  await writeFile(
    join(output, "BUILD.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}
