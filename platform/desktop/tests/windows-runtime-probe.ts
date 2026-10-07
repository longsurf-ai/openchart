// Purpose: Own the live Windows probe's fixture until its Vitest/native process has exited.
import { execFile, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
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
let fixtureCleanupComplete = false;
let fixtureCleanupDiagnostic:
  | { code: string; syscall: string; area: string; timedOut: boolean }
  | undefined;
let processesReferencingFixture:
  Array<{ name: string; pid: number }> | undefined;
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
      ["--input-type=module", "-e", cleanupProgram, directory],
      { windowsHide: true, timeout: 15_000, maxBuffer: 16_384 },
    );
    fixtureCleanupComplete = true;
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
    try {
      // Inspect only processes referencing this fixture. Never emit executable
      // paths or command lines, which can contain browser authorization URLs.
      const { stdout } = await promisify(execFile)(
        win32.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          String.raw`
$ErrorActionPreference = 'Stop'
$root = $env:OPENCHART_WINDOWS_RUNTIME_PROBE_DIRECTORY
$found = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and (
    ($_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
    ($_.ExecutablePath -and $_.ExecutablePath.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0)
  )
} | Select-Object -First 20 @{Name='name';Expression={$_.Name}}, @{Name='pid';Expression={$_.ProcessId}})
ConvertTo-Json -InputObject $found -Compress
`,
        ],
        {
          env: {
            ...process.env,
            OPENCHART_WINDOWS_RUNTIME_PROBE_DIRECTORY: directory,
          },
          windowsHide: true,
          timeout: 5_000,
          maxBuffer: 16_384,
        },
      );
      const records = JSON.parse(stdout) as Array<{
        name: string;
        pid: number;
      }>;
      if (Array.isArray(records))
        processesReferencingFixture = records
          .filter(
            (record) =>
              typeof record?.name === "string" &&
              /^[A-Za-z0-9_. -]{1,80}$/.test(record.name) &&
              Number.isSafeInteger(record.pid) &&
              record.pid > 0,
          )
          .map(({ name, pid }) => ({ name, pid }));
    } catch {
      console.error("Fixture process reference inspection was unavailable.");
    }
  }
  console.info(
    "Antigravity Windows probe owner:",
    JSON.stringify({
      testExitCode,
      fixtureCleanupComplete,
      fixtureCleanupDiagnostic,
      processesReferencingFixture,
    }),
  );
}
process.exitCode =
  testExitCode !== 0 ? testExitCode : fixtureCleanupComplete ? 0 : 1;
