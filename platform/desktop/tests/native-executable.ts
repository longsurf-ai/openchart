// Purpose: Run the same isolated CLI fixtures as real executables on Windows.
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * Writes a smoke-owned executable at `destination` from self-contained CommonJS.
 * Windows embeds the source into a copy of the running Node binary using SEA;
 * other hosts use a Node shebang. The caller owns the executable's lifetime.
 * Temporary build inputs are removed even on failure; compilation/injection
 * failures reject. This is test-only and requires the desktop `postject` dev tool.
 *
 * @example
 * await writeNativeExecutable("C:/temp/codex.exe", 'console.log("fixture")');
 */
export async function writeNativeExecutable(
  destination: string,
  source: string,
) {
  if (process.platform !== "win32") {
    await writeFile(destination, `#!${process.execPath}\n${source}`);
    await chmod(destination, 0o755);
    return;
  }
  const build = await mkdtemp(join(tmpdir(), "openchart-fixture-sea-"));
  try {
    const main = join(build, "fixture.cjs");
    const blob = join(build, "fixture.blob");
    const config = join(build, "sea.json");
    await writeFile(main, source);
    await writeFile(
      config,
      JSON.stringify({
        main,
        output: blob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      }),
    );
    await run(process.execPath, ["--experimental-sea-config", config], {
      windowsHide: true,
    });
    await copyFile(process.execPath, destination);
    // Node documents signature removal as optional on Windows. postject drops
    // the copied signature; these isolated fixtures are deliberately unsigned.
    const { inject } = require("postject") as {
      inject(
        path: string,
        resource: string,
        data: Buffer,
        options: { sentinelFuse: string },
      ): Promise<void>;
    };
    await inject(destination, "NODE_SEA_BLOB", await readFile(blob), {
      sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    });
  } finally {
    await rm(build, { recursive: true, force: true });
  }
}
