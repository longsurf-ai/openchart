// Purpose: Collection admits Agent prompts and refuses unapproved scripts before running anything.
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Monitoring } from "@openchart/server/monitoring";
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

async function dataset(
  collection: Parameters<
    typeof caller.resources.workspace_dataset.create
  >[0]["collection"],
) {
  const workspaceId = await caller.resources.workspace.getDefault();
  return caller.resources.workspace_dataset.create({
    name: "US CPI",
    description: null,
    source: { workspaceId, path: "datasets/cpi.csv" },
    time: { column: "date" },
    columns: [{ name: "cpi", type: "number" }],
    collection,
  });
}

test("a Dataset without a collection cannot be collected", async () => {
  const { id } = await dataset(null);
  await expect(caller.collection.collect({ id })).rejects.toMatchObject({
    cause: { _tag: "Resource.StateInvalid" },
  });
});

test("a script runs only after its current content is approved", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  const script = await caller.workspace.write({
    workspaceId,
    path: "datasets/cpi.py",
    text: "print('collect')\n",
    expected: null,
  });
  const created = await dataset({ kind: "script", path: "datasets/cpi.py" });
  await expect(
    caller.collection.collect({ id: created.id }),
  ).rejects.toMatchObject({
    cause: { reason: "its collection script changed since it was approved" },
  });
  const statuses = await runtime.runPromise(
    Monitoring.Service.use((monitoring) => monitoring.status),
  );
  expect(
    statuses.find((status) => status.key === `collection/${created.id}`),
  ).toMatchObject({ label: "US CPI", health: { state: "failed" } });

  // Approving other content does not unlock this script.
  await caller.resources.workspace_dataset.approveCollection({
    id: created.id,
    expectedRevision: created.revision,
    hash: "0".repeat(64),
  });
  await expect(
    caller.collection.collect({ id: created.id }),
  ).rejects.toMatchObject({ cause: { _tag: "Resource.StateInvalid" } });
  expect(script.hash).toMatch(/^[a-f0-9]{64}$/);
});

test("an Agent prompt is admitted as a Run with the Dataset attached", async () => {
  const { id } = await dataset({
    kind: "agent_prompt",
    prompt: {
      agent: "analyst",
      model: { providerID: "codex", modelID: "tier1" },
      parts: [{ type: "text", text: "Refresh US CPI from BLS." }],
    },
  });
  await expect(caller.collection.collect({ id })).resolves.toMatchObject({
    kind: "agent_prompt",
    runId: expect.any(String),
    sessionId: expect.any(String),
  });
});
