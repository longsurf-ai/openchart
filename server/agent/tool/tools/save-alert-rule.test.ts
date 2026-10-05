// Purpose: Verify the Agent saves Alerts through the validated Resource transition and existing permissions.
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProviderId } from "@openchart/market";
import { router } from "@openchart/server";
import { Tool } from "@openchart/server/agent/tool/tool";
import { DeclinedError } from "@openchart/server/agent/permission/errors";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea";
import { SaveAlertRuleTool } from "./save-alert-rule";
import { ResourceMutateTool } from "./resource-mutate";
import { ResourceReadTool } from "./resource-read";

const value = {
  name: "Agent Alert",
  enabled: false,
  repeat: true,
  alertable: {
    kind: "tea",
    source: 'alertcondition("above", close > 200)',
    // The tool takes JSON, and a saved rule keeps the same JSON.
    config: Schema.encodeSync(Tea.NodeConfig)({
      ...Tea.barsInputs({
        provider: ProviderId.make("yfinance"),
        listing: { symbol: "AAPL", currency: "USD" },
        resolution: "1m",
        session: "regular",
        adjustment: "raw",
      }),
      parameters: {},
      requests: {},
    }),
  },
};
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
let runtime: ReturnType<typeof makeRuntime>;
beforeEach(() => {
  ask.mockReset().mockImplementation(() => Effect.void);
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

async function invoke(input: unknown) {
  const output = await runtime.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* SaveAlertRuleTool);
      return yield* tool.execute(input, context);
    }),
  );
  if (output.output.type !== "text") throw new Error("Expected JSON text");
  return JSON.parse(output.output.value);
}

test("saves, repairs rejected source, and updates only the Rule through its shared transition", async () => {
  const caller = router.createCaller({ runtime });
  const created = await invoke({ value });
  expect(created).toMatchObject({
    status: "ok",
    resource: "alert_rule",
    entity: { ...value, revision: 1 },
  });
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      permission: "save_alert_rule",
      patterns: ["alert_rule"],
    }),
  );
  const rule = { id: created.entity.id, expectedRevision: 1 };
  expect(
    await invoke({
      rule,
      value: {
        ...value,
        alertable: { ...value.alertable, source: "invalid draft" },
      },
    }),
  ).toMatchObject({ status: "rejected" });
  expect(await caller.resources.alert_rule.get({ id: rule.id })).toEqual(
    created.entity,
  );
  const updated = await invoke({
    rule,
    value: {
      ...value,
      alertable: {
        ...value.alertable,
        source: 'alertcondition("below", close < 200)',
      },
    },
  });
  expect(updated).toMatchObject({
    status: "ok",
    entity: { id: rule.id, revision: 2 },
  });
  expect(await invoke({ rule, value })).toMatchObject({
    status: "rejected",
    code: "resource.revision_conflict",
  });
  expect((await caller.resources.trigger.list()).items).toEqual([]);
});

test("generic tools cannot bypass managed definitions and advertise only writable fields", async () => {
  const created = await invoke({ value });
  const outputs = await runtime.runPromise(
    Effect.gen(function* () {
      const read = yield* Tool.init(yield* ResourceReadTool);
      const mutate = yield* Tool.init(yield* ResourceMutateTool);
      return yield* Effect.all([
        read.execute(
          {
            resource: "alert_rule",
            id: created.entity.id,
            include_schema: true,
          },
          context,
        ),
        mutate.execute(
          { resource: "alert_rule", op: "create", input: value },
          context,
        ),
        mutate.execute(
          {
            resource: "alert_rule",
            op: "patch",
            id: created.entity.id,
            expected_revision: 1,
            input: [{ op: "add", path: "/alertable", value: value.alertable }],
          },
          context,
        ),
      ]);
    }),
  );
  const parsed = outputs.map((result) => {
    if (result.output.type !== "text") throw new Error("Expected JSON text");
    return JSON.parse(result.output.value);
  });
  expect(parsed[0].schema.transitions.create.properties).not.toHaveProperty(
    "alertable",
  );
  expect(parsed.slice(1)).toEqual([
    expect.objectContaining({ status: "rejected" }),
    expect.objectContaining({ status: "rejected" }),
  ]);
  expect(
    await router
      .createCaller({ runtime })
      .resources.alert_rule.get({ id: created.entity.id }),
  ).toEqual(created.entity);
});

test("declined permission propagates before compilation or writes", async () => {
  const tea = await runtime.runPromise(Tea.Service);
  const compile = vi.spyOn(tea, "compile");
  ask.mockImplementation(() => Effect.fail(new DeclinedError({})));
  await expect(invoke({ value })).rejects.toMatchObject({
    _tag: "Permission.DeclinedError",
  });
  expect(compile).not.toHaveBeenCalled();
  expect(
    (await router.createCaller({ runtime }).resources.alert_rule.list()).items,
  ).toEqual([]);
});
