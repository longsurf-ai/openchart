// Purpose: Opt-in Windows feasibility evidence for the real pinned Antigravity CLI and ConPTY, without authenticating.
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import type { IPty } from "node-pty";
import { expect, test, vi } from "vitest";
import { ANTIGRAVITY } from "@openchart/models/model-tiers";
import { createInstallations } from "./installation";
import { PROVIDER_MANIFEST } from "./manifest";
import { stopWindowsTerminal } from "./terminal-cleanup";

type ProbePhase =
  | "environment"
  | "installation"
  | "installation-complete"
  | "terminal-import"
  | "terminal-start"
  | "authentication"
  | "authentication-complete"
  | "terminal-cleanup"
  | "terminal-finished";

/** Retain only observations; authorization URLs and codes must never enter test logs or reports. */
function observePrompt(output: string) {
  return {
    authorizationUrlSeen:
      /https:\/\/[^\s<>"']*(?:oauth|auth|signin|login)[^\s<>"']*/i.test(output),
    codePromptSeen: /(?:paste|enter|input)[^\r\n]{0,160}\bcode\b/i.test(output),
    networkFailureSeen:
      /ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|TLS|certificate|network|failed to fetch|connection (?:refused|timed out)/i.test(
        output,
      ),
  };
}

test("the feasibility gate requires both an authentication URL and an input prompt", () => {
  expect(
    observePrompt("https://example.invalid/docs\nEnter the code:"),
  ).toMatchObject({ authorizationUrlSeen: false, codePromptSeen: true });
  expect(
    observePrompt("https://example.invalid/oauth/authorize?state=fixture"),
  ).toMatchObject({ authorizationUrlSeen: true, codePromptSeen: false });
  expect(
    observePrompt(
      "Open https://example.invalid/oauth/authorize\nPaste your authorization code:",
    ),
  ).toMatchObject({ authorizationUrlSeen: true, codePromptSeen: true });
  expect(
    observePrompt("Connection timed out: ENOTFOUND").networkFailureSeen,
  ).toBe(true);
});

// No download, native import, process, or environment mutation unless explicitly enabled on Windows.
test.skipIf(
  process.platform !== "win32" ||
    process.env.OPENCHART_WINDOWS_RUNTIME_PROBE !== "1",
)(
  "the pinned Windows CLI reaches its authorization-code prompt under real ConPTY",
  async () => {
    const directory = process.env.OPENCHART_WINDOWS_RUNTIME_PROBE_DIRECTORY;
    if (!directory || !path.isAbsolute(directory))
      throw new Error(
        "Run just desktop-windows-probe, or supply an absolute parent-owned probe fixture directory.",
      );
    const fixture = await lstat(directory);
    if (
      !fixture.isDirectory() ||
      fixture.isSymbolicLink() ||
      (await readdir(directory)).length > 0
    )
      throw new Error(
        "The probe requires an existing, empty, parent-owned fixture directory.",
      );
    const reportPath = process.env.OPENCHART_WINDOWS_RUNTIME_PROBE_REPORT;
    const startedAt = Date.now();
    const report = {
      probe: "antigravity-windows-conpty",
      phase: "environment" as ProbePhase,
      fixtureCleanupOwner: "parent-process",
      version: PROVIDER_MANIFEST[ANTIGRAVITY]["win32-x64"]!.version,
      downloadAndVersionVerified: false,
      terminalStarted: false,
      authorizationUrlSeen: false,
      codePromptSeen: false,
      networkFailureSeen: false,
      authenticationPromptReady: false,
      cleanupComplete: false,
      elapsedMilliseconds: 0,
      failure: null as string | null,
    };
    async function checkpoint(phase: ProbePhase) {
      report.phase = phase;
      report.elapsedMilliseconds = Date.now() - startedAt;
      // Persist observations before long operations too, so an outer test
      // timeout leaves its last phase. No captured CLI output is included.
      console.info("Antigravity Windows feasibility:", JSON.stringify(report));
      if (!reportPath) return;
      try {
        await mkdir(path.dirname(reportPath), { recursive: true });
        await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
      } catch {
        report.failure ??= "probe-report-write-failed";
      }
    }
    let terminal: IPty | undefined;
    let outputListener: { dispose(): void } | undefined;
    let exitListener: { dispose(): void } | undefined;
    let exited = false;
    let resolveExit!: () => void;
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    try {
      await checkpoint("environment");
      for (const [name, folder] of [
        ["HOME", "home"],
        ["USERPROFILE", "profile"],
        ["APPDATA", "appdata"],
        ["LOCALAPPDATA", "localappdata"],
      ] as const) {
        const value = path.join(directory, folder);
        await mkdir(value);
        vi.stubEnv(name, value);
      }
      // The probe never consumes developer/runner credentials from provider environment variables.
      for (const key of Object.keys(process.env)) {
        if (/^(GOOGLE_|GEMINI_|ANTIGRAVITY_|AGY_)/.test(key))
          vi.stubEnv(key, undefined);
      }
      const installations = createInstallations(
        path.join(directory, "model-providers"),
      );
      const downloadDeadline = AbortSignal.timeout(30_000);
      try {
        await checkpoint("installation");
        // Installation validates the complete SHA-512 archive and runs the exact managed --version.
        await installations.install(ANTIGRAVITY, downloadDeadline, () => {});
        report.downloadAndVersionVerified = true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        const http = /Download failed \(HTTP (\d+)\)/.exec(message)?.[1];
        report.failure = downloadDeadline.aborted
          ? "download-timeout"
          : http
            ? `download-http-${http}`
            : message.includes("checksum")
              ? "download-checksum-mismatch"
              : message.includes("Expected provider version")
                ? "provider-version-mismatch"
                : "download-or-install-failed";
      }
      await checkpoint("installation-complete");
      if (!report.failure) {
        try {
          await checkpoint("terminal-import");
          const pty = await import("node-pty");
          await checkpoint("terminal-start");
          terminal = pty.spawn(
            installations.executables[ANTIGRAVITY],
            ["-p", "/usage"],
            {
              name: "xterm-color",
              cols: 120,
              rows: 30,
              useConpty: true,
              cwd: directory,
              env: {
                ...process.env,
                AGY_CLI_DISABLE_AUTO_UPDATE: "true",
                DISABLE_AUTOUPDATER: "1",
              },
            },
          );
          report.terminalStarted = true;
          let output = "";
          let ready!: () => void;
          const promptReady = new Promise<void>((resolve) => {
            ready = resolve;
          });
          outputListener = terminal.onData((text) => {
            output = stripVTControlCharacters(output + text).slice(-32_768);
            const observed = observePrompt(output);
            report.authorizationUrlSeen ||= observed.authorizationUrlSeen;
            report.codePromptSeen ||= observed.codePromptSeen;
            report.networkFailureSeen ||= observed.networkFailureSeen;
            if (report.authorizationUrlSeen && report.codePromptSeen) {
              report.authenticationPromptReady = true;
              ready();
            }
          });
          exitListener = terminal.onExit(() => {
            exited = true;
            resolveExit();
          });
          await checkpoint("authentication");
          const promptDeadline = new AbortController();
          try {
            await Promise.race([
              promptReady,
              exit,
              delay(20_000, undefined, { signal: promptDeadline.signal }),
            ]);
          } finally {
            promptDeadline.abort();
            // OAuth material is neither logged nor attached to thrown errors or evidence.
            output = "";
          }
          if (!report.authenticationPromptReady) {
            report.failure = report.networkFailureSeen
              ? "cli-network-failure"
              : exited
                ? "cli-exited-before-authentication-prompt"
                : report.authorizationUrlSeen || report.codePromptSeen
                  ? "incomplete-authentication-prompt"
                  : "authentication-prompt-timeout";
          }
          await checkpoint("authentication-complete");
        } catch {
          report.failure = "conpty-start-or-execution-failed";
        }
      }
    } catch {
      report.failure ??= "probe-environment-failed";
    } finally {
      try {
        await checkpoint("terminal-cleanup");
        if (terminal) await stopWindowsTerminal(terminal, exit, () => exited);
        report.cleanupComplete = !terminal || exited;
      } catch {
        report.failure = "terminal-cleanup-failed";
      } finally {
        outputListener?.dispose();
        exitListener?.dispose();
        vi.unstubAllEnvs();
        await checkpoint("terminal-finished");
      }
    }
    if (report.failure)
      throw new Error(
        `Antigravity Windows feasibility failed: ${report.failure}.`,
      );
    expect(report).toMatchObject({
      downloadAndVersionVerified: true,
      authenticationPromptReady: true,
      cleanupComplete: true,
    });
  },
  // Preserve the 30s install signal, 20s prompt wait and 5s+2s+2s terminal
  // cleanup timers, allowing overhead for native calls, filesystem and reports.
  // The parent command removes its fixture after this native owner process exits.
  90_000,
);
