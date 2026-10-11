// Purpose: Collection admits Agent prompts and refuses unapproved scripts before running anything.
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Monitoring } from "@openchart/server/monitoring";
import { makeRuntime } from "@openchart/server/runtime";
import { AgentRunStore } from "@openchart/server/agent/run/store";
import { SessionExecution } from "@openchart/server/agent/session/execution";
import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Collection } from "./collection";
import * as uvModule from "./uv";
import { fakeUv } from "./uv.test-utils";

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
  vi.restoreAllMocks();
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
    cause: {
      reason: "its collection script or execution settings need approval",
    },
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

test.each([false, true])(
  "Agent collections use the Dataset workspace when the prompt's workspace is wrong or absent (%s)",
  async (explicit) => {
    const workspace = await caller.resources.workspace.createLocal();
    const defaultId = await caller.resources.workspace.getDefault();
    const collection = {
      kind: "agent_prompt" as const,
      prompt: {
        agent: "analyst",
        model: { providerID: "codex", modelID: "tier1" },
        parts: [{ type: "text", text: "Refresh." }],
        ...(explicit ? { workspaceId: defaultId } : {}),
      },
    };
    const created = await caller.resources.workspace_dataset.create({
      name: "Other workspace",
      description: null,
      source: { workspaceId: workspace.id, path: "data.csv" },
      time: { column: "date" },
      columns: [{ name: "value", type: "number" }],
      collection,
    });
    const admitted = await caller.collection.collect({ id: created.id });
    if (admitted.kind !== "agent_prompt")
      throw new Error("Expected an Agent Run");
    const run = await runtime.runPromise(
      AgentRunStore.Service.use((store) => store.get(admitted.runId)),
    );
    expect(run?.input.workspaceId).toBe(workspace.id);
  },
);

test("serializes prompt admission, replays intents, and blocks active work across Collection lifetimes", async () => {
  const created = await dataset({
    kind: "agent_prompt",
    prompt: {
      agent: "analyst",
      model: { providerID: "codex", modelID: "tier1" },
      parts: [{ type: "text", text: "Refresh." }],
    },
  });
  const withoutExecution = {
    active: Effect.succeed(new Set<string>()),
    wake: () => Effect.void,
    interrupt: () => Effect.void,
  };
  const first = await runtime.runPromise(
    Effect.gen(function* () {
      const collector = yield* Collection.Service;
      const results = yield* Effect.all(
        [
          Effect.exit(collector.collect(created.id, "first")),
          Effect.exit(collector.collect(created.id, "second")),
        ],
        { concurrency: "unbounded" },
      );
      const successful = results.filter(Exit.isSuccess);
      expect(successful).toHaveLength(1);
      expect(results.filter(Exit.isFailure)).toHaveLength(1);
      const admitted = successful[0]!.value;
      if (admitted.kind !== "agent_prompt")
        throw new Error("Expected an Agent Run");
      const store = yield* AgentRunStore.Service;
      const run = (yield* store.get(admitted.runId))!;
      const intent = run.sessionIntentID.endsWith(":first")
        ? "first"
        : "second";
      expect(yield* collector.collect(created.id, intent)).toEqual(admitted);
      return admitted;
    }).pipe(
      Effect.provide(Layer.fresh(Collection.layer)),
      Effect.provideService(SessionExecution.Service, withoutExecution),
    ),
  );

  await runtime.runPromise(
    Effect.gen(function* () {
      const collector = yield* Collection.Service;
      const store = yield* AgentRunStore.Service;
      expect(
        Exit.isFailure(
          yield* Effect.exit(collector.collect(created.id, "third")),
        ),
      ).toBe(true);
      yield* store.claim(first.sessionId);
      expect(
        Exit.isFailure(
          yield* Effect.exit(collector.collect(created.id, "third")),
        ),
      ).toBe(true);
      yield* store.complete(first.runId);
      const next = yield* collector.collect(created.id, "third");
      expect(next).not.toEqual(first);
    }).pipe(
      Effect.provide(Layer.fresh(Collection.layer)),
      Effect.provideService(SessionExecution.Service, withoutExecution),
    ),
  );
});

test("keeps checked script bytes through installation and reports later workspace failures", async () => {
  const workspace = await caller.resources.workspace.createLocal();
  const saved = await caller.workspace.write({
    workspaceId: workspace.id,
    path: "collect.py",
    text: "require('node:fs').writeFileSync(process.env.OPENCHART_OUTPUT, 'approved');",
    expected: null,
  });
  const created = await caller.resources.workspace_dataset.create({
    name: "Collected",
    description: null,
    source: { workspaceId: workspace.id, path: "data.csv" },
    time: { column: "date" },
    columns: [{ name: "value", type: "number" }],
    collection: { kind: "script", path: "collect.py" },
  });
  await caller.resources.workspace_dataset.approveCollection({
    id: created.id,
    expectedRevision: created.revision,
    hash: saved.hash,
  });
  const uv = await fakeUv(workspace.root);
  vi.spyOn(uvModule, "installUv").mockImplementation(() =>
    Effect.promise(async () => {
      await writeFile(
        path.join(workspace.root, "collect.py"),
        "throw new Error('unapproved');",
      );
      return uv;
    }),
  );
  const health = async () =>
    (
      await runtime.runPromise(
        Monitoring.Service.use((monitoring) => monitoring.status),
      )
    ).find((status) => status.key === `collection/${created.id}`)?.health;
  await caller.collection.collect({ id: created.id });
  await vi.waitFor(async () => expect((await health())?.state).toBe("healthy"));
  expect(await readFile(path.join(workspace.root, "data.csv"), "utf8")).toBe(
    "approved",
  );
  await caller.resources.workspace.forget({ id: workspace.id });
  await expect(
    caller.collection.collect({ id: created.id }),
  ).rejects.toMatchObject({ cause: { _tag: "WorkspaceUnknown" } });
  expect(await health()).toMatchObject({
    state: "failed",
    reason: { code: "collection.workspace_missing" },
  });
});
