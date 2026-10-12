// Purpose: Exercise persisted Formula columns through real Tea compilation and public watchlist RPCs.
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea";
import { ConfigProvider, Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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

const code =
  'import ./lib/value\nlength = input.int(14, "Length", minval = 1, maxval = 100)\nemit "value" value.scale(close, length)\nplot("line", close, "Close")\nemit "label" "unsupported sibling"\n';
const library = 'library("value")\nexport scale(x, length) => x * length\n';

async function fixture() {
  const workspaceId = await caller.resources.workspace.getDefault();
  const write = (path: string, text: string, expected: string | null) =>
    caller.workspace.write({ workspaceId, path, text, expected });
  const entry = await write("formula.tea", code, null);
  const imported = await write("lib/value.tea", library, null);
  const watchlist = await caller.resources.watchlist.create({
    name: "Formula",
    columns: [{ id: "wcl_price", metric: { kind: "price" } }],
  });
  const input = {
    id: watchlist.id,
    expectedRevision: watchlist.revision,
    source: { workspaceId, path: entry.path },
    parameterOverrides: { length: 10 },
    output: "value",
    bars: { resolution: "1d" as const },
  };
  return { watchlist, input, write, entry, imported };
}

test("adds duplicate programs under independent IDs, captures imports, configures saved code, and separates hiding from deletion", async () => {
  const { watchlist, input, write, entry } = await fixture();
  const first = await caller.resources.watchlist.addFormulaColumn({
    ...input,
    title: "Score",
  });
  expect(first.revision).toBe(watchlist.revision + 1);
  expect(first.columns[1]).toEqual({
    id: expect.stringMatching(/^wcl_/),
    visible: true,
    title: "Score",
    metric: {
      kind: "formula",
      source: input.source,
      snapshot: { "formula.tea": code, "lib/value.tea": library },
      parameterOverrides: { length: 10 },
      output: "value",
      bars: { resolution: "1d" },
    },
  });
  const second = await caller.resources.watchlist.addFormulaColumn({
    ...input,
    expectedRevision: first.revision,
    output: "line",
  });
  expect(second.columns[1]?.id).not.toBe(second.columns[2]?.id);

  // Configuration must compile the saved snapshot, even after source breaks.
  await write(entry.path, "not valid Tea !!", entry.hash);
  const columnId = second.columns[1]!.id;
  const settings = {
    id: second.id,
    expectedRevision: second.revision,
    columnId,
    parameterOverrides: { length: 20 },
    output: "line",
    bars: {
      resolution: "1h" as const,
      session: "regular" as const,
      adjustment: "raw" as const,
    },
  };
  const configured =
    await caller.resources.watchlist.configureFormulaColumn(settings);
  expect(configured.columns[1]).toMatchObject({
    id: columnId,
    visible: true,
    metric: {
      output: "line",
      parameterOverrides: { length: 20 },
      snapshot: { "formula.tea": code, "lib/value.tea": library },
    },
  });
  expect(configured.columns[1]).not.toHaveProperty("title");
  expect(configured.columns[2]).toEqual(second.columns[2]);
  expect(
    await caller.resources.watchlist.configureFormulaColumn({
      ...settings,
      expectedRevision: configured.revision,
    }),
  ).toEqual(configured);

  const hidden = await caller.resources.watchlist.patch({
    id: configured.id,
    expectedRevision: configured.revision,
    operations: [{ op: "replace", path: "/columns/1/visible", value: false }],
  });
  expect(hidden.columns[1]).toEqual({
    ...configured.columns[1],
    visible: false,
  });
  const removed = await caller.resources.watchlist.patch({
    id: hidden.id,
    expectedRevision: hidden.revision,
    operations: [{ op: "remove", path: "/columns/1" }],
  });
  expect(removed.columns).toEqual([hidden.columns[0], hidden.columns[2]]);
  await expect(
    caller.resources.watchlist.get({ id: removed.id }),
  ).resolves.toEqual(removed);
  await expect(caller.workspace.read(input.source)).resolves.toMatchObject({
    entry: { path: entry.path },
  });
});

test("invalid source, output, overrides, built-in targets and missing columns save nothing and release compiled programs", async () => {
  const { watchlist, input } = await fixture();
  const tea = await runtime.runPromise(Tea.Service);
  const dispose = vi.spyOn(tea, "dispose");
  const invalidChanges: Array<{
    output?: string;
    parameterOverrides?: Tea.ParameterOverrides;
  }> = [
    { output: "missing" },
    { output: "label" },
    { parameterOverrides: { missing: 1 } },
    { parameterOverrides: { length: 0 } },
    { parameterOverrides: { length: 2.5 } },
    { parameterOverrides: { length: "wrong" } },
  ];
  for (const change of invalidChanges) {
    await expect(
      caller.resources.watchlist.addFormulaColumn({ ...input, ...change }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect(dispose).toHaveBeenCalledTimes(6);
  await expect(
    caller.resources.watchlist.addFormulaColumn({
      ...input,
      source: { ...input.source, path: "missing.tea" },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.watchlist.addFormulaColumn({
      ...input,
      expectedRevision: 99,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const settings = {
    id: watchlist.id,
    expectedRevision: watchlist.revision,
    columnId: "wcl_price",
    output: "value",
    parameterOverrides: {},
    bars: input.bars,
  };
  await expect(
    caller.resources.watchlist.configureFormulaColumn(settings),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.watchlist.configureFormulaColumn({
      ...settings,
      columnId: "wcl_missing",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller.resources.watchlist.get({ id: watchlist.id }),
  ).resolves.toEqual(watchlist);
});

test("reload captures import edits, preserves equal revisions, and rolls back removed outputs, invalid overrides and missing imports", async () => {
  const { input, write, entry, imported } = await fixture();
  const added = await caller.resources.watchlist.addFormulaColumn(input);
  const reloadInput = {
    id: added.id,
    expectedRevision: added.revision,
    columnId: added.columns[1]!.id,
  };
  expect(
    await caller.resources.watchlist.reloadFormulaColumn(reloadInput),
  ).toEqual(added);
  const editedLibrary = library.replace("x * length", "x + length");
  const nextImport = await write(imported.path, editedLibrary, imported.hash);
  const reloaded =
    await caller.resources.watchlist.reloadFormulaColumn(reloadInput);
  expect(reloaded.revision).toBe(added.revision + 1);
  expect(reloaded.columns[1]?.metric).toMatchObject({
    snapshot: { "formula.tea": code, "lib/value.tea": editedLibrary },
  });

  const reload = () =>
    caller.resources.watchlist.reloadFormulaColumn({
      ...reloadInput,
      expectedRevision: reloaded.revision,
    });
  const removedOutput = await write(
    entry.path,
    code.replace('emit "value"', 'emit "removed"'),
    entry.hash,
  );
  await expect(reload()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("value"),
  });
  const invalidOverride = await write(
    entry.path,
    code
      .replace("input.int(14", "input.int(3")
      .replace("maxval = 100", "maxval = 5"),
    removedOutput.hash,
  );
  await expect(reload()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("allowed range"),
  });
  await write(entry.path, code, invalidOverride.hash);
  await caller.workspace.remove({
    workspaceId: input.source.workspaceId,
    path: imported.path,
    expected: nextImport.hash,
  });
  await expect(reload()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.watchlist.get({ id: reloaded.id }),
  ).resolves.toEqual(reloaded);
});

test("a concurrent edit during compilation fails the final revision check without losing that edit", async () => {
  const { watchlist, input } = await fixture();
  const tea = await runtime.runPromise(Tea.Service);
  const compile = tea.compile;
  let concurrent: typeof watchlist | undefined;
  vi.spyOn(tea, "compile").mockImplementationOnce((request) =>
    Effect.gen(function* () {
      const compiled = yield* compile(request);
      concurrent = yield* Effect.promise(() =>
        caller.resources.watchlist.patch({
          id: watchlist.id,
          expectedRevision: watchlist.revision,
          operations: [
            { op: "replace", path: "/name", value: "Concurrent edit" },
          ],
        }),
      );
      return compiled;
    }),
  );
  const dispose = vi.spyOn(tea, "dispose");
  await expect(
    caller.resources.watchlist.addFormulaColumn(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(dispose).toHaveBeenCalledTimes(1);
  await expect(
    caller.resources.watchlist.get({ id: watchlist.id }),
  ).resolves.toEqual(concurrent);
});

test("generic patches validate structure while named settings reject invalid Formula semantics", async () => {
  const { input } = await fixture();
  const added = await caller.resources.watchlist.addFormulaColumn(input);
  const tea = await runtime.runPromise(Tea.Service);
  const compile = vi.spyOn(tea, "compile");
  const patched = await caller.resources.watchlist.patch({
    id: added.id,
    expectedRevision: added.revision,
    operations: [
      { op: "replace", path: "/columns/1/metric/output", value: "missing" },
    ],
  });
  expect(compile).not.toHaveBeenCalled();
  const settings = {
    id: patched.id,
    expectedRevision: patched.revision,
    columnId: patched.columns[1]!.id,
    output: "missing",
    parameterOverrides: input.parameterOverrides,
    bars: input.bars,
  };
  await expect(
    caller.resources.watchlist.configureFormulaColumn(settings),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.watchlist.configureFormulaColumn({
      ...settings,
      output: "value",
      parameterOverrides: { length: 101 },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.resources.watchlist.configureFormulaColumn({
      ...settings,
      expectedRevision: added.revision,
      output: "value",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller.resources.watchlist.reloadFormulaColumn({
      id: patched.id,
      expectedRevision: added.revision,
      columnId: settings.columnId,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller.resources.watchlist.get({ id: patched.id }),
  ).resolves.toEqual(patched);
});
