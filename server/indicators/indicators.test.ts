// Purpose: Built-ins are read-only originals; editable copies use the same Workspace compilation path.
import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { router } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { builtinIndicatorPaths, indicatorCatalog } from "./catalog";
const runtimes: ReturnType<typeof makeRuntime>[] = [];
const bundled = (id: string) =>
  readFile(new URL(`./builtins/${id}.tea`, import.meta.url), "utf8");
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

it("seeds the full library on startup, backfills partial workspaces, rewrites changed originals, protects originals, and repairs external deletions", async () => {
  const home = temporaryHome();
  const directory = join(
    home,
    "workspaces",
    "default",
    "indicators",
    "builtin",
  );
  const edited =
    'indicator("My SMA", overlay = true)\nplot("value", close, "Value")\n';
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "sma.tea"), edited);
  const start = async () => {
    const runtime = makeRuntime({
      home,
      models: { fetchEnabled: false, userAgent: "indicator-seed-test" },
    });
    runtimes.push(runtime);
    await runtime.context();
    return { runtime, rpc: router.createCaller({ runtime }) };
  };
  const first = await start();
  const workspaceId = await first.rpc.resources.workspace.getDefault();
  await expect
    .poll(async () => {
      const snapshot = await first.rpc.workspace.listTree({ workspaceId });
      return snapshot.status === "ready"
        ? snapshot.entries
            .map((entry) => entry.path)
            .filter((path) => path.endsWith(".tea"))
            .sort()
        : [];
    })
    .toEqual([...builtinIndicatorPaths].sort());
  // An original that differs from the bundle, such as one from an older
  // version, is rewritten.
  expect(await readFile(join(directory, "sma.tea"), "utf8")).toBe(
    await bundled("sma"),
  );
  const source = { workspaceId, path: "indicators/builtin/macd.tea" };
  const macd = await first.rpc.workspace.read(source);
  expect(macd.readOnly).toBe(true);
  await expect(
    first.rpc.workspace.write({
      ...source,
      text: edited,
      expected: macd.entry.hash,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await first.rpc.workspace.read(source)).entry.hash).toBe(
    macd.entry.hash,
  );
  await expect(
    first.rpc.workspace.remove({ ...source, expected: macd.entry.hash }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    first.rpc.workspace.rename({
      workspaceId,
      from: source.path,
      to: "macd.tea",
      expected: macd.entry.hash,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const copy = await first.rpc.workspace.write({
    workspaceId,
    path: "indicators/builtin/macd-copy.tea",
    text: edited,
    expected: null,
  });
  await expect(
    first.rpc.workspace.rename({
      workspaceId,
      from: copy.path,
      to: source.path,
      expected: copy.hash,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const renamed = await first.rpc.workspace.rename({
    workspaceId,
    from: copy.path,
    to: "indicators/my-macd.tea",
    expected: copy.hash,
  });
  await first.rpc.workspace.remove({
    workspaceId,
    path: renamed.path,
    expected: renamed.hash,
  });
  const otherRoot = join(home, "other-workspace");
  await mkdir(otherRoot);
  const other = await first.rpc.resources.workspace.register({
    root: otherRoot,
  });
  const custom = await first.rpc.workspace.write({
    workspaceId: other.id,
    path: source.path,
    text: edited,
    expected: null,
  });
  await first.rpc.workspace.remove({
    workspaceId: other.id,
    path: custom.path,
    expected: custom.hash,
  });
  await first.runtime.dispose();
  runtimes.splice(runtimes.indexOf(first.runtime), 1);
  await rm(join(directory, "macd.tea"));
  const second = await start();
  const nextId = await second.rpc.resources.workspace.getDefault();
  expect(nextId).toBe(workspaceId);
  await expect(
    second.rpc.workspace.read({ ...source, workspaceId: nextId }),
  ).resolves.toMatchObject({ entry: { path: source.path } });
  expect(await readFile(join(directory, "sma.tea"), "utf8")).toBe(
    await bundled("sma"),
  );
});

it("retries an incomplete startup seed and restores every original's bundled text", async () => {
  const home = temporaryHome();
  const directory = join(
    home,
    "workspaces",
    "default",
    "indicators",
    "builtin",
  );
  const blocked = join(directory, `${indicatorCatalog[1]!.id}.tea`);
  await mkdir(blocked, { recursive: true });
  const copied = join(directory, `${indicatorCatalog[0]!.id}.tea`);
  await writeFile(copied, "// an older original\nclose\n");
  const start = () => {
    const runtime = makeRuntime({
      home,
      models: { fetchEnabled: false, userAgent: "indicator-seed-test" },
    });
    runtimes.push(runtime);
    return runtime;
  };
  const failed = start();
  await expect(failed.context()).rejects.toThrow();
  await failed.dispose();
  runtimes.splice(runtimes.indexOf(failed), 1);
  await rm(blocked, { recursive: true });
  const recovered = start();
  await recovered.context();
  expect(await readFile(copied, "utf8")).toBe(
    await bundled(indicatorCatalog[0]!.id),
  );
  const rpc = router.createCaller({ runtime: recovered });
  const workspaceId = await rpc.resources.workspace.getDefault();
  await expect
    .poll(async () => {
      const snapshot = await rpc.workspace.listTree({ workspaceId });
      return snapshot.status === "ready"
        ? snapshot.entries.filter((entry) => entry.path.endsWith(".tea")).length
        : 0;
    })
    .toBe(builtinIndicatorPaths.size);
});
it("keeps originals read-only while copies remain editable and compile through Workspace", async () => {
  const home = temporaryHome();
  const runtime = makeRuntime({
    home,
    databasePath: ":memory:",
    models: { fetchEnabled: false, userAgent: "indicator-test" },
  });
  runtimes.push(runtime);
  await runtime.context();
  const rpc = router.createCaller({ runtime });
  const [first, second] = await Promise.all([
    rpc.indicators.install({ id: "sma" }),
    rpc.indicators.install({ id: "sma" }),
  ]);
  expect(first).toEqual(second);
  const original = await rpc.workspace.read(first);
  expect(original.readOnly).toBe(true);
  await expect(
    rpc.workspace.write({
      workspaceId: first.workspaceId,
      path: "INDICATORS/BUILTIN/SMA.tea",
      text: "close",
      expected: null,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const edited =
    'indicator("My average", overlay = false)\nlength = input.int(20)\nplot("average", ta.sma(close, length), "Average")\n';
  await expect(
    rpc.workspace.write({
      ...first,
      expected: original.entry.hash,
      text: edited,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await rpc.indicators.install({ id: "sma" });
  expect(await rpc.workspace.read(first)).toEqual(original);
  const copySource = {
    workspaceId: first.workspaceId,
    path: "indicators/sma-copy.tea",
  };
  const copy = await rpc.workspace.write({
    ...copySource,
    text: Buffer.from(original.base64, "base64").toString("utf8"),
    expected: null,
  });
  await rpc.workspace.write({
    ...copySource,
    text: edited,
    expected: copy.hash,
  });
  const read = await rpc.workspace.read(copySource);
  expect(read.readOnly).toBe(false);
  expect(Buffer.from(read.base64, "base64").toString("utf8")).toBe(edited);
  const node = await rpc.tea.compile(copySource);
  expect(node.declaration).toEqual({
    kind: "indicator",
    title: "My average",
    overlay: false,
    timeframe: "",
  });
  expect(node.definition.parameters[0]?.defaultValue).toBe(20);
  // The schemas arrive as Arrow JSON.
  expect(node.definition.outputs.fields).toContainEqual(
    expect.objectContaining({ name: "average" }),
  );
  await rpc.workspace.remove({ ...copySource, expected: read.entry.hash });
  // Tea reads the file itself, so a deleted copy no longer compiles.
  await expect(rpc.tea.compile(copySource)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await rpc.tea.dispose({ id: node.id });
  await rm(join(home, "workspaces", "default", first.path));
  await expect(
    rpc.workspace.write({ ...first, expected: null, text: edited }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await rpc.indicators.install({ id: "sma" });
  expect(await rpc.workspace.read(first)).toEqual(original);
  await expect(rpc.indicators.install({ id: "../sma" })).rejects.toThrow(
    "Unknown indicator",
  );
});
