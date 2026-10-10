// Purpose: Turn a notarized app into installable downloads and Electron's static update feed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import metadata from "@openchart/desktop/package.json" with { type: "json" };
import {
  releaseRoot,
  updateFeedUrl,
  targetPlatform,
  type DesktopTarget,
} from "../src/targets.ts";
import {
  parseSquirrelReleases,
  writeBuildReceipt,
} from "./release-artifacts.ts";
import { verifyNativeFiles } from "./native-files.ts";
import { windowsSigning } from "./windows-signing.ts";
import { promisify } from "node:util";
import { z } from "zod";

export const signingIdentity = "Developer ID Application: Longsurf, Inc.";
const run = promisify(execFile);

/** Requires a committed release source and returns its revision; never mutates Git. @example const commit = await committedSource(); */
export async function committedSource(): Promise<string> {
  const repository = join(import.meta.dirname, "../../..");
  const { stdout: changes } = await run(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: repository },
  );
  if (changes.trim())
    throw new Error("Commit the release source before building a release.");
  const { stdout: commit } = await run("git", ["rev-parse", "HEAD"], {
    cwd: repository,
  });
  return commit.trim();
}

/**
 * Creates platform downloads, feed, checksums and source evidence in one target
 * directory. Signed Mac builds must pass Gatekeeper/notarization; signed Windows
 * builds must pass Authenticode validation. Unsigned artifacts cannot be published.
 * Refuses dirty source or an existing destination. Temporary files are removed on
 * failure; no network publication occurs here.
 * @example await createRelease('/build/OpenChart.app', '0.1.14', 'darwin-x64', 'signed', commit);
 */
export async function createRelease(
  appPath: string,
  version: string,
  target: DesktopTarget,
  signing: "signed" | "unsigned",
  expectedCommit: string,
): Promise<void> {
  z.string()
    .regex(/^\d+\.\d+\.\d+$/)
    .parse(version);
  const commit = await committedSource();
  if (commit !== expectedCommit)
    throw new Error("Source revision changed while building the release.");
  await verifyNativeFiles(appPath, target);
  if (targetPlatform(target) === "win32")
    return createWindowsRelease(appPath, version, commit, signing);
  const { stdout: appVersion } = await run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    join(appPath, "Contents/Info.plist"),
  ]);
  if (appVersion.trim() !== version)
    throw new Error(
      `Packaged version ${appVersion.trim()} does not match release ${version}`,
    );
  await run("codesign", ["--verify", "--deep", "--strict", appPath]);
  if (signing === "signed") {
    await run("xcrun", ["stapler", "validate", appPath]);
    await run("spctl", ["--assess", "--type", "execute", appPath]);
  }
  const releases = join(import.meta.dirname, "../out/release", version);
  await mkdir(releases, { recursive: true });
  const output = await mkdtemp(join(releases, ".preparing-"));
  const name = `OpenChart-${version}-${target}`;
  const zip = join(output, `${name}.zip`);
  const dmg = join(output, `${name}.dmg`);
  const volume = await mkdtemp(join(tmpdir(), "openchart-installer-"));
  try {
    await run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      appPath,
      zip,
    ]);
    await run("ditto", [appPath, join(volume, "OpenChart.app")]);
    await symlink("/Applications", join(volume, "Applications"));
    await run("hdiutil", [
      "create",
      "-volname",
      "OpenChart",
      "-srcfolder",
      volume,
      "-format",
      "UDZO",
      "-ov",
      dmg,
    ]);
    if (signing === "signed") {
      await run("codesign", ["--sign", signingIdentity, "--timestamp", dmg]);
      console.log("Notarizing installer:", dmg);
      await run(
        "xcrun",
        [
          "notarytool",
          "submit",
          dmg,
          "--keychain-profile",
          "openchart-notary",
          "--wait",
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      await run("xcrun", ["stapler", "staple", dmg]);
      await run("xcrun", ["stapler", "validate", dmg]);
      await run("spctl", [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        dmg,
      ]);
    }
    await writeFile(
      join(output, "RELEASES.json"),
      JSON.stringify(
        {
          currentRelease: version,
          releases: [
            {
              version,
              updateTo: {
                version,
                name: `OpenChart ${version}`,
                notes: "",
                pub_date: new Date().toISOString(),
                url: `${updateFeedUrl(releaseRoot, "darwin", target === "darwin-arm64" ? "arm64" : "x64")}/${name}.zip`,
              },
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    await writeBuildReceipt(
      output,
      receiptMetadata(version, target, commit, signing),
      [`${name}.dmg`, `${name}.zip`, "RELEASES.json"],
    );
    await rename(output, join(releases, target));
    console.log("Verified release downloads:", join(releases, target));
  } finally {
    await rm(volume, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
}

function receiptMetadata(
  version: string,
  target: DesktopTarget,
  commit: string,
  signing: "signed" | "unsigned",
) {
  return {
    version,
    target,
    commit,
    signing,
    builder: process.env.GITHUB_RUN_ID
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : `${process.platform}-${process.arch}`,
    toolchain: {
      node: process.versions.node,
      electron: metadata.devDependencies.electron,
    },
  };
}

async function createWindowsRelease(
  appPath: string,
  version: string,
  commit: string,
  signing: "signed" | "unsigned",
): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("Windows installers require a Windows build host");
  const { createWindowsInstaller } = await import("electron-winstaller");
  const releases = join(import.meta.dirname, "../out/release", version);
  await mkdir(releases, { recursive: true });
  const output = await mkdtemp(join(releases, ".preparing-"));
  const installer = `OpenChart-${version}-win32-x64-setup.exe`;
  try {
    await createWindowsInstaller({
      appDirectory: appPath,
      outputDirectory: output,
      name: "OpenChart",
      exe: "OpenChart.exe",
      title: "OpenChart",
      version,
      authors: "Longsurf, Inc.",
      description: "Desktop charts, market data, and AI workflows.",
      setupExe: installer,
      setupIcon: join(import.meta.dirname, "../assets/icon.ico"),
      iconUrl: `https://raw.githubusercontent.com/longsurf-ai/openchart/${commit}/platform/desktop/assets/icon.ico`,
      noMsi: true,
      noDelta: true,
      windowsSign: windowsSigning(signing),
    });
    const files = (await readdir(output)).filter(
      (name) =>
        name === installer ||
        name === "RELEASES" ||
        name.endsWith("-full.nupkg"),
    );
    if (
      !files.includes(installer) ||
      !files.includes("RELEASES") ||
      files.filter((name) => name.endsWith("-full.nupkg")).length !== 1
    )
      throw new Error(
        "Squirrel did not produce a complete installer and update package",
      );
    const feed = await readFile(join(output, "RELEASES"), "utf8");
    const packageName = files.find((name) => name.endsWith("-full.nupkg"))!;
    const entries = parseSquirrelReleases(feed);
    if (entries.length !== 1 || entries[0]!.name !== packageName)
      throw new Error(
        `Squirrel feed does not identify ${packageName}: ${JSON.stringify(entries)}`,
      );
    const packageFile = join(output, packageName);
    const digest = createHash("sha1");
    for await (const chunk of createReadStream(packageFile))
      digest.update(chunk);
    if (
      digest.digest("hex") !== entries[0]!.sha1 ||
      (await stat(packageFile)).size !== entries[0]!.size
    )
      throw new Error(
        "Squirrel feed checksum or size does not match the update package",
      );
    if (signing === "signed") {
      // Squirrel modifies its updater while releasifying. Verify the final payload,
      // not the pre-installer directory containing its unsigned intermediate copy.
      const verification = await mkdtemp(
        join(tmpdir(), "openchart-signatures-"),
      );
      try {
        await run(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32/WindowsPowerShell/v1.0/powershell.exe",
          ),
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:OPENCHART_VERIFY_PACKAGE, $env:OPENCHART_VERIFY_DIRECTORY); $files = @(Get-ChildItem -LiteralPath $env:OPENCHART_VERIFY_DIRECTORY -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll','.node' }); if ($files.Count -eq 0) { throw 'No native payload to verify' }; $files += Get-Item -LiteralPath $env:OPENCHART_VERIFY_INSTALLER; foreach ($file in $files) { if ((Get-AuthenticodeSignature -LiteralPath $file.FullName).Status -ne 'Valid') { throw ('Invalid signature: ' + $file.Name) } }",
          ],
          {
            env: {
              ...process.env,
              OPENCHART_VERIFY_PACKAGE: join(output, packageName),
              OPENCHART_VERIFY_DIRECTORY: verification,
              OPENCHART_VERIFY_INSTALLER: join(output, installer),
            },
            windowsHide: true,
          },
        );
      } finally {
        await rm(verification, { recursive: true, force: true });
      }
    }
    await writeBuildReceipt(
      output,
      receiptMetadata(version, "win32-x64", commit, signing),
      files.sort(),
    );
    await rename(output, join(releases, "win32-x64"));
    console.log(
      "Verified Windows installer:",
      join(releases, "win32-x64", installer),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}
