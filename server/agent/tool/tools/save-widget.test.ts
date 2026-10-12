// Purpose: Verify the Agent saves widget files through the checked Custom Widget transition and existing permissions.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Tool } from "@openchart/server/agent/tool/tool";
import { Workflow } from "@openchart/server/agent/workflow";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { SaveWidgetTool } from "./save-widget";

const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
const context: Tool.Context = {
  rootRunID: "agr_test",
  sessionID: "session",
  messageID: "message",
  callID: "call",
  agent: "analyst",
  messages: [],
  metadata: () => Effect.void,
  ask,
};
// No selected Workspace: the tool saves from the default one.
const workflow = Workflow.Service.of({
  settings: { concurrency: 5 },
  parentPrompt: {
    agent: "analyst",
    model: { providerID: "codex", modelID: "tier4" },
    parts: [],
  },
  agent: () => Effect.die("Saving never invokes another Agent"),
});
let home: string;
let runtime: ReturnType<typeof makeRuntime>;
beforeEach(() => {
  ask.mockReset().mockImplementation(() => Effect.void);
  home = temporaryHome();
  runtime = makeRuntime({ home, databasePath: ":memory:" });
});
afterEach(async () => {
  await runtime.dispose();
});

async function invoke(input: unknown) {
  const output = await runtime.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* SaveWidgetTool);
      return yield* tool.execute(input, context);
    }).pipe(Effect.provideService(Workflow.Service, workflow)),
  );
  if (output.output.type !== "text") throw new Error("Expected JSON text");
  return JSON.parse(output.output.value);
}

test("saves a widget file, returns its placement kind and repairs from diagnostics", async () => {
  await runtime.context();
  const file = path.join(
    home,
    "workspaces/default/widgets/price-chart.widget.tsx",
  );
  const source = await readFile(
    new URL("../../../../docs/agent/price-chart.widget.tsx", import.meta.url),
    "utf8",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source.replace("countBack: 250", 'countBack: "250"'));
  const rejected = await invoke({ path: "widgets/price-chart.widget.tsx" });
  expect(rejected).toMatchObject({
    status: "rejected",
    code: "widget.invalid",
  });
  expect(rejected.message).toMatch(
    /price-chart\.widget\.tsx\(\d+,\d+\): error TS2322/,
  );

  await writeFile(file, source);
  const saved = await invoke({ path: "widgets/price-chart.widget.tsx" });
  expect(saved).toMatchObject({
    status: "ok",
    resource: "custom_widget",
    entity: { kind: "price-chart", revision: 1 },
    placementKind: "custom:price-chart",
  });
  expect(saved.entity).not.toHaveProperty("snapshot");
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      permission: "save_widget",
      patterns: ["custom_widget"],
    }),
  );
});
