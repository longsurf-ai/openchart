// Purpose: Own the live Windows probe's fixture until its Vitest/native process has exited.
import { execFile, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

if (process.platform !== "win32")
  throw new Error("The Windows runtime probe requires Windows.");

const require = createRequire(import.meta.url);
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const directory = await mkdtemp(
  join(tmpdir(), "openchart-windows-antigravity-"),
);
let testExitCode = 1;
let fixtureCleanupComplete = false;
try {
  const child = spawn(
    process.execPath,
    [vitest, "run", "server/models/onboarding/windows-runtime.test.ts"],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        OPENCHART_WINDOWS_RUNTIME_PROBE: "1",
        OPENCHART_WINDOWS_RUNTIME_PROBE_DIRECTORY: directory,
      },
    },
  );
  testExitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
} catch {
  console.error("The Windows runtime probe process could not complete.");
} finally {
  // The process that loaded node-pty is gone. A separate, bounded cleanup
  // process removes only this wrapper's unique fixture, never a caller's path.
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import { rm } from 'node:fs/promises'; await rm(process.argv[1], { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });",
        directory,
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 16_384 },
    );
    fixtureCleanupComplete = true;
  } catch {
    console.error(
      "The Windows runtime probe fixture could not be removed within the cleanup deadline.",
    );
  }
  console.info(
    "Antigravity Windows probe owner:",
    JSON.stringify({ testExitCode, fixtureCleanupComplete }),
  );
}
process.exitCode =
  testExitCode !== 0 ? testExitCode : fixtureCleanupComplete ? 0 : 1;
