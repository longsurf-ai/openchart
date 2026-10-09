// Purpose: Verify Workspace Dataset declarations, collection shapes and the managed script approval through the Resource router.
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

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

const hash = "a".repeat(64);

function dataset() {
  return {
    name: "US CPI",
    description: "BLS CPI-U, seasonally adjusted",
    source: { workspaceId: "wsp_test", path: "datasets/cpi.csv" },
    time: { column: "date" },
    columns: [{ name: "cpi", type: "number" as const }] as const,
    collection: { kind: "script" as const, path: "datasets/cpi.py" },
  };
}

test("creates a declaration whose script approval only the approve transition writes", async () => {
  const resource = caller.resources.workspace_dataset;
  const created = await resource.create(dataset());
  expect(created.id).toMatch(/^wsd_/);
  expect(created).toMatchObject({
    ...dataset(),
    approvedScriptHash: null,
    revision: 1,
  });
  await expect(
    resource.create({ ...dataset(), approvedScriptHash: hash } as never),
  ).rejects.toThrow();

  const approved = await resource.approveCollection({
    id: created.id,
    expectedRevision: created.revision,
    hash,
  });
  expect(approved).toMatchObject({ approvedScriptHash: hash, revision: 2 });
  await expect(
    resource.approveCollection({
      id: created.id,
      expectedRevision: approved.revision,
      hash,
    }),
  ).resolves.toMatchObject({ revision: 2 });

  // Client edits keep the approval; a changed script cannot match its hash.
  const renamed = await resource.patch({
    id: created.id,
    expectedRevision: approved.revision,
    operations: [{ op: "replace", path: "/name", value: "CPI" }],
  });
  expect(renamed).toMatchObject({ name: "CPI", approvedScriptHash: hash });
  await expect(
    resource.patch({
      id: created.id,
      expectedRevision: renamed.revision,
      operations: [{ op: "replace", path: "/approvedScriptHash", value: null }],
    }),
  ).rejects.toThrow();
});

test("accepts an agent prompt collection and no collection", async () => {
  const resource = caller.resources.workspace_dataset;
  const prompt = await resource.create({
    ...dataset(),
    collection: {
      kind: "agent_prompt",
      prompt: {
        agent: "analyst",
        model: { providerID: "codex", modelID: "tier1" },
        parts: [{ type: "text", text: "Refresh datasets/cpi.csv from BLS." }],
      },
    },
  });
  expect(prompt.collection?.kind).toBe("agent_prompt");
  const approved = await resource.approveCollection({
    id: prompt.id,
    expectedRevision: prompt.revision,
    hash,
  });
  // Only scripts are approved; an Agent prompt keeps its normal permissions.
  expect(approved).toMatchObject({ approvedScriptHash: null, revision: 1 });
  await expect(
    resource.create({ ...dataset(), collection: null }),
  ).resolves.toMatchObject({ collection: null });
});

test.each([
  [
    "a non-CSV data file",
    { source: { workspaceId: "wsp_test", path: "cpi.json" } },
  ],
  ["a non-Python script", { collection: { kind: "script", path: "cpi.sh" } }],
  [
    "duplicate columns",
    {
      columns: [
        { name: "cpi", type: "number" },
        { name: "cpi", type: "number" },
      ],
    },
  ],
  ["a column named time", { columns: [{ name: "time", type: "number" }] }],
  ["no columns", { columns: [] }],
  ["an unknown collection", { collection: { kind: "cron" } }],
])("rejects %s", async (_, change) => {
  await expect(
    caller.resources.workspace_dataset.create({
      ...dataset(),
      ...change,
    } as never),
  ).rejects.toThrow();
});
