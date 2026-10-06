// Purpose: Locks Resource tool access, schema discovery, pagination, and recoverable transaction failures.

import { join } from "node:path";

import { Database } from "@openchart/server/db";
import { Home } from "@openchart/server/home";
import { Feed } from "@openchart/server/feed/service";
import * as Tea from "@openchart/server/tea/tea";
import { temporaryHome } from "@openchart/server/home.test-utils";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { ToolRegistry } from "@openchart/server/agent/tool/registry";
import { Session } from "@openchart/server/agent/session";
import type { Tool } from "@openchart/server/agent/tool/tool";
import { InvalidArgumentsError } from "@openchart/server/agent/tool/errors";
import { DeclinedError } from "@openchart/server/agent/permission/errors";
import { Workflow } from "@openchart/server/agent/workflow";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { AgentProfile } from "@openchart/server/agent/profiles/profile";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { dashboardTable } from "@openchart/server/resources/dashboard/schema";
import { agentScheduleResource } from "@openchart/server/resources/agent-schedule";
import { workspaceResource } from "@openchart/server/resources/workspace";
import { resources } from "@openchart/server/resources/catalog";
import { Transactor } from "@openchart/server/lib/resource";
import { MAX_PAGE_SIZE } from "@openchart/server/lib/resource/pagination";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  JsonSchema,
  Schema,
} from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TestClock } from "effect/testing";

const committed = vi.fn<Database.OnCommitted>(() => Effect.void);
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
const makeRuntime = () =>
  ManagedRuntime.make(
    Tea.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ToolRegistry.layer,
          Session.layer,
          Layer.succeed(Feed, {
            get: () => Effect.die("Unexpected Feed access"),
            getVersion: () => Effect.die("Unexpected Feed version access"),
          }),
          Layer.mock(Workspaces, {}),
          Database.layer(":memory:", committed),
          Home.layer(temporaryHome()).pipe(
            Layer.provideMerge(NodeFileSystem.layer),
          ),
          Layer.succeed(Workflow.Service, {
            settings: { concurrency: 5 },
            parentPrompt: {
              agent: "analyst",
              model: {
                providerID: "codex" as const,
                modelID: "tier1" as const,
              },
              parts: [{ type: "text", text: "Test" }],
            },
            agent: () => Effect.die("Unexpected workflow child execution"),
          }),
        ).pipe(Layer.provideMerge(AgentProfile.layerDefault)),
      ),
    ),
  );
let runtime: ReturnType<typeof makeRuntime>;

beforeEach(() => {
  runtime = makeRuntime();
});
afterEach(async () => {
  await runtime.dispose();
  vi.restoreAllMocks();
  committed.mockClear();
  ask.mockClear();
});

function invoke(name: string, input: unknown, ctx = context) {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service;
    const tool = (yield* registry.all()).find((tool) => tool.id === name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return yield* tool.execute(input, ctx);
  });
}

async function call(name: string, input: unknown, ctx = context) {
  const result = await runtime.runPromise(invoke(name, input, ctx));
  if (result.output.type !== "text") throw new Error("Expected JSON text");
  return JSON.parse(result.output.value);
}

const create = (name: string) =>
  call("resource_mutate", {
    resource: "dashboard",
    op: "create",
    input: { name },
  });

const scheduleInput = {
  name: "Morning review",
  prompt: "Review the market and cite your sources.",
  recurrence: { kind: "cron", expression: "0 9 * * *", timeZone: "UTC" },
};

test("Agent tools create, patch and delete annotation drawings with the shared schema", async () => {
  const dashboard = await create("Annotation");
  const data = {
    id: "agent-annotation",
    type: "annotation",
    anchors: [],
    time: 1789992000,
    title: "Earnings",
    body: "Revenue exceeded expectations.",
    sources: [{ title: "Report", url: "https://example.com/report" }],
    sentiment: 0.5,
  };
  const input = {
    dashboardId: dashboard.entity.id,
    provider: "yfinance",
    listing: { symbol: "AAPL", currency: "USD" },
    data,
  };
  const created = await call("resource_mutate", {
    resource: "drawing",
    op: "create",
    input,
  });
  expect(created).toMatchObject({
    status: "ok",
    entity: { data, revision: 1 },
  });
  const id = created.entity.id;
  expect(await call("resource_read", { resource: "drawing", id })).toEqual(
    created,
  );
  expect(
    await call("resource_mutate", {
      resource: "drawing",
      op: "patch",
      id,
      expected_revision: 1,
      input: [
        { op: "replace", path: "/data/body", value: "Revised explanation." },
      ],
    }),
  ).toMatchObject({
    status: "ok",
    entity: { data: { body: "Revised explanation." }, revision: 2 },
  });
  expect(
    await call("resource_mutate", {
      resource: "drawing",
      op: "create",
      input: {
        ...input,
        data: { ...data, anchors: [{ time: data.time, price: 100 }] },
      },
    }),
  ).toMatchObject({ status: "rejected", code: "invalid_arguments" });
  const beforeInvalidTime = await call("resource_read", {
    resource: "drawing",
    id,
  });
  committed.mockClear();
  for (const [path, value] of [
    ["/data/time", "2026-02-31"],
    ["/data/labelAnchor", { time: "not-a-date", price: 100 }],
  ] as const) {
    expect(
      await call("resource_mutate", {
        resource: "drawing",
        op: "patch",
        id,
        expected_revision: beforeInvalidTime.entity.revision,
        input: [{ op: "add", path, value }],
      }),
    ).toMatchObject({
      status: "rejected",
      code: "resource.state_invalid",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining(path) }),
      ]),
    });
  }
  expect(committed).not.toHaveBeenCalled();
  expect(await call("resource_read", { resource: "drawing", id })).toEqual(
    beforeInvalidTime,
  );
  expect(
    await call("resource_mutate", { resource: "drawing", op: "delete", id }),
  ).toEqual({ status: "ok", resource: "drawing", id });
});

const drawingPoint = { time: 1789862400, price: 100 };
const drawingEnd = { time: 1789948800, price: 110 };
const drawingConstraintCases = [
  {
    name: "surplus anchors",
    type: "trend_line",
    anchors: [drawingPoint, drawingEnd, drawingEnd],
    path: "/data/anchors",
    message: "exactly 2 anchors",
  },
  {
    name: "coincident endpoints",
    type: "extended_line",
    anchors: [drawingPoint, drawingPoint],
    path: "/data/anchors/1",
    message: "distinct first and second points",
  },
  {
    name: "date-string time",
    type: "ray",
    anchors: [drawingPoint, { time: "2026-09-20", price: 100 }],
    path: "/data/anchors/1/time",
    message: "Expected number",
  },
  {
    name: "unparseable time",
    type: "trend_line",
    anchors: [{ time: "not-a-date", price: 100 }, drawingEnd],
    path: "/data/anchors/0/time",
    message: "Expected number",
  },
  {
    name: "invalid calendar day",
    type: "trend_line",
    anchors: [
      { time: { year: 2026, month: 2, day: 31 }, price: 100 },
      drawingEnd,
    ],
    path: "/data/anchors/0/time",
    message: "Expected number",
  },
];

test.each(drawingConstraintCases)(
  "Agent Drawing rejects $name without committing and accepts a corrected retry",
  async ({ type, anchors, path, message }) => {
    const dashboard = await create("Drawing constraints");
    const input = {
      dashboardId: dashboard.entity.id,
      provider: "yfinance",
      listing: { symbol: "AAPL", currency: "USD" },
      data: {
        id: "gesture",
        type: "trend_line",
        anchors: [drawingPoint, drawingEnd],
      },
    };
    committed.mockClear();
    const rejected = await call("resource_mutate", {
      resource: "drawing",
      op: "create",
      input: { ...input, data: { ...input.data, type, anchors } },
    });
    expect(rejected).toMatchObject({
      status: "rejected",
      code: "invalid_arguments",
    });
    expect(rejected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining(path),
          message: expect.stringContaining(message),
        }),
      ]),
    );
    expect(committed).not.toHaveBeenCalled();
    const saved = await call("resource_mutate", {
      resource: "drawing",
      op: "create",
      input,
    });
    expect(saved.status).toBe("ok");
    committed.mockClear();
    const patch = {
      resource: "drawing",
      op: "patch",
      id: saved.entity.id,
      expected_revision: saved.entity.revision,
    };
    const failed = await call("resource_mutate", {
      ...patch,
      input: [
        { op: "replace", path: "/data/type", value: type },
        { op: "replace", path: "/data/anchors", value: anchors },
      ],
    });
    expect(failed).toMatchObject({
      status: "rejected",
      code: "resource.state_invalid",
    });
    expect(failed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining(path),
          message: expect.stringContaining(message),
        }),
      ]),
    );
    expect(committed).not.toHaveBeenCalled();
    expect(
      await call("resource_read", { resource: "drawing", id: saved.entity.id }),
    ).toEqual(saved);
    expect(
      await call("resource_mutate", {
        ...patch,
        input: [{ op: "replace", path: "/data/anchors/1/price", value: 120 }],
      }),
    ).toMatchObject({
      status: "ok",
      entity: { revision: saved.entity.revision + 1 },
    });
    expect(committed).toHaveBeenCalledTimes(1);
  },
);

test("Agent Drawing identity conflicts are transactional and use listing identity rather than JSON or metadata", async () => {
  const dashboard = await create("Drawing identities");
  const input = {
    dashboardId: dashboard.entity.id,
    provider: "yfinance",
    listing: { symbol: "AAPL", currency: "USD" },
    data: {
      id: "shared",
      type: "trend_line",
      anchors: [drawingPoint, drawingEnd],
    },
  };
  const save = (body: unknown) =>
    call("resource_mutate", { resource: "drawing", op: "create", input: body });
  const first = await save(input);
  expect(first.status).toBe("ok");
  const duplicate = {
    ...input,
    listing: { name: "Apple", currency: "USD", symbol: "AAPL" },
  };
  committed.mockClear();
  expect(await save(duplicate)).toMatchObject({
    status: "rejected",
    code: "resource.state_invalid",
    issues: [
      {
        code: "drawing.unique_identity",
        path: "/data/id",
        message: expect.stringContaining("choose a new data.id"),
      },
    ],
  });
  expect(committed).not.toHaveBeenCalled();
  const second = await save({ ...input, data: { ...input.data, id: "other" } });
  expect(second.status).toBe("ok");
  const patch = {
    resource: "drawing",
    op: "patch",
    id: second.entity.id,
    expected_revision: second.entity.revision,
  };
  committed.mockClear();
  expect(
    await call("resource_mutate", {
      ...patch,
      input: [{ op: "replace", path: "/data/id", value: "shared" }],
    }),
  ).toMatchObject({
    status: "rejected",
    code: "resource.state_invalid",
    issues: [{ code: "drawing.unique_identity", path: "/data/id" }],
  });
  expect(committed).not.toHaveBeenCalled();
  expect(
    await call("resource_read", { resource: "drawing", id: first.entity.id }),
  ).toEqual(first);
  expect(
    await call("resource_read", { resource: "drawing", id: second.entity.id }),
  ).toEqual(second);
  expect(
    await call("resource_mutate", {
      ...patch,
      input: [{ op: "replace", path: "/data/id", value: "corrected" }],
    }),
  ).toMatchObject({
    status: "ok",
    entity: { revision: second.entity.revision + 1 },
  });
  expect(committed).toHaveBeenCalledTimes(1);
  expect(
    await save({ ...input, listing: { ...input.listing, currency: "EUR" } }),
  ).toMatchObject({
    status: "rejected",
    code: "resource.state_invalid",
    issues: [{ code: "drawing.unique_identity", path: "/data/id" }],
  });
  const anotherDashboard = await create("Other drawing scope");
  for (const scope of [
    { dashboardId: anotherDashboard.entity.id },
    { provider: "binance" },
    { listing: { ...input.listing, symbol: "MSFT" } },
    { listing: { ...input.listing, venue: "" } },
    { listing: { ...input.listing, venue: "NMS" } },
  ]) {
    const different = await save({ ...input, ...scope });
    expect(different.status).toBe("ok");
  }
  const venue = await save({
    ...input,
    listing: { ...input.listing, venue: "NYSE" },
  });
  committed.mockClear();
  expect(
    await call("resource_mutate", {
      resource: "drawing",
      op: "patch",
      id: venue.entity.id,
      expected_revision: venue.entity.revision,
      input: [{ op: "remove", path: "/listing/venue" }],
    }),
  ).toMatchObject({ status: "rejected", code: "resource.state_invalid" });
  expect(committed).not.toHaveBeenCalled();
});

test("saved prompt part-order failures give Agent feedback without changing the trigger", async () => {
  const input = {
    name: "AAPL debate",
    event: { kind: "alert", ruleId: "alr_aapl" },
    target: {
      kind: "agent_prompt",
      prompt: {
        agent: "analyst",
        model: { providerID: "codex", modelID: "tier1" },
        parts: [{ type: "text", text: "Review the alert." }],
      },
    },
  };
  const parts = [
    ...input.target.prompt.parts,
    {
      type: "workflow",
      workflow: "default:workflows/multi-turn-debate.workflow.ts",
      args: { round: 3, topic: "Should I buy AAPL?" },
    },
  ];
  const feedback = {
    status: "rejected",
    issues: expect.arrayContaining([
      expect.objectContaining({
        path: "/target/prompt/parts",
        message: expect.stringContaining(
          "Text and commands cannot be combined",
        ),
      }),
    ]),
  };
  expect(
    await call("resource_mutate", {
      resource: "trigger",
      op: "create",
      input: {
        ...input,
        target: { ...input.target, prompt: { ...input.target.prompt, parts } },
      },
    }),
  ).toMatchObject(feedback);
  const created = await call("resource_mutate", {
    resource: "trigger",
    op: "create",
    input,
  });
  expect(created.status).toBe("ok");
  expect(
    await call("resource_mutate", {
      resource: "trigger",
      id: created.entity.id,
      op: "patch",
      expected_revision: 1,
      input: [{ op: "replace", path: "/target/prompt/parts", value: parts }],
    }),
  ).toMatchObject(feedback);
  expect(
    (
      await call("resource_read", {
        resource: "trigger",
        id: created.entity.id,
      })
    ).entity,
  ).toEqual(created.entity);
});

test("create_schedule reuses Schedule creation and inherits each invocation's execution context", async () => {
  for (const parentPrompt of [
    {
      agent: "analyst",
      model: { providerID: "codex" as const, modelID: "tier1" as const },
      parts: [{ type: "text" as const, text: "Do not copy this request." }],
    },
    {
      agent: "researcher",
      workspaceId: "wsp_research",
      model: {
        providerID: "codex" as const,
        modelID: "tier4" as const,
        selectedVariant: "high",
      },
      parts: [{ type: "text" as const, text: "Different conversation." }],
    },
  ]) {
    const output = await runtime.runPromise(
      invoke("create_schedule", scheduleInput).pipe(
        Effect.provideService(Workflow.Service, {
          parentPrompt,
          settings: { concurrency: 5 },
          agent: () => Effect.die("Creation must not execute the target"),
        }),
        Effect.provide(TestClock.layer()),
      ),
    );
    if (output.output.type !== "text") throw new Error("Expected JSON text");
    const created = JSON.parse(output.output.value);
    expect(created).toMatchObject({
      status: "ok",
      resource: "agent_schedule",
      entity: {
        name: scheduleInput.name,
        enabled: true,
        revision: 1,
        recurrence: scheduleInput.recurrence,
        nextFireAt: 9 * 60 * 60 * 1_000,
      },
    });
    expect(created.entity.target).toEqual({
      kind: "agent_prompt",
      prompt: {
        ...parentPrompt,
        parts: [{ type: "text", text: scheduleInput.prompt }],
      },
    });
    expect(created.entity).toEqual(
      await runtime.runPromise(
        Transactor.run(
          agentScheduleResource.transitions.get(
            agentScheduleResource.id.make(created.entity.id),
          ),
        ),
      ),
    );
  }
  expect(committed).toHaveBeenCalledTimes(2);
  expect(ask).toHaveBeenCalledWith({
    permission: "create_schedule",
    patterns: ["agent_schedule"],
    always: ["agent_schedule"],
    metadata: scheduleInput,
  });
});

test.each([
  { name: " " },
  { prompt: " " },
  { recurrence: { kind: "once", fireAt: "2099-01-01T00:00:00.000Z" } },
  { recurrence: { ...scheduleInput.recurrence, expression: "0 0 9 * * *" } },
  { recurrence: { ...scheduleInput.recurrence, timeZone: "invalid/zone" } },
  { nextFireAt: 0 },
])(
  "create_schedule rejects invalid arguments before permission or writes: %j",
  async (input) => {
    await expect(
      call("create_schedule", { ...scheduleInput, ...input }),
    ).rejects.toBeInstanceOf(InvalidArgumentsError);
    expect(ask).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  },
);

test("create_schedule preserves permission refusal without creating a schedule", async () => {
  ask.mockImplementationOnce(() => Effect.fail(new DeclinedError({})));
  await expect(call("create_schedule", scheduleInput)).rejects.toBeInstanceOf(
    DeclinedError,
  );
  expect(committed).not.toHaveBeenCalled();
  expect(
    await runtime.runPromise(
      Transactor.run(agentScheduleResource.transitions.listAll({})),
    ),
  ).toEqual([]);
});

test("creates, reads, patches and deletes the same canonical entity as Resource transitions", async () => {
  const created = await create("Rates");
  expect(created).toMatchObject({
    status: "ok",
    resource: "dashboard",
    entity: { name: "Rates", revision: 1, widgets: [] },
  });
  const id = dashboardResource.id.make(created.entity.id);
  expect(created.entity).toEqual(
    await runtime.runPromise(
      Transactor.run(dashboardResource.transitions.get(id)),
    ),
  );
  expect(await call("resource_read", { resource: "dashboard", id })).toEqual(
    created,
  );
  const patch = {
    resource: "dashboard",
    id,
    op: "patch",
    expected_revision: 1,
    input: [{ op: "replace", path: "/name", value: "Bonds" }],
  };
  expect(await call("resource_mutate", patch)).toMatchObject({
    status: "ok",
    entity: { name: "Bonds", revision: 2 },
  });
  expect(await call("resource_mutate", patch)).toMatchObject({
    status: "rejected",
    code: "resource.revision_conflict",
  });
  expect(
    await call("resource_mutate", { resource: "dashboard", op: "delete", id }),
  ).toEqual({ status: "ok", resource: "dashboard", id });
  expect(
    await call("resource_read", { resource: "dashboard", id }),
  ).toMatchObject({ status: "rejected", code: "resource.not_found" });
  expect(committed).toHaveBeenCalledTimes(3);
});

test("Agent reads workspace registrations but cannot create, patch, delete, or invoke custom transitions", async () => {
  const root = await runtime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = join((yield* Home).root, "studies");
      yield* fs.makeDirectory(root);
      yield* fs.writeFileString(join(root, "main.tea"), "close");
      return root;
    }),
  );
  const { id } = await runtime.runPromise(
    Transactor.run(workspaceResource.transitions.register({ root })),
  );
  const read = await call("resource_read", {
    resource: "workspace",
    id,
    include_schema: true,
  });
  expect(read).toMatchObject({
    status: "ok",
    entity: { id, root },
    schema: { transitions: {} },
  });
  ask.mockClear();
  committed.mockClear();
  for (const input of [
    { op: "create", input: { root } },
    {
      op: "patch",
      id,
      expected_revision: 1,
      input: [{ op: "replace", path: "/root", value: `${root}-other` }],
    },
    { op: "delete", id },
  ]) {
    expect(
      await call("resource_mutate", { resource: "workspace", ...input }),
    ).toMatchObject({
      status: "rejected",
      message: "workspace is read-only.",
    });
  }
  for (const op of ["register", "forget"]) {
    await expect(
      call("resource_mutate", {
        resource: "workspace",
        op,
        id,
        input: { root },
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentsError);
  }
  expect(ask).not.toHaveBeenCalled();
  expect(committed).not.toHaveBeenCalled();
  expect(
    await runtime.runPromise(
      FileSystem.FileSystem.use((fs) =>
        fs.readFileString(join(root, "main.tea")),
      ),
    ),
  ).toBe("close");
});

test("exports resolvable schemas for every Resource and only intrinsic writable inputs", async () => {
  for (const resource of resources) {
    const result = await call("resource_read", {
      resource: resource.name,
      include_schema: true,
      limit: 0,
    });
    expect(result.status).toBe("ok");
    expect(result.schema.listKeys).toEqual(resource.listKeys);
    expect(Object.keys(result.schema.transitions)).toEqual(
      resource.readOnly ? [] : ["create", "patch", "delete"],
    );
    expect(result.schema.transitions).not.toHaveProperty("promote");
    const entity = result.schema.entity;
    if (entity.$ref)
      expect(entity.definitions[entity.$ref.split("/").at(-1)]).toBeDefined();
  }
  const { schema } = await call("resource_read", {
    resource: "agent_schedule",
    include_schema: true,
  });
  expect(schema.transitions.create.properties).toHaveProperty("target");
  expect(schema.transitions.create.properties).not.toHaveProperty("nextFireAt");
});

test("uses limit to include entity examples or return only the schema after permission", async () => {
  await create("First example");
  await create("Second example");
  const input = { resource: "dashboard", include_schema: true, limit: 0 };
  const example = await call("resource_read", { ...input, limit: 1 });
  expect(example.status).toBe("ok");
  expect(example.items).toHaveLength(1);
  expect(example.nextCursor).not.toBeNull();

  const { db } = await runtime.runPromise(Database.Service);
  const transaction = vi.spyOn(db, "transaction");
  ask.mockClear();
  expect(await call("resource_read", input)).toEqual({
    status: "ok",
    resource: "dashboard",
    schema: example.schema,
  });
  expect(ask).toHaveBeenCalledExactlyOnceWith({
    permission: "resource_read",
    patterns: ["dashboard"],
    always: ["dashboard"],
    metadata: { resource: "dashboard" },
  });
  ask.mockImplementationOnce(() => Effect.die(new DeclinedError({})));
  const declined = await runtime.runPromiseExit(invoke("resource_read", input));
  expect(Exit.hasDies(declined)).toBe(true);
  expect(transaction).not.toHaveBeenCalled();
});

test.each(["resource_read", "resource_mutate"])(
  "%s advertises catalog Resource names and rejects unknown names before execution",
  async (name) => {
    const tools = await runtime.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ToolRegistry.Service).all();
      }),
    );
    const tool = tools.find((tool) => tool.id === name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    const document = JsonSchema.toDocumentDraft07(
      Schema.toJsonSchemaDocument(tool.parameters),
    );
    expect(document.schema).toMatchObject({
      properties: {
        resource: {
          type: "string",
          enum: resources.map((resource) => resource.name),
        },
      },
    });
    await expect(
      call(name, {
        resource: "missing",
        ...(name === "resource_mutate" ? { op: "create", input: {} } : {}),
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentsError);
    expect(ask).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  },
);

test("rejects undeclared filters, managed writes, and malformed patches", async () => {
  expect(
    await call("resource_read", { resource: "chart", filter: { preset: "1" } }),
  ).toMatchObject({ status: "rejected", allowedKeys: ["dashboardId"] });
  expect(
    await call("resource_read", {
      resource: "dashboard",
      filter: { name: "Rates" },
    }),
  ).toMatchObject({ status: "rejected", allowedKeys: [] });
  expect(
    await call("resource_mutate", {
      resource: "dashboard",
      op: "create",
      input: { name: "Rates", revision: 10 },
    }),
  ).toMatchObject({ status: "rejected", code: "invalid_arguments" });
  const { entity } = await create("Rates");
  const mutate = (input: unknown) =>
    call("resource_mutate", {
      resource: "dashboard",
      id: entity.id,
      op: "patch",
      expected_revision: 1,
      input,
    });
  expect(
    await mutate([{ op: "replace", path: "/missing", value: "x" }]),
  ).toMatchObject({ status: "rejected", code: "resource.patch_rejected" });
  expect(
    await mutate([{ op: "replace", path: "/name", value: 4 }]),
  ).toMatchObject({
    status: "rejected",
    code: "resource.state_invalid",
    issues: expect.any(Array),
  });
  expect(
    (await call("resource_read", { resource: "dashboard", id: entity.id }))
      .entity,
  ).toEqual(entity);
});

test("rejects unsupported operations and ambiguous input before execution", async () => {
  for (const [name, input] of [
    [
      "resource_mutate",
      {
        resource: "agent_schedule",
        op: "promote",
        id: "ags_a",
        expected_revision: 1,
      },
    ],
    [
      "resource_mutate",
      { resource: "dashboard", op: "patch", id: "dsh_a", input: [] },
    ],
    [
      "resource_mutate",
      {
        resource: "dashboard",
        op: "create",
        id: "dsh_a",
        input: { name: "x" },
      },
    ],
    [
      "resource_mutate",
      { resource: "dashboard", op: "delete", id: "dsh_a", input: {} },
    ],
    ["resource_read", { resource: "dashboard", id: "dsh_a", filter: {} }],
    ["resource_read", { resource: "dashboard", id: "dsh_a", order: "desc" }],
    [
      "resource_read",
      { resource: "dashboard", id: "dsh_a", orderBy: "updatedAt" },
    ],
    ["resource_read", { resource: "dashboard", order: "newest" }],
    ["resource_read", { resource: "dashboard", orderBy: "name" }],
    ["resource_read", { resource: "dashboard", limit: MAX_PAGE_SIZE + 1 }],
    ["resource_read", { resource: "dashboard", limit: -1 }],
    ["resource_read", { resource: "dashboard", limit: 0.5 }],
    ["resource_read", { resource: "dashboard", limit: 0 }],
    [
      "resource_read",
      { resource: "dashboard", limit: 0, include_schema: false },
    ],
    ...[
      { id: "dsh_a" },
      { filter: {} },
      { cursor: "eyJjcmVhdGVkQXQiOjEsImlkIjoiZHNoX2EifQ" },
      { order: "desc" },
      { orderBy: "updatedAt" },
    ].map(
      (extra) =>
        [
          "resource_read",
          { resource: "dashboard", include_schema: true, limit: 0, ...extra },
        ] as const,
    ),
    ["resource_read", { resource: "dashboard", path: "/dashboards" }],
    ["resource_search", { query: "" }],
  ] as const) {
    const exit = await runtime.runPromiseExit(invoke(name, input));
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(InvalidArgumentsError);
    } else {
      expect(exit.value.output.type).toBe("text");
      if (exit.value.output.type === "text")
        expect(JSON.parse(exit.value.output.value).status).toBe("rejected");
    }
  }
  expect(ask).not.toHaveBeenCalled();
  expect(committed).not.toHaveBeenCalled();
});

test.each(resources.filter((resource) => resource.readOnly))(
  "$name rejects every Agent mutation even though internal transitions exist",
  async (resource) => {
    const insert = vi.spyOn(resource.store, "insert");
    const save = vi.spyOn(resource.store, "save");
    const remove = vi.spyOn(resource.store, "remove");
    const id = resource.id.create();
    for (const mutation of [
      { op: "create", input: {} },
      {
        op: "patch",
        id,
        expected_revision: 1,
        input: [{ op: "add", path: "/name", value: "Forged" }],
      },
      { op: "delete", id },
    ]) {
      expect(
        await call("resource_mutate", { resource: resource.name, ...mutation }),
      ).toMatchObject({
        status: "rejected",
        code: "invalid_arguments",
        message: `${resource.name} is read-only.`,
      });
    }
    expect(insert).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  },
);

const savedPrompt = {
  kind: "agent_prompt",
  prompt: {
    agent: "analyst",
    model: { providerID: "codex", modelID: "tier1" },
    parts: [{ type: "text", text: "Review the market." }],
  },
};
const market = {
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
};
const chartCell = {
  id: "ccl_mutate",
  marketSources: [{ id: "cms_mutate", ...market }],
  panes: [
    {
      id: "cpn_mutate",
      series: [
        {
          id: "csr_mutate",
          role: "main",
          source: {
            kind: "market",
            marketSourceId: "cms_mutate",
            output: "price",
          },
        },
      ],
    },
  ],
};
const chartWidget = {
  id: "wdg_first",
  kind: "chart",
  resourceId: "cht_retained",
  layout: { x: 0, y: 0, w: 6, h: 8 },
};

// Every writable catalog entry exercises a real domain constraint through the
// Agent boundary. Shared schemas own their rules; this table adds no validators.
const writableCases: Array<{
  resource: (typeof resources)[number]["name"];
  /** May create the Resources the case's body references. */
  input: (
    dashboardId: string,
  ) => Schema.JsonObject | Promise<Schema.JsonObject>;
  invalid: Schema.JsonObject;
  issuePath: string;
}> = [
  {
    resource: "dashboard",
    input: () => ({ name: "References", widgets: [chartWidget] }),
    invalid: {
      widgets: [
        chartWidget,
        {
          ...chartWidget,
          id: "wdg_second",
          resourceId: "wsp_wrong_kind",
          layout: { x: 6, y: 0, w: 6, h: 8 },
        },
      ],
    },
    issuePath: "/widgets/1/resourceId",
  },
  {
    resource: "chart",
    input: (dashboardId) => ({ dashboardId, cells: [chartCell] }),
    invalid: {
      cells: [{ ...chartCell, panes: [{ id: "cpn_mutate", series: [] }] }],
    },
    issuePath: "/cells/0/panes",
  },
  {
    resource: "indicator",
    // An Indicator belongs to a chart, so the case creates one first.
    input: async (dashboardId) => {
      const chart = await call("resource_mutate", {
        resource: "chart",
        op: "create",
        input: { dashboardId, cells: [chartCell] },
      });
      return {
        chartId: chart.entity.id,
        cellId: chartCell.id,
        source: { workspaceId: "wsp_mutate", path: "study.tea" },
        snapshot: { "study.tea": 'emit "value" close' },
        parameterOverrides: {},
      };
    },
    // The snapshot must hold the script it was taken from.
    invalid: { snapshot: { "lib/avg.tea": "export avg(x) => x" } },
    issuePath: "/snapshot",
  },
  {
    resource: "drawing",
    input: (dashboardId) => ({
      dashboardId,
      ...market,
      data: {
        id: "gesture",
        type: "trend_line",
        anchors: [
          { time: 1, price: 100 },
          { time: 2, price: 110 },
        ],
      },
    }),
    invalid: {
      data: {
        id: "gesture",
        type: "trend_line",
        anchors: [{ time: 1, price: 100 }],
      },
    },
    issuePath: "/data",
  },
  {
    resource: "agent_schedule",
    input: () => ({
      name: "Scheduled prompt",
      target: savedPrompt,
      recurrence: { kind: "once", fireAt: "2090-01-01T00:00:00.000Z" },
    }),
    invalid: {
      target: {
        ...savedPrompt,
        prompt: {
          ...savedPrompt.prompt,
          parts: [
            ...savedPrompt.prompt.parts,
            {
              type: "workflow",
              workflow: "workspace:review.workflow.ts",
              args: {},
            },
          ],
        },
      },
    },
    issuePath: "/target/prompt/parts",
  },
  {
    resource: "trigger",
    input: () => ({
      name: "Notification",
      event: { kind: "alert", ruleId: "alr_retained" },
      target: { kind: "notification", message: "{symbol} fired" },
    }),
    invalid: {
      target: {
        kind: "agent_prompt",
        message: "A notification is not an Agent prompt",
      },
    },
    issuePath: "/target",
  },
];

// Alert Rule uses its dedicated save tool tests because alertable is server-managed.
test("every writable Resource has an Agent mutation rejection and recovery case", () => {
  expect(
    [...writableCases.map(({ resource }) => resource), "alert_rule"].sort(),
  ).toEqual(
    resources
      .filter((resource) => !resource.readOnly)
      .map((resource) => resource.name)
      .sort(),
  );
});

test.each(writableCases)(
  "$resource returns repairable create/patch diagnostics without writes and accepts a corrected retry",
  async ({ resource, input, invalid, issuePath }) => {
    const dashboard = await create("Owner");
    const body = await input(dashboard.entity.id);
    const definition = resources.find((entry) => entry.name === resource)!;
    const insert = vi.spyOn(definition.store, "insert");
    const save = vi.spyOn(definition.store, "save");
    committed.mockClear();
    const issues = expect.arrayContaining([
      expect.objectContaining({
        code: expect.any(String),
        path: expect.stringContaining(issuePath),
        message: expect.any(String),
      }),
    ]);
    expect(
      await call("resource_mutate", {
        resource,
        op: "create",
        input: { ...body, ...invalid },
      }),
    ).toMatchObject({
      status: "rejected",
      code: "invalid_arguments",
      issues,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();

    const created = await call("resource_mutate", {
      resource,
      op: "create",
      input: body,
    });
    expect(created.status).toBe("ok");
    committed.mockClear();
    expect(
      await call("resource_mutate", {
        resource,
        op: "patch",
        id: created.entity.id,
        expected_revision: created.entity.revision,
        input: Object.entries(invalid).map(([key, value]) => ({
          op: "replace",
          path: `/${key}`,
          value,
        })),
      }),
    ).toMatchObject({
      status: "rejected",
      code: "resource.state_invalid",
      issues,
    });
    expect(save).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
    expect(
      await call("resource_read", { resource, id: created.entity.id }),
    ).toEqual(created);

    // Caller-authored envelope fields never become writable through either entry point.
    expect(
      await call("resource_mutate", {
        resource,
        op: "create",
        input: { ...body, revision: 99 },
      }),
    ).toMatchObject({ status: "rejected", code: "invalid_arguments" });
    expect(
      await call("resource_mutate", {
        resource,
        op: "patch",
        id: created.entity.id,
        expected_revision: created.entity.revision,
        input: [{ op: "add", path: "/revision", value: 99 }],
      }),
    ).toMatchObject({ status: "rejected", code: "resource.state_invalid" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();

    const repaired = await call("resource_mutate", {
      resource,
      op: "patch",
      id: created.entity.id,
      expected_revision: created.entity.revision,
      input: Object.keys(invalid).map((key) => ({
        op: "replace",
        path: `/${key}`,
        value: created.entity[key],
      })),
    });
    expect(repaired).toMatchObject({
      status: "ok",
      entity: { id: created.entity.id, revision: created.entity.revision + 1 },
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledTimes(1);
  },
);

test("advertises opaque cursor strings and rejects malformed tokens before Store access", async () => {
  const tools = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ToolRegistry.Service).all();
    }),
  );
  const tool = tools.find((tool) => tool.id === "resource_read");
  if (!tool) throw new Error("Missing resource_read tool");
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(tool.parameters),
  );
  expect(document.schema).toMatchObject({
    properties: {
      cursor: {
        type: "string",
        description: expect.stringContaining("Opaque pagination token"),
      },
      order: { enum: ["asc", "desc"] },
      orderBy: { enum: ["createdAt", "updatedAt"] },
    },
  });
  const list = vi.spyOn(dashboardResource.store, "list");
  for (const cursor of ["not a token!", "e30", "bnVsbA"]) {
    expect(
      await call("resource_read", { resource: "dashboard", cursor }),
    ).toMatchObject({ status: "rejected", code: "invalid_arguments" });
  }
  await expect(
    call("resource_read", {
      resource: "dashboard",
      cursor: { createdAt: 1, id: "dsh_a" },
    }),
  ).rejects.toBeInstanceOf(InvalidArgumentsError);
  expect(list).not.toHaveBeenCalled();
});

test.each([
  [undefined, undefined, ["dsh_a", "dsh_b", "dsh_c"]],
  ["createdAt", "asc", ["dsh_a", "dsh_b", "dsh_c"]],
  ["createdAt", "desc", ["dsh_c", "dsh_b", "dsh_a"]],
  ["updatedAt", "asc", ["dsh_b", "dsh_a", "dsh_c"]],
  ["updatedAt", "desc", ["dsh_c", "dsh_a", "dsh_b"]],
] as const)(
  "lists by %s %s through the Agent tool with cursor continuation",
  async (orderBy, order, expected) => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service;
        yield* db.transaction((tx) =>
          tx.insert(dashboardTable).values([
            { id: "dsh_a", name: "A", createdAt: 100, updatedAt: 400 },
            { id: "dsh_b", name: "B", createdAt: 200, updatedAt: 300 },
            { id: "dsh_c", name: "C", createdAt: 200, updatedAt: 400 },
          ]),
        );
      }),
    );
    const input = {
      resource: "dashboard",
      limit: 2,
      ...(orderBy ? { orderBy } : {}),
      ...(order ? { order } : {}),
    };
    const first = await call("resource_read", input);
    expect(first).toMatchObject({
      status: "ok",
      items: expected.slice(0, 2).map((id) => ({ id })),
      nextCursor: expect.any(String),
    });
    const second = await call("resource_read", {
      ...input,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({
      status: "ok",
      items: expected.slice(2).map((id) => ({ id })),
      nextCursor: null,
    });
  },
);

test("lists with opaque cursors and searches every page across Resources without snippets", async () => {
  const entities = await runtime.runPromise(
    Effect.gen(function* () {
      const entities = [];
      for (let index = 0; index < MAX_PAGE_SIZE + 5; index++) {
        entities.push(
          yield* Transactor.run(
            dashboardResource.transitions.create({
              name:
                index === MAX_PAGE_SIZE + 4 ? "NEEDLE" : `Dashboard ${index}`,
              favorite: false,
              widgets: [],
            }),
          ),
        );
      }
      const schedule = yield* Transactor.run(
        agentScheduleResource.transitions.create({
          name: "Needle schedule",
          enabled: false,
          target: {
            kind: "agent_prompt",
            prompt: {
              parts: [{ type: "text", text: "Research" }],
              agent: "analyst",
              model: {
                providerID: "codex" as const,
                modelID: "tier1" as const,
              },
            },
          },
          recurrence: { kind: "once", fireAt: "2027-01-01T00:00:00.000Z" },
          nextFireAt: 0,
        }),
      );
      return { entities, schedule };
    }),
  );
  const first = await call("resource_read", {
    resource: "dashboard",
    limit: MAX_PAGE_SIZE,
  });
  expect(first.items).toHaveLength(MAX_PAGE_SIZE);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await call("resource_read", {
    resource: "dashboard",
    limit: MAX_PAGE_SIZE,
    cursor: first.nextCursor,
  });
  expect(second.items).toHaveLength(5);
  expect(second.nextCursor).toBeNull();
  const { db } = await runtime.runPromise(Database.Service);
  const transaction = vi.spyOn(db, "transaction");
  expect(await call("resource_search", { query: "nEeDlE" })).toEqual({
    status: "ok",
    items: [
      { resource: "dashboard", id: entities.entities.at(-1)!.id },
      { resource: "agent_schedule", id: entities.schedule.id },
    ],
  });
  expect(transaction).toHaveBeenCalledTimes(resources.length + 1);
});

test("converts a write defect into recoverable feedback after rollback and permits the next call", async () => {
  const original = dashboardResource.store.insert;
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const insert = vi
    .spyOn(dashboardResource.store, "insert")
    .mockImplementationOnce((...args) =>
      original(...args).pipe(
        Effect.andThen(Effect.die(new Error("private database detail"))),
      ),
    );
  expect(await create("Rolled back")).toMatchObject({
    status: "rejected",
    code: "internal",
    message: "Internal server error",
    recovery: expect.any(String),
  });
  expect(committed).not.toHaveBeenCalled();
  expect(
    (await call("resource_read", { resource: "dashboard" })).items,
  ).toEqual([]);
  expect((await create("Recovered")).status).toBe("ok");
  expect(insert).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenCalledTimes(1);
});

test("a synchronous read defect and a failed search return rejection, not partial data", async () => {
  await create("anything");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(dashboardResource.store, "list").mockImplementationOnce(() => {
    throw new Error("Read defect");
  });
  expect(await call("resource_read", { resource: "dashboard" })).toMatchObject({
    status: "rejected",
    code: "internal",
  });
  vi.spyOn(agentScheduleResource.store, "list").mockReturnValueOnce(
    Effect.die("Search defect"),
  );
  const failed = await call("resource_search", { query: "anything" });
  expect(failed).toMatchObject({ status: "rejected", code: "internal" });
  expect(failed).not.toHaveProperty("items");
});

test("search interruption propagates and prevents later Resource reads", async () => {
  vi.spyOn(dashboardResource.store, "list").mockReturnValueOnce(
    Effect.interrupt,
  );
  const later = vi.spyOn(agentScheduleResource.store, "list");
  const interrupted = await runtime.runPromiseExit(
    invoke("resource_search", { query: "anything" }),
  );
  if (Exit.isSuccess(interrupted)) throw new Error("Expected interruption");
  expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
  expect(later).not.toHaveBeenCalled();
});

test("waits for permission before writes and preserves decline and cancellation", async () => {
  await runtime.runPromise(
    Effect.gen(function* () {
      const requested = yield* Deferred.make<void>();
      const approved = yield* Deferred.make<void>();
      const ctx = {
        ...context,
        ask: () =>
          Deferred.succeed(requested, undefined).pipe(
            Effect.andThen(Deferred.await(approved)),
          ),
      };
      const fiber = yield* invoke(
        "resource_mutate",
        { resource: "dashboard", op: "create", input: { name: "Allowed" } },
        ctx,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(requested);
      expect(committed).not.toHaveBeenCalled();
      yield* Deferred.succeed(approved, undefined);
      yield* Fiber.join(fiber);
      expect(committed).toHaveBeenCalledTimes(1);
    }),
  );
  const declined = await runtime.runPromiseExit(
    invoke(
      "resource_mutate",
      { resource: "dashboard", op: "create", input: { name: "Declined" } },
      { ...context, ask: () => Effect.die(new DeclinedError({})) },
    ),
  );
  expect(Exit.hasDies(declined)).toBe(true);
  const cancelled = await runtime.runPromiseExit(
    invoke(
      "resource_read",
      { resource: "dashboard" },
      { ...context, ask: () => Effect.interrupt },
    ),
  );
  if (Exit.isSuccess(cancelled)) throw new Error("Expected interruption");
  expect(Cause.hasInterruptsOnly(cancelled.cause)).toBe(true);
  expect(committed).toHaveBeenCalledTimes(1);
});
