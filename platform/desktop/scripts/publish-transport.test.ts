// Purpose: Exercise the real publication command adapter against GitHub draft/published API behavior without network mutations.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { operatorTransport, publishPlan } from "./publish.ts";

const commands = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: commands.run,
  }),
}));

const version = "1.2.3";
const commit = "a".repeat(40);
type Release = {
  id: number;
  tag_name: string;
  draft: boolean;
  target_commitish: string;
  assets: Array<{ name: string; digest: string }>;
};
const directories: string[] = [];
afterEach(async () => {
  commands.run.mockReset();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  options: { release?: Release; tag?: string; viewError?: Error } = {},
) {
  const directory = await mkdtemp(
    join(tmpdir(), "openchart-publication-transport-"),
  );
  directories.push(directory);
  const assets = await Promise.all(
    ["first.zip", "second.dmg"].map(async (name) => {
      const path = join(directory, name);
      await writeFile(path, name);
      return {
        path,
        name,
        sha256: createHash("sha256").update(name).digest("hex"),
      };
    }),
  );
  const plan = {
    version,
    commit,
    assets,
    uploads: assets.map((asset) => ({
      ...asset,
      key: `openchart/fixture/${asset.name}`,
      kind: "immutable" as const,
    })),
  };
  const state = {
    release: options.release,
    tag: options.tag,
    writes: [] as string[],
  };
  const response = (value: unknown) => ({
    stdout: JSON.stringify(value),
    stderr: "",
  });
  const missing = () =>
    Object.assign(new Error("Not Found"), {
      stderr: "gh: Not Found (HTTP 404)",
    });
  commands.run.mockImplementation(async (command: string, args: string[]) => {
    expect(command).toBe("gh");
    if (args[0] === "api") {
      const route = args[1]!;
      if (route.endsWith(`/git/ref/tags/v${version}`)) {
        if (!state.tag) throw missing();
        return response({ object: { type: "commit", sha: state.tag } });
      }
      // Match GitHub: the tag endpoint does not return drafts.
      if (route.endsWith(`/releases/tags/v${version}`)) {
        if (!state.release || state.release.draft) throw missing();
        return response(state.release);
      }
      if (route.endsWith("/releases/101") && state.release)
        return response(state.release);
      throw new Error(`Unexpected API route ${route}`);
    }
    expect(args[0]).toBe("release");
    expect(args[2]).toBe(`v${version}`);
    if (args[1] === "view") {
      expect(args.slice(-2)).toEqual(["--json", "databaseId"]);
      if (options.viewError) throw options.viewError;
      if (!state.release)
        throw Object.assign(new Error("release not found"), {
          stderr: "release not found\n",
        });
      return response({ databaseId: state.release.id });
    }
    if (args[1] === "create") {
      expect(state.release).toBeUndefined();
      expect(args).toContain("--draft");
      expect(
        await readFile(args[args.indexOf("--notes-file") + 1]!, "utf8"),
      ).toBe("Release notes\nwith literal $characters.");
      state.release = {
        id: 101,
        tag_name: `v${version}`,
        draft: true,
        target_commitish: args[args.indexOf("--target") + 1]!,
        assets: [],
      };
      state.writes.push("create-draft");
    } else if (args[1] === "upload") {
      expect(state.release?.draft).toBe(true);
      const file = args[3]!;
      const name = basename(file);
      expect(state.release!.assets.some((asset) => asset.name === name)).toBe(
        false,
      );
      state.release!.assets.push({
        name,
        digest: `sha256:${createHash("sha256")
          .update(await readFile(file))
          .digest("hex")}`,
      });
      state.writes.push(`upload:${name}`);
    } else if (args[1] === "edit") {
      expect(args).toContain("--draft=false");
      state.release!.draft = false;
      state.tag = state.release!.target_commitish;
      state.writes.push("publish");
    } else throw new Error(`Unexpected release command ${args[1]}`);
    return response({});
  });
  const adapter = operatorTransport("Release notes\nwith literal $characters.");
  const objects = new Map<string, string>();
  adapter.objectDigest = async (key) => objects.get(key);
  adapter.putObject = async (upload) => {
    objects.set(upload.key, upload.sha256);
    state.writes.push(`object:${upload.name}`);
  };
  return { plan, adapter, state, assets };
}

test("creates a draft, verifies uploaded asset digests by release ID, then publishes", async () => {
  const f = await fixture();
  await publishPlan(f.plan, f.adapter);
  expect(f.state.writes).toEqual([
    "object:first.zip",
    "object:second.dmg",
    "create-draft",
    "upload:first.zip",
    "upload:second.dmg",
    "publish",
  ]);
  expect(f.state.release).toMatchObject({
    draft: false,
    target_commitish: commit,
  });
  expect(
    commands.run.mock.calls.filter(
      ([, args]) => args[0] === "api" && args[1].endsWith("/releases/101"),
    ),
  ).toHaveLength(2);
});

test("resumes an existing draft and skips its already verified assets", async () => {
  const digest = createHash("sha256").update("first.zip").digest("hex");
  const f = await fixture({
    release: {
      id: 101,
      tag_name: `v${version}`,
      draft: true,
      target_commitish: commit,
      assets: [{ name: "first.zip", digest: `sha256:${digest}` }],
    },
  });
  await publishPlan(f.plan, f.adapter);
  expect(f.state.writes).toEqual([
    "object:first.zip",
    "object:second.dmg",
    "upload:second.dmg",
    "publish",
  ]);
});

test("rejects a draft with the wrong source commit before object or asset uploads", async () => {
  const f = await fixture({
    release: {
      id: 101,
      tag_name: `v${version}`,
      draft: true,
      target_commitish: "b".repeat(40),
      assets: [],
    },
  });
  await expect(publishPlan(f.plan, f.adapter)).rejects.toThrow(
    "draft targets a different source commit",
  );
  expect(f.state.writes).toEqual([]);
});

test("retains published tag provenance checks", async () => {
  const f = await fixture({
    tag: "b".repeat(40),
    release: {
      id: 101,
      tag_name: `v${version}`,
      draft: false,
      target_commitish: commit,
      assets: [],
    },
  });
  await expect(publishPlan(f.plan, f.adapter)).rejects.toThrow(
    "tag points to a different source commit",
  );
  expect(f.state.writes).toEqual([]);
});

test("propagates release lookup failures instead of treating them as a missing draft", async () => {
  const f = await fixture({
    viewError: Object.assign(new Error("API request failed"), {
      stderr: "HTTP 403: Resource not accessible",
    }),
  });
  await expect(publishPlan(f.plan, f.adapter)).rejects.toThrow(
    "API request failed",
  );
  expect(f.state.writes).toEqual([]);
});
