// Purpose: Scope the live Windows probe's fixture to its local owner or an explicitly opted-in hosted CI job.
import { execFile, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

if (process.platform !== "win32")
  throw new Error("The Windows runtime probe requires Windows.");

const retainFixture =
  process.env.OPENCHART_WINDOWS_RUNTIME_PROBE_RETAIN_FIXTURE === "1";
let fixtureParent = tmpdir();
if (retainFixture) {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    !runnerTemp ||
    !isAbsolute(runnerTemp)
  )
    throw new Error(
      "Retaining a probe fixture requires GitHub-hosted Actions and an absolute RUNNER_TEMP.",
    );
  fixtureParent = runnerTemp;
}

const require = createRequire(import.meta.url);
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const directory = await mkdtemp(
  join(fixtureParent, "openchart-windows-antigravity-"),
);
const areas = new Set([
  "home",
  "profile",
  "appdata",
  "localappdata",
  "model-providers",
  "root",
  "other",
]);
// Retry the entire removal against one deadline. Recursive fs.rm retries can
// multiply waits at each directory; each individual attempt disables them.
const cleanupProgram = String.raw`
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.argv[1];
const deadline = Date.now() + 10_000;
const transient = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);
const areas = new Set(['home', 'profile', 'appdata', 'localappdata', 'model-providers']);
for (;;) {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 0 });
    break;
  } catch (cause) {
    const code = typeof cause.code === 'string' && /^[A-Z_]{1,40}$/.test(cause.code) ? cause.code : 'UNKNOWN';
    const syscall = typeof cause.syscall === 'string' && /^[a-z]{1,24}$/.test(cause.syscall) ? cause.syscall : 'unknown';
    const relative = typeof cause.path === 'string' ? path.relative(root, cause.path) : undefined;
    const first = relative?.split(/[\\/]/)[0];
    const area = relative === '' ? 'root' : areas.has(first) ? first : 'other';
    console.error(JSON.stringify({ code, syscall, area }));
    if (!transient.has(code) || Date.now() >= deadline) {
      process.exitCode = 1;
      break;
    }
    await delay(Math.min(100, deadline - Date.now()));
  }
}
`;
let testExitCode = 1;
let fixtureDisposition: "removed" | "retained-for-runner-teardown" | "failed" =
  retainFixture ? "retained-for-runner-teardown" : "failed";
let fixtureCleanupDiagnostic:
  | { code: string; syscall: string; area: string; timedOut: boolean }
  | undefined;
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
  // Browser authentication can outlive the CLI. Hosted CI explicitly leaves its
  // fixture for job/VM teardown; local use must still prove bounded removal.
  if (!retainFixture) {
    try {
      await promisify(execFile)(
        process.execPath,
        ["--input-type=module", "-e", cleanupProgram, directory],
        { windowsHide: true, timeout: 15_000, maxBuffer: 16_384 },
      );
      fixtureDisposition = "removed";
    } catch (cause) {
      const failure = cause as { stderr?: string; killed?: boolean };
      fixtureCleanupDiagnostic = {
        code: "UNKNOWN",
        syscall: "unknown",
        area: "other",
        timedOut: failure.killed === true,
      };
      try {
        const last = JSON.parse(
          failure.stderr?.trim().split("\n").at(-1) ?? "null",
        ) as { code?: unknown; syscall?: unknown; area?: unknown } | null;
        if (typeof last?.code === "string" && /^[A-Z_]{1,40}$/.test(last.code))
          fixtureCleanupDiagnostic.code = last.code;
        if (
          typeof last?.syscall === "string" &&
          /^[a-z]{1,24}$/.test(last.syscall)
        )
          fixtureCleanupDiagnostic.syscall = last.syscall;
        if (typeof last?.area === "string" && areas.has(last.area))
          fixtureCleanupDiagnostic.area = last.area;
      } catch {
        /* A stalled filesystem call may have returned no error yet. */
      }
      console.error(
        "The Windows runtime probe fixture could not be removed:",
        JSON.stringify(fixtureCleanupDiagnostic),
      );
    }
  }
  console.info(
    "Antigravity Windows probe owner:",
    JSON.stringify({
      testExitCode,
      fixtureDisposition,
      fixtureCleanupDiagnostic,
    }),
  );
}
process.exitCode =
  testExitCode !== 0 ? testExitCode : fixtureDisposition === "failed" ? 1 : 0;
