// Purpose: dataset_select returns readable rows, or the file row a declaration rejected.
import { router } from "@openchart/server";
import * as Tool from "@openchart/server/agent/tool/tool";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider, Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DatasetSelectTool } from "./dataset-select";

const context: Tool.Context = {
  rootRunID: "agr_dataset_select",
  sessionID: "session",
  messageID: "message",
  callID: "call",
  agent: "analyst",
  messages: [],
  metadata: () => Effect.die("Unexpected progress"),
  ask: () => Effect.void,
};

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

const select = (id: string) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* DatasetSelectTool);
      return (yield* tool.execute({ id }, context)).output;
    }),
  );

test("reads rows, then names the row a changed file breaks", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  const file = await caller.workspace.write({
    workspaceId,
    path: "datasets/cpi.csv",
    text: "date,cpi\n2024-01-01,308.4\n2024-02-01,\n",
    expected: null,
  });
  const { id } = await caller.resources.workspace_dataset.create({
    name: "US CPI",
    description: null,
    source: { workspaceId, path: "datasets/cpi.csv" },
    time: { column: "date" },
    columns: [{ name: "cpi", type: "number" }],
    collection: null,
  });
  await vi.waitFor(async () =>
    expect(await select(id)).toEqual({
      type: "json",
      value: {
        status: "ok",
        rows: [
          { time: Date.UTC(2024, 0, 1), cpi: 308.4 },
          { time: Date.UTC(2024, 1, 1), cpi: null },
        ],
      },
    }),
  );
  await caller.workspace.write({
    workspaceId,
    path: "datasets/cpi.csv",
    text: "date,cpi\n2024-01-01,n/a\n",
    expected: file.hash,
  });
  expect(await select(id)).toEqual({
    type: "json",
    value: {
      status: "rejected",
      reason: "Feed.InvalidSourceData",
      detail: 'Row 2: "cpi" must be a number, not "n/a"',
    },
  });
});
