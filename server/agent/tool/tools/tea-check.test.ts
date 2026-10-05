// Purpose: Exercise Agent Tea checks with the real compiler, binding and disposal.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Effect,
  Deferred,
  JsonSchema,
  Layer,
  ManagedRuntime,
  Schema,
} from "effect";
import { expect, onTestFinished, test, vi } from "vitest";
import { ProviderId } from "@openchart/market";
import { providerToolInputSchema } from "@openchart/models/provider-tools";

import { InvalidArgumentsError } from "@openchart/server/agent/tool/errors";
import { Session } from "@openchart/server/agent/session";
import * as Tool from "@openchart/server/agent/tool/tool";
import { Database } from "@openchart/server/db";
import { Feed } from "@openchart/server/feed/service";
import { temporaryHome } from "@openchart/server/home.test-utils";
import * as Tea from "@openchart/server/tea/tea";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { assistant, seed } from "./transcript.test-utils";
import { TeaCheckTool, Parameters } from "./tea-check";
import { teaConfigExample } from "./tea-shared";

const series = {
  provider: ProviderId.make("yfinance"),
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1d",
  session: "regular",
  adjustment: "split",
} as const;
const source =
  'length = input.int(2, minval = 1)\nchild = request.security("X", "D", close[length])\nalertcondition("above", close > child)';
const node: Tea.NodeConfig = {
  ...Tea.barsInputs(series),
  parameters: { length: 2 },
  requests: {
    child: {
      ...Tea.barsInputs(series),
      parameters: { length: 3 },
      requests: {},
    },
  },
};
// The tool takes JSON, so this is the config as the Agent would send it.
const config = Schema.encodeSync(Tea.NodeConfig)(node);
const context: Tool.Context = {
  rootRunID: "agr_test",
  sessionID: "ses_tea_check",
  messageID: "msg_tea_check",
  callID: "call",
  agent: "analyst",
  messages: [],
  metadata: () => Effect.die("Unexpected progress"),
  ask: () => Effect.void,
};

async function fixture() {
  const root = temporaryHome();
  const runtime = ManagedRuntime.make(
    Layer.merge(Session.layer, Tea.layer).pipe(
      Layer.provideMerge(Database.layer(":memory:", () => Effect.void)),
      Layer.provide(
        Layer.succeed(Feed, {
          get: () => Effect.die("Checks must not acquire Feed"),
          getVersion: () => Effect.die("Checks must not access Feed"),
        }),
      ),
      Layer.provide(Layer.mock(Workspaces, {})),
    ),
  );
  onTestFinished(() => runtime.dispose());
  const tea = await runtime.runPromise(Tea.Service);
  const originalCompile = tea.compile;
  const ids: string[] = [];
  const compile = vi.spyOn(tea, "compile").mockImplementation((request) =>
    originalCompile(request).pipe(
      Effect.tap((node) =>
        Effect.sync(() => {
          ids.push(node.id);
        }),
      ),
    ),
  );
  const validate = vi.spyOn(tea, "validate");
  const dispose = vi.spyOn(tea, "dispose");
  const tool = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Tool.init(yield* TeaCheckTool);
    }),
  );
  const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
  const ctx = { ...context, ask };
  const check = (input: unknown, current = ctx) =>
    runtime.runPromise(tool.execute(input, current));
  return {
    root,
    runtime,
    tea,
    tool,
    ctx,
    check,
    compile,
    validate,
    dispose,
    ids,
    ask,
  };
}

test("compiles inline source to its JSON definition and releases the retained node", async () => {
  const f = await fixture();
  const result = await f.check({ source });
  expect(result.output).toMatchObject({
    type: "json",
    value: {
      status: "ok",
      config: "not_checked",
      declaration: null,
      definition: {
        parameters: [
          expect.objectContaining({
            name: "length",
            type: "int",
            defaultValue: 2,
          }),
        ],
        inputs: { fields: [expect.objectContaining({ name: "close" })] },
        outputs: {
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "above" }),
          ]),
        },
        requests: {
          child: { parameters: [expect.objectContaining({ name: "length" })] },
        },
      },
      alertOutputs: ["above"],
    },
  });
  // The definition is the contract's canonical JSON, metadata included.
  const json = Schema.decodeUnknownSync(
    Schema.Struct({ definition: Schema.Json }),
  )(result.output.value).definition;
  const definition = Schema.decodeUnknownSync(Tea.Definition)(json);
  expect(Schema.encodeSync(Tea.Definition)(definition)).toEqual(json);
  expect(Tea.teaAlertOutputs(definition.outputs)).toEqual(["above"]);
  expect(JSON.parse(JSON.stringify(result.output))).toEqual(result.output);
  expect(result.output).not.toHaveProperty("value.id");
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledExactlyOnceWith({ id: f.ids[0] });
  const released = await f.runtime.runPromise(
    f.tea.validate({ id: f.ids[0]!, ...node, nodes: {} }).pipe(Effect.flip),
  );
  expect(released.code).toBe("node_unavailable");
});

test("validates complete recursive config and releases on invalid bindings", async () => {
  const f = await fixture();
  expect((await f.check({ source, config })).output).toMatchObject({
    value: { status: "ok", config: "valid" },
  });
  expect(
    (
      await f.check({
        source: 'alertcondition("above", close > 1)',
        config: teaConfigExample,
      })
    ).output,
  ).toMatchObject({ value: { status: "ok", config: "valid" } });
  // Each config breaks one rule; the message names what is wrong.
  for (const [invalid, reason] of [
    [{ ...config, parameters: {} }, "parameters"],
    [{ ...config, requests: {} }, "child"],
    [{ ...config, parameters: { length: 0 } }, ""],
    // The script reads close, so the map must say where close comes from.
    [
      {
        ...config,
        map: Object.fromEntries(
          Object.entries(config.map).filter(([column]) => column !== "close"),
        ),
      },
      "close",
    ],
    // A node needs at least one input.
    [{ ...config, inputs: {}, map: {} }, "input"],
    // These tools run no other nodes, so a NodeRef has nothing to read.
    [
      {
        ...config,
        inputs: {
          ...config.inputs,
          indicator: {
            _tag: "NodeRef",
            node: "rsi",
            schema: config.inputs.bars!.schema,
          },
        },
      },
      "nodes.rsi",
    ],
  ] as const) {
    expect((await f.check({ source, config: invalid })).output).toMatchObject({
      value: {
        status: "rejected",
        code: "invalid_request",
        message: expect.stringContaining(reason),
      },
    });
  }
  expect(f.dispose.mock.calls.map(([request]) => request.id)).toEqual(f.ids);
});

test("returns compiler locations and preserves inline import restrictions", async () => {
  const f = await fixture();
  const invalid = await f.check({ source: 'emit "value" missing_name' });
  expect(invalid.output).toMatchObject({
    value: { status: "rejected", code: "compile_failed" },
  });
  expect(JSON.stringify(invalid.output)).toContain("<inline>:1:");
  expect(JSON.stringify(invalid.output)).toContain("missing_name");
  expect(
    (await f.check({ source: 'import ./other\nemit "value" close' })).output,
  ).toMatchObject({
    value: {
      status: "rejected",
      // Inline source reads no files, so Tea reports the missing import.
      message: expect.stringContaining("cannot find './other'"),
    },
  });
  expect(f.dispose).not.toHaveBeenCalled();
});

test("resolves relative paths from the executing Assistant and retains file import context", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "lib"));
  await writeFile(
    join(f.root, "lib", "bands.tea"),
    'library("bands")\nexport upper(value) => value + 1',
  );
  await writeFile(
    join(f.root, "main.tea"),
    'import ./lib/bands\nemit "value" bands.upper(close)',
  );
  const message = assistant(context.messageID, [], context.sessionID);
  if (message.info.role !== "assistant") throw new Error("Expected Assistant");
  message.info.path = { cwd: f.root, root: f.root };
  await f.runtime.runPromise(
    seed(context.sessionID, "Tea check", [[message, 1]]),
  );
  const relative = await f.check({ path: "main.tea" });
  const absolute = await f.check({ path: join(f.root, "main.tea") });
  expect(relative.output).toEqual(absolute.output);
  expect(relative.output).toMatchObject({
    value: {
      status: "ok",
      definition: {
        outputs: {
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "value" }),
          ]),
        },
      },
    },
  });
  expect(f.compile).toHaveBeenCalledWith(
    expect.objectContaining({
      entry: join(f.root, "main.tea"),
      sources: expect.objectContaining({
        [join(f.root, "main.tea")]: expect.any(String),
      }),
    }),
  );
  expect(f.ask).toHaveBeenCalledWith(
    expect.objectContaining({
      permission: "tea_check",
      patterns: [join(f.root, "main.tea")],
    }),
  );
  await writeFile(join(f.root, "main.tea"), 'emit "value" no_such_name');
  expect(
    JSON.stringify((await f.check({ path: "main.tea" })).output),
  ).toContain(`${join(f.root, "main.tea")}:1:`);
  expect(
    (await f.check({ path: join(f.root, "missing.tea") })).output,
  ).toMatchObject({ value: { status: "rejected", code: "compile_failed" } });
  expect(() =>
    Schema.decodeUnknownSync(Tea.CompileRequest)({ path: "main.tea" }),
  ).toThrow();
});

test("rejects invalid source choices before permission or compiler access", async () => {
  const f = await fixture();
  for (const input of [
    {},
    { source, path: "main.tea" },
    { source: "" },
    { source, unexpected: true },
    // A Bars schema must list open, high, low, close and volume.
    {
      source,
      config: {
        ...config,
        inputs: { bars: { ...config.inputs.bars!, schema: { fields: [] } } },
      },
    },
  ]) {
    const failure = await f.runtime.runPromise(
      f.tool.execute(input, f.ctx).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(InvalidArgumentsError);
  }
  expect(f.ask).not.toHaveBeenCalled();
  expect(f.compile).not.toHaveBeenCalled();
});

test("the model sees both source choices and the NodeConfig structure", () => {
  // The same derivation as server/agent/llm/llm.ts.
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(Schema.toEncoded(Parameters)),
  );
  expect(document.schema).toMatchObject({
    type: "object",
    properties: { config: { $ref: "#/definitions/NodeConfig" } },
  });
  expect(document.definitions.NodeConfig).toMatchObject({
    type: "object",
    required: ["inputs", "map", "parameters", "requests"],
  });
  // One NodeConfig definition: the optional config doesn't repeat it.
  expect(Object.keys(document.definitions).sort()).toEqual([
    "ArrowFieldJson",
    "NodeConfig",
  ]);
  const schema = providerToolInputSchema({
    ...document.schema,
    definitions: document.definitions,
  });
  expect(schema.safeParse({ source, config }).success).toBe(true);
  expect(schema.safeParse({ source, config: teaConfigExample }).success).toBe(
    true,
  );
  expect(schema.safeParse({ path: "main.tea" }).success).toBe(true);
  for (const invalid of [
    { ...config, map: undefined },
    { ...config, inputs: { bars: { ...config.inputs.bars!, schema: {} } } },
    { ...config, inputs: { bars: { ...config.inputs.bars!, _tag: "Feed" } } },
  ])
    expect(schema.safeParse({ source, config: invalid }).success).toBe(false);
});

test("permission failure happens before reading or compiling a path", async () => {
  const f = await fixture();
  const denied = new Error("Denied");
  f.ask.mockImplementation(() => Effect.fail(denied));
  const failure = await f.runtime.runPromise(
    f.tool
      .execute({ path: join(f.root, "missing.tea") }, f.ctx)
      .pipe(Effect.flip),
  );
  expect(failure).toBe(denied);
  expect(f.compile).not.toHaveBeenCalled();
});

test("interrupting validation still releases the compiled node", async () => {
  const f = await fixture();
  const entered = Deferred.makeUnsafe<void>();
  f.validate.mockImplementation(() =>
    Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
  );
  const abort = new AbortController();
  const pending = f.runtime.runPromise(
    f.tool.execute({ source, config }, f.ctx),
    { signal: abort.signal },
  );
  const failure = expect(pending).rejects.toThrow();
  await f.runtime.runPromise(Deferred.await(entered));
  abort.abort();
  await failure;
  expect(f.dispose).toHaveBeenCalledExactlyOnceWith({ id: f.ids[0] });
});
