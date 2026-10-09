// Purpose: Prove Resource changes drive Workspace Dataset lifecycles while file edits only change what selects read.
import { router } from "@openchart/server";
import { Catalog } from "@openchart/server/data";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider, Schema } from "effect";
import { SeriesSnapshot } from "@openchart/feed";
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
  await runtime.dispose();
});

const select = async (id: string, range: { from?: number; to?: number } = {}) =>
  Schema.decodeUnknownSync(SeriesSnapshot)(
    await caller.feed.series.select({ id, ...range }),
  ).data;

const names = async () =>
  (await runtime.runPromise(Catalog.use((catalog) => catalog.list()))).map(
    (dataset) => dataset.definition.name,
  );

test("publishes, re-declares and withdraws with the Resource; selects read the current file", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  const first = await caller.workspace.write({
    workspaceId,
    path: "datasets/cpi.csv",
    text: "date,cpi\n2024-02-01,309.7\n2024-01-01,308.4\n",
    expected: null,
  });
  const created = await caller.resources.workspace_dataset.create({
    name: "US CPI",
    description: null,
    source: { workspaceId, path: "datasets/cpi.csv" },
    time: { column: "date" },
    columns: [{ name: "cpi", type: "number" }],
    collection: null,
  });
  await vi.waitFor(async () =>
    expect(await names()).toContain(`workspace.${created.id}`),
  );
  const frame = await select(created.id);
  expect(Array.from(frame, (row) => [row.time, row.cpi])).toEqual([
    [Date.UTC(2024, 0, 1), 308.4],
    [Date.UTC(2024, 1, 1), 309.7],
  ]);
  expect(
    (await select(created.id, { from: Date.UTC(2024, 1, 1) })).numRows,
  ).toBe(1);

  // A collected file needs no new declaration: the next select reads it.
  await caller.workspace.write({
    workspaceId,
    path: "datasets/cpi.csv",
    text: "date,cpi\n2024-01-01,308.4\n2024-02-01,309.7\n2024-03-01,310.3\n",
    expected: first.hash,
  });
  expect((await select(created.id)).numRows).toBe(3);

  // A new column re-declares the Dataset under the same id.
  const before = (
    await runtime.runPromise(Catalog.use((catalog) => catalog.list()))
  ).find((dataset) => dataset.definition.name.endsWith(created.id))!;
  await caller.resources.workspace_dataset.patch({
    id: created.id,
    expectedRevision: created.revision,
    operations: [{ op: "replace", path: "/columns/0/type", value: "string" }],
  });
  await vi.waitFor(async () => {
    const after = (
      await runtime.runPromise(Catalog.use((catalog) => catalog.list()))
    ).find((dataset) => dataset.definition.name.endsWith(created.id));
    expect(after?.definition).not.toBe(before.definition);
  });
  expect(Array.from(await select(created.id), (row) => row.cpi)).toEqual([
    "308.4",
    "309.7",
    "310.3",
  ]);

  await caller.resources.workspace_dataset.delete({ id: created.id });
  await vi.waitFor(async () =>
    expect(await names()).not.toContain(`workspace.${created.id}`),
  );
  await expect(select(created.id)).rejects.toThrow();
});

test("a missing or mismatched file fails the select, not the Dataset", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  const created = await caller.resources.workspace_dataset.create({
    name: "Missing",
    description: null,
    source: { workspaceId, path: "datasets/missing.csv" },
    time: { column: "date" },
    columns: [{ name: "value", type: "number" }],
    collection: null,
  });
  await vi.waitFor(async () =>
    expect(await names()).toContain(`workspace.${created.id}`),
  );
  await expect(select(created.id)).rejects.toMatchObject({
    cause: { reason: { _tag: "Feed.NotFound" } },
  });
  await caller.workspace.write({
    workspaceId,
    path: "datasets/missing.csv",
    text: "date,value\n2024-01-01,abc\n",
    expected: null,
  });
  await expect(select(created.id)).rejects.toMatchObject({
    cause: { reason: { _tag: "Feed.InvalidSourceData" } },
  });
});
