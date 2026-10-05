// Purpose: Prove Reload re-snapshots the Workspace script and its imports at the expected revision.
import { router } from "@openchart/server";
import { Events } from "@openchart/server/events";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const script = 'import ./lib/avg\nemit "value" avg.twice(close)\n';
const library = 'library("avg")\nexport twice(x) => x * 2\n';

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;

beforeEach(() => {
  runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  caller = router.createCaller({ runtime });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

/** An Indicator whose stored snapshot equals `study.tea` and `lib/avg.tea` on disk. */
async function indicatorFromWorkspace() {
  const workspaceId = await caller.resources.workspace.getDefault();
  const write = (path: string, text: string, expected: string | null) =>
    caller.workspace.write({ workspaceId, path, text, expected });
  const remove = ({ path, hash }: { path: string; hash: string }) =>
    caller.workspace.remove({ workspaceId, path, expected: hash });
  const scriptEntry = await write("study.tea", script, null);
  const libraryEntry = await write("lib/avg.tea", library, null);
  const dashboard = await caller.resources.dashboard.create({ name: "Reload" });
  const chart = await caller.resources.chart.create({
    dashboardId: dashboard.id,
  });
  const indicator = await caller.resources.indicator.create({
    chartId: chart.id,
    cellId: "ccl_reload",
    source: { workspaceId, path: "study.tea" },
    snapshot: { "study.tea": script, "lib/avg.tea": library },
    parameterOverrides: {},
  });
  const publish = vi.spyOn(await runtime.runPromise(Events.Service), "publish");
  return { indicator, scriptEntry, libraryEntry, write, remove, publish };
}

test("editing the script or an imported library saves the new snapshot at the next revision", async () => {
  const { indicator, scriptEntry, libraryEntry, write, publish } =
    await indicatorFromWorkspace();
  const editedScript = script.replace("close", "open");
  await write("study.tea", editedScript, scriptEntry.hash);
  const second = await caller.resources.indicator.reload({
    id: indicator.id,
    expectedRevision: indicator.revision,
  });
  expect(second).toMatchObject({
    ...indicator,
    revision: indicator.revision + 1,
    snapshot: { "study.tea": editedScript, "lib/avg.tea": library },
    updatedAt: expect.any(Number),
  });
  await expect(
    caller.resources.indicator.get({ id: indicator.id }),
  ).resolves.toEqual(second);
  expect(publish).toHaveBeenCalledWith(ResourceChanged, {
    resource: "indicator",
    id: indicator.id,
    revision: second.revision,
  });

  const editedLibrary = library.replace("x * 2", "x * 3");
  await write("lib/avg.tea", editedLibrary, libraryEntry.hash);
  const third = await caller.resources.indicator.reload({
    id: indicator.id,
    expectedRevision: second.revision,
  });
  expect(third.revision).toBe(second.revision + 1);
  expect(third.snapshot).toEqual({
    "study.tea": editedScript,
    "lib/avg.tea": editedLibrary,
  });
});

test("unchanged files keep the revision and publish no change", async () => {
  const { indicator, publish } = await indicatorFromWorkspace();
  await expect(
    caller.resources.indicator.reload({
      id: indicator.id,
      expectedRevision: indicator.revision,
    }),
  ).resolves.toEqual(indicator);
  await expect(
    caller.resources.indicator.get({ id: indicator.id }),
  ).resolves.toEqual(indicator);
  expect(publish).not.toHaveBeenCalledWith(
    ResourceChanged,
    expect.objectContaining({ resource: "indicator" }),
  );
});

test("a stale expected revision conflicts and saves nothing", async () => {
  const { indicator, scriptEntry, write } = await indicatorFromWorkspace();
  const patched = await caller.resources.indicator.patch({
    id: indicator.id,
    expectedRevision: indicator.revision,
    operations: [
      { op: "replace", path: "/parameterOverrides", value: { length: 5 } },
    ],
  });
  await write("study.tea", script.replace("close", "open"), scriptEntry.hash);
  await expect(
    caller.resources.indicator.reload({
      id: indicator.id,
      expectedRevision: indicator.revision,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller.resources.indicator.get({ id: indicator.id }),
  ).resolves.toEqual(patched);
});

test("a deleted import or script fails with the Tea compile error and leaves the Indicator unchanged", async () => {
  const { indicator, scriptEntry, libraryEntry, remove } =
    await indicatorFromWorkspace();
  const reload = () =>
    caller.resources.indicator.reload({
      id: indicator.id,
      expectedRevision: indicator.revision,
    });
  await remove(libraryEntry);
  await expect(reload()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("cannot find './lib/avg'"),
    cause: expect.objectContaining({ code: "compile_failed" }),
  });
  await remove(scriptEntry);
  await expect(reload()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining(scriptEntry.path),
    cause: expect.objectContaining({ code: "compile_failed" }),
  });
  await expect(
    caller.resources.indicator.get({ id: indicator.id }),
  ).resolves.toEqual(indicator);
});
