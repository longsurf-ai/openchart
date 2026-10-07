// Purpose: Verify and publish target-specific desktop artifacts with retry-safe immutable uploads.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { BuildReceipt, sha256 } from "./release-artifacts.ts";
import {
  parseTarget,
  releaseRoot,
  targetArch,
  targetPlatform,
  targets,
  type DesktopTarget,
} from "../src/targets.ts";

type Upload = {
  path: string;
  name: string;
  sha256: string;
  key: string;
  kind: "immutable" | "pointer" | "feed";
};
type Asset = { path: string; name: string; sha256: string };
type Plan = {
  version: string;
  commit: string;
  uploads: Upload[];
  assets: Asset[];
};

/**
 * Desktop publication's I/O boundary. Reads return SHA-256 or undefined only
 * for missing objects; every other remote failure must reject. Writes must
 * finish before resolving. The operator owns credentials and process lifetime.
 * `release` validates tag provenance before returning existing asset digests;
 * `finishRelease` marks the completed release latest. A fake in-memory adapter
 * can exercise `publishPlan` without network access.
 */
export type PublicationTransport = {
  objectDigest(key: string): Promise<string | undefined>;
  putObject(upload: Upload): Promise<void>;
  release(
    version: string,
    commit: string,
  ): Promise<Record<string, string | undefined>>;
  ensureRelease(version: string, commit: string): Promise<void>;
  uploadAsset(version: string, asset: Asset): Promise<void>;
  assetDigest(version: string, name: string): Promise<string | undefined>;
  finishRelease(version: string): Promise<void>;
};

const macFeed = z.object({
  currentRelease: z.string(),
  releases: z.array(
    z.object({
      version: z.string(),
      updateTo: z.object({ version: z.string(), url: z.string() }),
    }),
  ),
});

/**
 * Reads target directories and validates receipts, SOURCE, exact checksum
 * inventories and updater references before producing a publication plan.
 * Only signed artifacts can enter the public feed. All targets must share one
 * source commit. No files or remote state are changed; invalid/incomplete
 * inventories reject. `directory` owns version/target subdirectories.
 *
 * @example
 * const plan = await preparePublication('out/release', '1.2.3', ['darwin-x64']);
 */
export async function preparePublication(
  directory: string,
  version: string,
  selected: readonly DesktopTarget[],
): Promise<Plan> {
  assert(/^\d+\.\d+\.\d+$/.test(version), "Release version must be x.y.z");
  assert(
    selected.length > 0 && new Set(selected).size === selected.length,
    "Choose distinct release targets",
  );
  const uploads: Upload[] = [];
  const assets: Asset[] = [];
  let commit: string | undefined;
  for (const target of selected) {
    const folder = join(directory, version, parseTarget(target));
    const receipt = BuildReceipt.parse(
      JSON.parse(await readFile(join(folder, "BUILD.json"), "utf8")),
    );
    assert(
      receipt.target === target && receipt.version === version,
      `${target}: receipt target/version mismatch`,
    );
    assert(
      receipt.signing === "signed",
      `${target}: unsigned artifacts cannot enter the public release channel`,
    );
    assert(
      (await readFile(join(folder, "SOURCE"), "utf8")).trim() ===
        receipt.commit,
      `${target}: SOURCE mismatch`,
    );
    assert(
      commit === undefined || commit === receipt.commit,
      "Targets were built from different commits",
    );
    commit = receipt.commit;
    const names = new Set(receipt.files.map((file) => file.name));
    assert(
      names.size === receipt.files.length,
      `${target}: duplicate receipt filenames`,
    );
    assert(
      !["BUILD.json", "SOURCE", "SHA256SUMS"].some((name) => names.has(name)),
      `${target}: receipt contains reserved filenames`,
    );
    const checksums = (await readFile(join(folder, "SHA256SUMS"), "utf8"))
      .trim()
      .split(/\r?\n/)
      .sort();
    assert.deepEqual(
      checksums,
      receipt.files.map((file) => `${file.sha256}  ${file.name}`).sort(),
      `${target}: checksum inventory mismatch`,
    );
    for (const file of receipt.files) {
      const path = join(folder, file.name);
      assert(
        (await stat(path)).size === file.size &&
          (await sha256(path)) === file.sha256,
        `${target}: corrupt artifact ${file.name}`,
      );
    }
    const base = `${targetPlatform(target)}/${targetArch(target)}`;
    const stem = `OpenChart-${version}-${target}`;
    const windows = target === "win32-x64";
    const feed = windows ? "RELEASES" : "RELEASES.json";
    const installer = windows ? `${stem}-setup.exe` : `${stem}.dmg`;
    assert(
      names.has(installer) && names.has(feed),
      `${target}: installer or feed missing`,
    );
    if (windows) {
      const entries = (await readFile(join(folder, feed), "utf8"))
        .trim()
        .split(/\r?\n/);
      assert(entries.length > 0, "Windows RELEASES is empty");
      const referenced = new Set<string>();
      for (const entry of entries) {
        const match = /^([a-f0-9]{40}) ([A-Za-z0-9._-]+\.nupkg) (\d+)$/i.exec(
          entry,
        );
        assert(match, "Invalid Squirrel RELEASES entry");
        const digest = match[1]!;
        const name = match[2]!;
        const size = match[3]!;
        assert(
          name === `OpenChart-${version}-full.nupkg`,
          "Unexpected Windows update package/version",
        );
        assert(
          names.has(name) && !referenced.has(name),
          "Windows feed references missing or duplicate package",
        );
        referenced.add(name);
        const hash = createHash("sha1");
        for await (const chunk of createReadStream(join(folder, name)))
          hash.update(chunk);
        assert(
          hash.digest("hex") === digest.toLowerCase() &&
            (await stat(join(folder, name))).size === Number(size),
          "Windows feed checksum/size mismatch",
        );
      }
    } else {
      assert(names.has(`${stem}.zip`), `${target}: update ZIP missing`);
      const parsed = macFeed.parse(
        JSON.parse(await readFile(join(folder, feed), "utf8")),
      );
      assert(
        parsed.currentRelease === version && parsed.releases.length === 1,
        `${target}: feed version mismatch`,
      );
      const release = parsed.releases[0]!;
      assert(
        release.version === version &&
          release.updateTo.version === version &&
          release.updateTo.url === `${releaseRoot}/${base}/${stem}.zip`,
        `${target}: feed points to the wrong target or version`,
      );
    }
    const addUpload = async (
      name: string,
      remoteName: string,
      kind: Upload["kind"],
    ) => {
      const path = join(folder, name);
      const digest = await sha256(path);
      uploads.push({
        path,
        name,
        sha256: digest,
        key: `openchart/${base}/${remoteName}`,
        kind,
      });
      return { path, sha256: digest };
    };
    for (const file of receipt.files) {
      if (file.name === feed) continue;
      const asset = await addUpload(file.name, file.name, "immutable");
      assets.push({ ...asset, name: file.name });
    }
    for (const name of ["SHA256SUMS", "SOURCE", "BUILD.json"]) {
      const asset = await addUpload(name, `${name}-${version}`, "immutable");
      // Each target owns its metadata asset so adding a target on a retry never
      // changes another target's checksum inventory or overwrites legacy assets.
      assets.push({ ...asset, name: `${name}-${target}` });
    }
    await addUpload(
      installer,
      windows ? "OpenChartSetup.exe" : "OpenChart.dmg",
      "pointer",
    );
    await addUpload(feed, feed, "feed");
  }
  assert(commit);
  return { version, commit, uploads, assets };
}

/**
 * Publishes a verified desktop plan with immutable conflict checks and read-back
 * verification. Every immutable object and GitHub asset is checked before any
 * write. Downloads for all targets are verified before stable pointers and
 * feeds change. Identical bytes are skipped; conflicting immutable bytes or
 * remote errors reject without overwrite. A failed run can be retried with the
 * same plan. The caller owns authorization and the transport's credentials.
 *
 * @example
 * await publishPlan(plan, authenticatedTransport);
 */
export async function publishPlan(
  plan: Plan,
  transport: PublicationTransport,
): Promise<void> {
  const existing = new Map<string, string | undefined>();
  for (const upload of plan.uploads) {
    const digest = await transport.objectDigest(upload.key);
    existing.set(upload.key, digest);
    assert(
      upload.kind !== "immutable" ||
        digest === undefined ||
        digest === upload.sha256,
      `Immutable object conflicts: ${upload.key}`,
    );
  }
  const github = await transport.release(plan.version, plan.commit);
  for (const asset of plan.assets)
    assert(
      !(asset.name in github) || github[asset.name] === asset.sha256,
      `GitHub asset conflicts or has no digest: ${asset.name}`,
    );
  for (const kind of ["immutable", "pointer", "feed"] as const) {
    for (const upload of plan.uploads.filter((entry) => entry.kind === kind)) {
      if (existing.get(upload.key) === upload.sha256) continue;
      await transport.putObject(upload);
      assert(
        (await transport.objectDigest(upload.key)) === upload.sha256,
        `Upload verification failed: ${upload.key}`,
      );
    }
  }
  await transport.ensureRelease(plan.version, plan.commit);
  for (const asset of plan.assets) {
    if (github[asset.name] === asset.sha256) continue;
    await transport.uploadAsset(plan.version, asset);
    assert(
      (await transport.assetDigest(plan.version, asset.name)) === asset.sha256,
      `GitHub verification failed: ${asset.name}`,
    );
  }
  await transport.finishRelease(plan.version);
}

const run = promisify(execFile);
const repository = "longsurf-ai/openchart";
const releaseSchema = z.object({
  id: z.number(),
  assets: z.array(
    z.object({ name: z.string(), digest: z.string().nullable().optional() }),
  ),
});

async function github(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(
      (
        await run("gh", ["api", `repos/${repository}/${path}`], {
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout,
    );
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "stderr" in cause &&
      /\(HTTP 404\)/.test(String(cause.stderr))
    )
      return undefined;
    throw cause;
  }
}

function operatorTransport(notes: string): PublicationTransport {
  const readRelease = async (version: string) => {
    const value = await github(`releases/tags/v${version}`);
    return value === undefined ? undefined : releaseSchema.parse(value);
  };
  return {
    async objectDigest(key) {
      const url = new URL(`https://downloads.longsurf.ai/${key}`);
      url.searchParams.set("verify", Date.now().toString());
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(300_000),
      });
      if (response.status === 404) return undefined;
      assert(
        response.ok && response.body,
        `Download failed: ${key} (${response.status})`,
      );
      const hash = createHash("sha256");
      for await (const chunk of response.body) hash.update(chunk);
      return hash.digest("hex");
    },
    async putObject(upload) {
      await run(
        "npx",
        [
          "--yes",
          "wrangler@4.135.0",
          "r2",
          "object",
          "put",
          `openchart-releases/${upload.key}`,
          "--remote",
          "--file",
          upload.path,
          "--cache-control",
          upload.kind === "immutable"
            ? "public, max-age=31536000, immutable"
            : "no-store",
          ...(upload.kind === "pointer"
            ? ["--content-disposition", `attachment; filename="${upload.name}"`]
            : []),
          "--content-type",
          upload.name.endsWith(".json")
            ? "application/json"
            : upload.name.endsWith(".dmg")
              ? "application/x-apple-diskimage"
              : upload.name.endsWith(".exe")
                ? "application/vnd.microsoft.portable-executable"
                : upload.name.endsWith(".zip") || upload.name.endsWith(".nupkg")
                  ? "application/zip"
                  : "text/plain",
        ],
        { maxBuffer: 8 * 1024 * 1024 },
      );
    },
    async release(version, commit) {
      const reference = await github(`git/ref/tags/v${version}`);
      if (reference !== undefined) {
        const objectSchema = z.object({
          object: z.object({ type: z.string(), sha: z.string() }),
        });
        let object = objectSchema.parse(reference).object;
        for (let depth = 0; object.type === "tag" && depth < 5; depth++)
          object = objectSchema.parse(
            await github(`git/tags/${object.sha}`),
          ).object;
        assert(
          object.type === "commit" && object.sha === commit,
          "GitHub tag points to a different source commit",
        );
      }
      return Object.fromEntries(
        (await readRelease(version))?.assets.map((asset) => [
          asset.name,
          asset.digest?.replace(/^sha256:/, ""),
        ]) ?? [],
      );
    },
    async ensureRelease(version, commit) {
      if (await readRelease(version)) return;
      const directory = await mkdtemp(
        join(tmpdir(), "openchart-release-notes-"),
      );
      try {
        const file = join(directory, "notes.md");
        await writeFile(file, notes);
        await run("gh", [
          "release",
          "create",
          `v${version}`,
          "--repo",
          repository,
          "--target",
          commit,
          "--title",
          `OpenChart ${version}`,
          "--notes-file",
          file,
          "--draft",
        ]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async uploadAsset(version, asset) {
      const directory = await mkdtemp(
        join(tmpdir(), "openchart-release-asset-"),
      );
      try {
        const path = join(directory, asset.name);
        await copyFile(asset.path, path);
        await run("gh", [
          "release",
          "upload",
          `v${version}`,
          path,
          "--repo",
          repository,
        ]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async assetDigest(version, name) {
      return (await readRelease(version))?.assets
        .find((asset) => asset.name === name)
        ?.digest?.replace(/^sha256:/, "");
    },
    async finishRelease(version) {
      await run("gh", [
        "release",
        "edit",
        `v${version}`,
        "--repo",
        repository,
        "--draft=false",
        "--latest",
      ]);
    },
  };
}

async function main() {
  const [version, ...args] = process.argv.slice(2);
  assert(version, "Supply a release version");
  const dryRun = args.includes("--dry-run");
  const requested = args.filter((arg) => arg !== "--dry-run");
  const selected = requested.length ? requested.map(parseTarget) : targets;
  const plan = await preparePublication(
    resolve(import.meta.dirname, "../out/release"),
    version,
    selected,
  );
  const changelog = z
    .array(z.object({ version: z.string(), items: z.array(z.string()) }))
    .parse(
      JSON.parse(
        await readFile(
          new URL("../src/changelog/changelog.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  const notes = changelog
    .find((entry) => entry.version === version)
    ?.items.map((item) => `- ${item}`)
    .join("\n");
  assert(notes, "Release changelog is missing");
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          version,
          commit: plan.commit,
          targets: selected,
          uploads: plan.uploads.map(({ key, kind, sha256 }) => ({
            key,
            kind,
            sha256,
          })),
          githubAssets: plan.assets.map(({ name, sha256 }) => ({
            name,
            sha256,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  await publishPlan(plan, operatorTransport(notes));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
