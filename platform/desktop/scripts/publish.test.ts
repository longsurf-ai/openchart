// Purpose: Prevent corrupt, mixed-target, unsigned or conflicting releases from reaching update feeds.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeBuildReceipt } from "./release-artifacts.ts";
import {
  preparePublication,
  publishPlan,
  type PublicationTransport,
} from "./publish.ts";
import { releaseRoot, type DesktopTarget } from "../src/targets.ts";

const version = "1.2.3";
const commit = "a".repeat(40);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(
  selected: DesktopTarget[],
  signing: "signed" | "unsigned" = "signed",
) {
  const directory = await mkdtemp(join(tmpdir(), "openchart-publish-"));
  directories.push(directory);
  for (const target of selected) {
    const folder = join(directory, version, target);
    await mkdir(folder, { recursive: true });
    const stem = `OpenChart-${version}-${target}`;
    let files: Record<string, string>;
    if (target === "win32-x64") {
      const payload = "windows package";
      const packageName = `OpenChart-${version}-full.nupkg`;
      files = {
        [`${stem}-setup.exe`]: "windows installer",
        [packageName]: payload,
        RELEASES: `${createHash("sha1").update(payload).digest("hex")} ${packageName} ${Buffer.byteLength(payload)}\n`,
      };
    } else {
      files = {
        [`${stem}.dmg`]: `installer ${target}`,
        [`${stem}.zip`]: `updater ${target}`,
        "RELEASES.json": JSON.stringify({
          currentRelease: version,
          releases: [
            {
              version,
              updateTo: {
                version,
                url: `${releaseRoot}/${target.replace("-", "/")}/${stem}.zip`,
              },
            },
          ],
        }),
      };
    }
    for (const [name, content] of Object.entries(files))
      await writeFile(join(folder, name), content);
    await writeBuildReceipt(
      folder,
      {
        version,
        target,
        commit,
        signing,
        builder: "fixture",
        toolchain: { node: "24.8.0", electron: "44.2.0" },
      },
      Object.keys(files),
    );
  }
  return directory;
}

function transport() {
  const objects = new Map<string, string>();
  const assets: Record<string, string> = {};
  const writes: string[] = [];
  const adapter: PublicationTransport = {
    objectDigest: async (key) => objects.get(key),
    putObject: async (upload) => {
      writes.push(upload.key);
      objects.set(upload.key, upload.sha256);
    },
    release: async () => ({ ...assets }),
    ensureRelease: async () => {
      writes.push("github:ensure");
    },
    uploadAsset: async (_version, asset) => {
      writes.push(`github:${asset.name}`);
      assets[asset.name] = asset.sha256;
    },
    assetDigest: async (_version, name) => assets[name],
    finishRelease: async () => {
      writes.push("github:latest");
    },
  };
  return { objects, assets, writes, adapter };
}

describe("desktop publication inventory", () => {
  it("prepares all targets while preserving ARM URLs and Squirrel package names", async () => {
    const selected = ["darwin-arm64", "darwin-x64", "win32-x64"] as const;
    const directory = await fixture([...selected]);
    const plan = await preparePublication(directory, version, selected);
    expect(plan.commit).toBe(commit);
    expect(
      plan.uploads
        .filter((entry) => entry.kind === "feed")
        .map((entry) => entry.key),
    ).toEqual([
      "openchart/darwin/arm64/RELEASES.json",
      "openchart/darwin/x64/RELEASES.json",
      "openchart/win32/x64/RELEASES",
    ]);
    expect(
      plan.uploads.some(
        (entry) =>
          entry.key === `openchart/win32/x64/OpenChart-${version}-full.nupkg`,
      ),
    ).toBe(true);
    expect(new Set(plan.assets.map((entry) => entry.name)).size).toBe(
      plan.assets.length,
    );
  });

  it("rejects unsigned production publication", async () => {
    const directory = await fixture(["win32-x64"], "unsigned");
    await expect(
      preparePublication(directory, version, ["win32-x64"]),
    ).rejects.toThrow("unsigned artifacts");
  });

  it("rejects corrupt bytes before any publication", async () => {
    const directory = await fixture(["darwin-x64"]);
    await writeFile(
      join(
        directory,
        version,
        "darwin-x64",
        `OpenChart-${version}-darwin-x64.zip`,
      ),
      "wrong bytes",
    );
    await expect(
      preparePublication(directory, version, ["darwin-x64"]),
    ).rejects.toThrow("corrupt artifact");
  });

  it("rejects an incomplete checksum inventory", async () => {
    const directory = await fixture(["darwin-x64"]);
    await writeFile(join(directory, version, "darwin-x64", "SHA256SUMS"), "");
    await expect(
      preparePublication(directory, version, ["darwin-x64"]),
    ).rejects.toThrow("checksum inventory mismatch");
  });

  it("rejects targets built from different commits", async () => {
    const directory = await fixture(["darwin-arm64", "darwin-x64"]);
    const folder = join(directory, version, "darwin-x64");
    const receipt = JSON.parse(
      await readFile(join(folder, "BUILD.json"), "utf8"),
    );
    receipt.commit = "b".repeat(40);
    await writeFile(join(folder, "BUILD.json"), JSON.stringify(receipt));
    await writeFile(join(folder, "SOURCE"), receipt.commit);
    await expect(
      preparePublication(directory, version, ["darwin-arm64", "darwin-x64"]),
    ).rejects.toThrow("different commits");
  });

  it("rejects a checksummed Intel feed that points at ARM", async () => {
    const directory = await fixture(["darwin-x64"]);
    const folder = join(directory, version, "darwin-x64");
    const receipt = JSON.parse(
      await readFile(join(folder, "BUILD.json"), "utf8"),
    );
    const feed = await readFile(join(folder, "RELEASES.json"), "utf8");
    await writeFile(
      join(folder, "RELEASES.json"),
      feed.replaceAll("darwin/x64", "darwin/arm64"),
    );
    await writeBuildReceipt(
      folder,
      receipt,
      receipt.files.map((file: { name: string }) => file.name),
    );
    await expect(
      preparePublication(directory, version, ["darwin-x64"]),
    ).rejects.toThrow("wrong target or version");
  });

  it("verifies the independent SHA-1 and size required by Squirrel", async () => {
    const directory = await fixture(["win32-x64"]);
    const folder = join(directory, version, "win32-x64");
    const receipt = JSON.parse(
      await readFile(join(folder, "BUILD.json"), "utf8"),
    );
    await writeFile(
      join(folder, "RELEASES"),
      `${"0".repeat(40)} OpenChart-${version}-full.nupkg 15\n`,
    );
    await writeBuildReceipt(
      folder,
      receipt,
      receipt.files.map((file: { name: string }) => file.name),
    );
    await expect(
      preparePublication(directory, version, ["win32-x64"]),
    ).rejects.toThrow("checksum/size mismatch");
  });
});

describe("retry-safe publication", () => {
  it("writes every target's downloads before feeds and skips identical uploads on retry", async () => {
    const directory = await fixture(["darwin-arm64", "darwin-x64"]);
    const plan = await preparePublication(directory, version, [
      "darwin-arm64",
      "darwin-x64",
    ]);
    const remote = transport();
    await publishPlan(plan, remote.adapter);
    const firstFeed = remote.writes.findIndex((key) =>
      key.endsWith("/RELEASES.json"),
    );
    for (const entry of plan.uploads.filter((entry) => entry.kind !== "feed"))
      expect(remote.writes.indexOf(entry.key)).toBeLessThan(firstFeed);
    remote.writes.length = 0;
    await publishPlan(plan, remote.adapter);
    expect(remote.writes).toEqual(["github:ensure", "github:latest"]);
  });

  it("aborts immutable conflicts without writing any target", async () => {
    const directory = await fixture(["darwin-arm64", "darwin-x64"]);
    const plan = await preparePublication(directory, version, [
      "darwin-arm64",
      "darwin-x64",
    ]);
    const remote = transport();
    remote.objects.set(
      `openchart/darwin/x64/OpenChart-${version}-darwin-x64.zip`,
      "different",
    );
    await expect(publishPlan(plan, remote.adapter)).rejects.toThrow(
      "Immutable object conflicts",
    );
    expect(remote.writes).toEqual([]);
  });

  it("rejects conflicting GitHub assets before changing update feeds", async () => {
    const directory = await fixture(["darwin-arm64"]);
    const plan = await preparePublication(directory, version, ["darwin-arm64"]);
    const remote = transport();
    remote.assets[plan.assets[0]!.name] = "different";
    await expect(publishPlan(plan, remote.adapter)).rejects.toThrow(
      "GitHub asset conflicts",
    );
    expect(remote.writes).toEqual([]);
  });

  it("can attach a missing target to an existing release without replacing prior assets", async () => {
    const directory = await fixture(["darwin-arm64", "darwin-x64"]);
    const remote = transport();
    await publishPlan(
      await preparePublication(directory, version, ["darwin-arm64"]),
      remote.adapter,
    );
    remote.writes.length = 0;
    await publishPlan(
      await preparePublication(directory, version, [
        "darwin-arm64",
        "darwin-x64",
      ]),
      remote.adapter,
    );
    expect(remote.writes.some((key) => key.includes("darwin-x64.zip"))).toBe(
      true,
    );
    expect(remote.writes.some((key) => key.includes("darwin-arm64"))).toBe(
      false,
    );
  });

  it("never changes a feed if download read-back verification fails", async () => {
    const directory = await fixture(["darwin-arm64"]);
    const plan = await preparePublication(directory, version, ["darwin-arm64"]);
    const remote = transport();
    remote.adapter.putObject = async (upload) => {
      remote.writes.push(upload.key);
    };
    await expect(publishPlan(plan, remote.adapter)).rejects.toThrow(
      "Upload verification failed",
    );
    expect(remote.writes.some((key) => key.endsWith("/RELEASES.json"))).toBe(
      false,
    );
  });
});
