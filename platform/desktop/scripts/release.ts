// Purpose: Turn a notarized app into installable downloads and Electron's static update feed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export const releaseBaseUrl =
  "https://downloads.longsurf.ai/openchart/darwin/arm64";
export const signingIdentity = "Developer ID Application: Longsurf, Inc.";
const run = promisify(execFile);

/**
 * Creates versioned DMG/ZIP downloads, checksums and RELEASES.json in out/release.
 * Requires a Developer ID-signed, stapled Apple Silicon app and
 * the openchart-notary Keychain profile. Throws on failed Apple verification;
 * the update feed is written only after both downloads pass verification.
 * @example await createRelease('/build/OpenChart.app', '0.1.0');
 */
export async function createRelease(
  appPath: string,
  version: string,
): Promise<void> {
  z.string()
    .regex(/^\d+\.\d+\.\d+$/)
    .parse(version);
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
  await run("xcrun", ["stapler", "validate", appPath]);
  await run("spctl", ["--assess", "--type", "execute", appPath]);
  const releases = join(import.meta.dirname, "../out/release");
  await mkdir(releases, { recursive: true });
  const output = await mkdtemp(join(releases, ".preparing-"));
  const name = `OpenChart-${version}-darwin-arm64`;
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
    const checksums: string[] = [];
    for (const extension of ["dmg", "zip"]) {
      const file = `${name}.${extension}`;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(join(output, file)))
        hash.update(chunk);
      checksums.push(`${hash.digest("hex")}  ${file}`);
    }
    await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
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
                url: `${releaseBaseUrl}/${name}.zip`,
              },
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    await rename(output, join(releases, version));
    console.log("Verified release downloads:", join(releases, version));
  } finally {
    await rm(volume, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
}
