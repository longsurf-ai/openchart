// Purpose: Exercise Agent Tea runs through the real compiler and finite execution owner.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Deferred,
  Effect,
  JsonSchema,
  Layer,
  ManagedRuntime,
  Schema,
} from "effect";
import { expect, onTestFinished, test, vi } from "vitest";
import { FeedError, FeedReasons } from "@openchart/feed";
import { BarColumns, ProviderId } from "@openchart/market";
import { standardWarmupBars } from "@openchart/tea";
import { providerToolInputSchema } from "@openchart/models/provider-tools";

import { defineDataFrame, takeRows } from "@openchart/timeseries";
import { Session } from "@openchart/server/agent/session";
import { InvalidArgumentsError } from "@openchart/server/agent/tool/errors";
import * as Tool from "@openchart/server/agent/tool/tool";
import { Database } from "@openchart/server/db";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import { Feed } from "@openchart/server/feed/service";
import { temporaryHome } from "@openchart/server/home.test-utils";
import * as Tea from "@openchart/server/tea/tea";
import { Workspaces } from "@openchart/server/workspace/workspace";
import { TeaRunOutputTooLarge } from "./errors";
import { assistant, seed } from "./transcript.test-utils";
import { Parameters, TeaRunTool } from "./tea-run";
import { teaConfigExample } from "./tea-shared";

// The documented example: AAPL one-minute bars with every Bars column mapped.
const config = teaConfigExample;
const node = Schema.decodeSync(Tea.NodeConfig)(config);
const source = 'emit "price" close';
const input = { source, config, from: 120_000, to: 240_000 };
const rows = (closes: readonly (number | null)[] = [10, 20, 30]) =>
  closes.map((close, index) => ({
    time: (index + 1) * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
// The same config with its Bars input replaced by these rows. Rows are unknown
// so tests can also send invalid ones.
const sampled = (data: readonly unknown[] = rows()) => ({
  ...config,
  inputs: { bars: { ...config.inputs.bars!, _tag: "Samples", rows: data } },
});
const context: Tool.Context = {
  rootRunID: "agr_test",
  sessionID: "ses_tea_run",
  messageID: "msg_tea_run",
  callID: "call",
  agent: "analyst",
  messages: [],
  metadata: () => Effect.die("Unexpected progress"),
  ask: () => Effect.void,
};

async function fixture(closes = [10, 20, 30]) {
  const root = temporaryHome();
  const frame = defineDataFrame({
    ...BarColumns,
    final: Schema.Boolean,
  }).create({
    labels: {},
    rows: closes.map((close, index) => ({
      time: (index + 1) * 60_000,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
      final: true,
    })),
  });
  const released = vi.fn();
  const observe = vi.fn<IBarsFeedService["observe"]>(
    Effect.fn("Test.bars.observe")(function* (request) {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          released();
        }),
      );
      const snapshot = yield* readBarsHistory(request, (bounds) => {
        const indices = [...frame].flatMap((row, index) =>
          row.time >= (bounds.from ?? -Infinity) && row.time < bounds.to
            ? [index]
            : [],
        );
        return Effect.succeed(
          takeRows(
            frame,
            bounds.count === undefined ? indices : indices.slice(-bounds.count),
          ),
        );
      });
      return { snapshot };
    }),
  );
  // Called when a run acquires Feed, not when it merely builds that effect.
  const acquireFeed = vi.fn(() => ({
    bars: {
      observe,
      getCapabilities: () => Effect.die("Unexpected capabilities"),
    },
    symbology: {
      search: () => Effect.die("Unexpected search"),
      index: () => Effect.die("Unexpected index"),
      indexStatus: () => Effect.die("Unexpected index status"),
    },
    logos: { getLogo: () => Effect.die("Unexpected logos") },
    calendar: { getCalendar: () => Effect.die("Unexpected calendar") },
  }));
  const runtime = ManagedRuntime.make(
    Layer.merge(Session.layer, Tea.layer).pipe(
      Layer.provideMerge(Database.layer(":memory:", () => Effect.void)),
      Layer.provide(
        Layer.succeed(Feed, {
          get: () => Effect.sync(acquireFeed),
          getVersion: () => Effect.die("Unexpected version"),
        }),
      ),
      Layer.provide(Layer.mock(Workspaces, {})),
    ),
  );
  onTestFinished(() => runtime.dispose());
  const tea = await runtime.runPromise(Tea.Service);
  const compile = vi.spyOn(tea, "compile");
  const dispose = vi.spyOn(tea, "dispose");
  const tool = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Tool.init(yield* TeaRunTool);
    }),
  );
  const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
  const ctx = { ...context, ask };
  const run = (args: unknown = input) =>
    runtime.runPromise(tool.execute(args, ctx));
  return {
    root,
    runtime,
    tea,
    compile,
    dispose,
    tool,
    ask,
    ctx,
    run,
    acquireFeed,
    observe,
    released,
  };
}

test("returns warmed values, visual structs and alert lists as readable JSON, then releases resources", async () => {
  const f = await fixture();
  const result = await f.run({
    ...input,
    source: [
      "length = input.int(2)",
      "average = ta.sma(close, length)",
      'emit "average" average',
      'emit "lag" close[2]',
      'plot("line", average)',
      'alertcondition("above", close > 22, "Up", "Price rose")',
    ].join("\n"),
    config: { ...config, parameters: { length: 2 } },
  });
  expect(result.output).toMatchObject({
    type: "json",
    value: {
      status: "ok",
      range: { from: input.from, to: input.to },
      declaration: null,
      definition: {
        parameters: [expect.objectContaining({ name: "length" })],
        outputs: {
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "average" }),
          ]),
        },
      },
      alertOutputs: ["above"],
      rows: [
        {
          time: 120_000,
          average: 15,
          lag: "NaN",
          line: { series: 15 },
          above: [],
          provisional: false,
        },
        {
          time: 180_000,
          average: 25,
          lag: 10,
          line: { series: 25 },
          above: [{ title: "Up", message: "Price rose" }],
          provisional: false,
        },
      ],
    },
  });
  // The config is not echoed; Samples rows would otherwise count twice.
  expect(result.output).not.toHaveProperty("value.config");
  expect(JSON.parse(JSON.stringify(result.output))).toEqual(result.output);
  expect(f.observe).toHaveBeenCalledTimes(2);
  // The second read is the warmup, the same standard count a chart uses.
  expect(f.observe.mock.calls[1]![0]).toMatchObject({
    countBack: standardWarmupBars,
  });
  expect(f.released).toHaveBeenCalledTimes(2);
  expect(f.dispose).toHaveBeenCalledTimes(1);
  const released = await f.runtime.runPromise(
    f.tea
      .validate({ ...node, id: f.dispose.mock.calls[0]![0].id, nodes: {} })
      .pipe(Effect.flip),
  );
  expect(released.code).toBe("node_unavailable");
  expect(result.output).not.toHaveProperty("value.id");
});

test("preserves map entries, NaN and null as distinct JSON values", async () => {
  const f = await fixture();
  const result = await f.run({
    ...input,
    source: [
      "values = map.new<string, float>()",
      'values.put("price", close)',
      'values.put("missing", na)',
      'emit "mapping" values',
      "string absent = na",
      'emit "absent" absent',
    ].join("\n"),
  });
  expect(result.output).toMatchObject({
    value: {
      status: "ok",
      rows: [20, 30].map((close) => ({
        mapping: [
          ["price", close],
          ["missing", "NaN"],
        ],
        absent: null,
      })),
    },
  });
  expect(JSON.parse(JSON.stringify(result.output))).toEqual(result.output);
});

test("a Samples input matches market execution including warmup, visuals, alert events and symbol", async () => {
  const f = await fixture();
  const args = {
    ...input,
    source: [
      "average = ta.sma(close, 2)",
      'emit "average" average',
      'emit "lag" close[2]',
      'plot("line", average)',
      'alertcondition("cross", ta.crossover(close, 22) and barstate.isconfirmed)',
      'emit "realtime" barstate.isrealtime',
      'emit "symbol" syminfo.ticker',
    ].join("\n"),
  };
  const market = await f.run(args);
  expect(market.output).toMatchObject({
    value: {
      status: "ok",
      rows: [
        { average: 15, cross: [], realtime: false, symbol: "AAPL" },
        { average: 25, cross: [expect.any(Object)] },
      ],
    },
  });
  f.acquireFeed.mockClear();
  f.observe.mockClear();
  f.acquireFeed.mockImplementation(() => {
    throw new Error("Samples must not acquire Feed");
  });
  const result = await f.run({ ...args, config: sampled() });
  expect(result.output).toEqual(market.output);
  expect(f.acquireFeed).not.toHaveBeenCalled();
  expect(f.observe).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledTimes(2);
  expect(
    await f.runtime.runPromise(
      f.tea
        .validate({ ...node, id: f.dispose.mock.calls[1]![0].id, nodes: {} })
        .pipe(Effect.flip),
    ),
  ).toMatchObject({ code: "node_unavailable" });
});

test("samples use only supplied warmup and keep empty windows empty", async () => {
  const f = await fixture();
  f.acquireFeed.mockImplementation(() => {
    throw new Error("Samples must not acquire Feed");
  });
  const full = rows();
  expect(
    (
      await f.run({
        ...input,
        source: 'emit "average" ta.sma(close, 2)',
        config: sampled(full.slice(1)),
      })
    ).output,
  ).toMatchObject({
    value: { status: "ok", rows: [{ average: "NaN" }, { average: 25 }] },
  });
  expect((await f.run({ ...input, config: sampled([]) })).output).toMatchObject(
    { value: { status: "ok", rows: [] } },
  );
  expect(
    (
      await f.run({
        ...input,
        from: 240_000,
        to: 300_000,
        config: sampled(full),
      })
    ).output,
  ).toMatchObject({ value: { status: "ok", rows: [] } });
  expect(
    (await f.run({ ...input, config: sampled(rows([10, null, 30])) })).output,
  ).toMatchObject({
    value: { status: "ok", rows: [{ price: "NaN" }, { price: 30 }] },
  });
  expect(f.acquireFeed).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledTimes(4);
});

test("sample selection honors a finite window independently of wall-clock time", async () => {
  const f = await fixture();
  const start = 4_000_000_000_000;
  expect(
    (
      await f.run({
        ...input,
        from: start + 120_000,
        to: start + 180_000,
        source: 'emit "average" ta.sma(close, 2)',
        config: sampled(
          rows().map((row) => ({ ...row, time: start + row.time })),
        ),
      })
    ).output,
  ).toMatchObject({
    value: { status: "ok", rows: [{ time: start + 120_000, average: 15 }] },
  });
  expect(f.acquireFeed).not.toHaveBeenCalled();
});

test("each request reads its own Samples input; a left-out child needs a ticker id, and an unknown one is rejected", async () => {
  const f = await fixture();
  f.acquireFeed.mockImplementation(() => {
    throw new Error("Samples must not acquire Feed");
  });
  const first = sampled(rows([1, 2, 3]));
  const second = sampled(rows([4, 5, 6]));
  const args = {
    ...input,
    source: [
      'first = request.security("X", "1", close * 2)',
      'second = request.security("X", "1", close * 3)',
      'emit "price" close',
      'emit "first" first',
      'emit "second" second',
    ].join("\n"),
    config: { ...sampled(), requests: { first, second } },
  };
  expect((await f.run(args)).output).toMatchObject({
    value: {
      status: "ok",
      rows: [
        { price: 20, first: 4, second: 15 },
        { price: 30, first: 6, second: 18 },
      ],
    },
  });
  for (const [requests, message] of [
    [{ first }, "second: 'X' is not a ticker id"],
    [
      { first, second, extra: sampled() },
      "requests.extra at root is not a request.security line",
    ],
    [
      { first: { ...first, requests: { extra: sampled() } }, second },
      "requests.extra at root.requests.first is not",
    ],
  ] as const) {
    expect(
      (await f.run({ ...args, config: { ...args.config, requests } })).output,
    ).toMatchObject({
      value: {
        status: "rejected",
        code: "invalid_request",
        message: expect.stringContaining(message),
      },
    });
  }
  expect(f.acquireFeed).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledTimes(4);
});

test("invalid Samples inputs are rejected before permissions or compilation", async () => {
  const f = await fixture();
  const data = rows();
  const row = data[0]!;
  for (const invalid of [
    [...data].reverse(),
    [row, row],
    [{ ...row, time: 0.5 }],
    [{ ...row, close: Infinity }],
    [{ ...row, close: undefined }],
    [{ ...row, final: false }],
    [{ ...row, realtime: true }],
  ]) {
    expect(
      await f.runtime.runPromise(
        f.tool
          .execute({ ...input, config: sampled(invalid) }, f.ctx)
          .pipe(Effect.flip),
      ),
    ).toBeInstanceOf(InvalidArgumentsError);
  }
  // Samples need rows; the separate samples parameter no longer exists.
  for (const invalid of [
    {
      ...input,
      config: {
        ...config,
        inputs: { bars: { ...config.inputs.bars!, _tag: "Samples" } },
      },
    },
    { ...input, samples: { rows: data, requests: {} } },
  ]) {
    expect(
      await f.runtime.runPromise(
        f.tool.execute(invalid, f.ctx).pipe(Effect.flip),
      ),
    ).toBeInstanceOf(InvalidArgumentsError);
  }
  expect(f.ask).not.toHaveBeenCalled();
  expect(f.compile).not.toHaveBeenCalled();
  expect(f.acquireFeed).not.toHaveBeenCalled();
});

test("resolves file paths from the Assistant cwd before authorization and execution", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "main.tea"), source);
  const message = assistant(context.messageID, [], context.sessionID);
  if (message.info.role !== "assistant") throw new Error("Expected Assistant");
  message.info.path = { cwd: f.root, root: f.root };
  await f.runtime.runPromise(
    seed(context.sessionID, "Tea run", [[message, 1]]),
  );
  const request = { config, from: input.from, to: input.to };
  const relative = await f.run({ ...request, path: "main.tea" });
  const absolute = await f.run({ ...request, path: join(f.root, "main.tea") });
  expect(relative.output).toEqual(absolute.output);
  expect(relative.output).toMatchObject({
    value: { status: "ok", rows: [{ price: 20 }, { price: 30 }] },
  });
  expect(f.ask).toHaveBeenCalledWith(
    expect.objectContaining({
      permission: "tea_run",
      patterns: [join(f.root, "main.tea")],
    }),
  );
});

test("empty intervals stay empty even if Feed countBack finds a prior bar", async () => {
  const f = await fixture();
  expect(
    (await f.run({ ...input, from: 240_000, to: 300_000 })).output,
  ).toMatchObject({
    value: { status: "ok", range: { from: 240_000, to: 300_000 }, rows: [] },
  });
  const empty = await fixture([]);
  expect((await empty.run()).output).toMatchObject({
    value: { status: "ok", rows: [] },
  });
});

test("executes child requests with their complete configuration", async () => {
  const f = await fixture();
  const childSource =
    'child = request.security("X", "1", close * 2)\nemit "twice" child';
  expect(
    (
      await f.run({
        ...input,
        source: childSource,
        config: { ...config, requests: { child: config } },
      })
    ).output,
  ).toMatchObject({
    value: { status: "ok", rows: [{ twice: 40 }, { twice: 60 }] },
  });
  expect(f.released).toHaveBeenCalledTimes(f.observe.mock.calls.length);
  f.acquireFeed.mockClear();
  expect((await f.run({ ...input, source: childSource })).output).toMatchObject(
    { value: { status: "rejected", code: "invalid_request" } },
  );
  expect(f.acquireFeed).not.toHaveBeenCalled();
});

test("returns compiler and binding diagnostics without acquiring Feed", async () => {
  const f = await fixture();
  expect(
    (await f.run({ ...input, source: 'emit "value" missing_name' })).output,
  ).toMatchObject({
    value: {
      status: "rejected",
      code: "compile_failed",
      message: expect.stringContaining("<inline>:1:"),
    },
  });
  // Each run breaks one rule; the message names what is wrong.
  for (const [args, reason] of [
    [
      { ...input, source: 'n = input.int(2)\nemit "value" close * n' },
      "parameters",
    ],
    // The script reads close, so the map must say where close comes from.
    [
      {
        ...input,
        config: {
          ...config,
          map: Object.fromEntries(
            Object.entries(config.map).filter(([column]) => column !== "close"),
          ),
        },
      },
      "close",
    ],
    // A node needs at least one input.
    [{ ...input, config: { ...config, inputs: {}, map: {} } }, "input"],
    // These tools run no other nodes, so a NodeRef has nothing to read.
    [
      {
        ...input,
        config: {
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
      },
      "nodes.rsi",
    ],
  ] as const) {
    expect((await f.run(args)).output).toMatchObject({
      value: {
        status: "rejected",
        code: "invalid_request",
        message: expect.stringContaining(reason),
      },
    });
  }
  expect(f.acquireFeed).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledTimes(4);
});

test("rejects invalid source, config and non-finite windows before any permission or execution", async () => {
  const f = await fixture();
  for (const args of [
    { config, from: 0, to: 1 },
    { ...input, path: "main.tea" },
    { ...input, source: "" },
    { source, from: 0, to: 1 },
    { ...input, config: { ...config, map: undefined } },
    { ...input, to: "now" },
    { ...input, to: input.from },
    { ...input, to: 0 },
    { ...input, from: 0.1 },
    { ...input, unexpected: true },
  ]) {
    expect(
      await f.runtime.runPromise(f.tool.execute(args, f.ctx).pipe(Effect.flip)),
    ).toBeInstanceOf(InvalidArgumentsError);
  }
  expect(f.ask).not.toHaveBeenCalled();
  expect(f.compile).not.toHaveBeenCalled();
});

test("the model sees flat source and range fields and the NodeConfig structure", () => {
  // The same derivation as server/agent/llm/llm.ts.
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(Schema.toEncoded(Parameters)),
  );
  expect(document.schema).toMatchObject({
    type: "object",
    properties: { config: { $ref: "#/definitions/NodeConfig" } },
  });
  expect(document.definitions.NodeConfig).toMatchObject({
    required: ["inputs", "map", "parameters", "requests"],
  });
  const schema = providerToolInputSchema({
    ...document.schema,
    definitions: document.definitions,
  });
  for (const valid of [
    input,
    { ...input, config: { ...sampled(), requests: { child: sampled() } } },
    { path: "main.tea", config, from: 0, to: 1 },
  ])
    expect(schema.safeParse(valid).success).toBe(true);
  for (const invalid of [
    { ...input, to: "now" },
    { ...input, samples: { rows: rows(), requests: {} } },
    { ...input, config: sampled([{ ...rows()[0]!, final: true }]) },
  ])
    expect(schema.safeParse(invalid).success).toBe(false);
});

test("permission failure precedes compilation and data access", async () => {
  const f = await fixture();
  const denied = new Error("Denied");
  f.ask.mockImplementation(() => Effect.fail(denied));
  expect(
    await f.runtime.runPromise(f.tool.execute(input, f.ctx).pipe(Effect.flip)),
  ).toBe(denied);
  expect(f.compile).not.toHaveBeenCalled();
  expect(f.acquireFeed).not.toHaveBeenCalled();
});

test("upstream failure releases compilation and returns a Tea diagnostic", async () => {
  const f = await fixture();
  const failure = new FeedError({
    reason: new FeedReasons.SourceUnavailable({
      provider: ProviderId.make("yfinance"),
    }),
  });
  f.observe.mockImplementation(() => Effect.fail(failure));
  expect((await f.run()).output).toMatchObject({
    value: {
      status: "rejected",
      code: "upstream",
      message: failure.message,
    },
  });
  expect(f.dispose).toHaveBeenCalledTimes(1);
});

test("cancellation while acquiring data releases the observation and compilation", async () => {
  const f = await fixture();
  const entered = Deferred.makeUnsafe<void>();
  f.observe.mockImplementation(() =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          f.released();
        }),
      );
      yield* Deferred.succeed(entered, undefined);
      return yield* Effect.never;
    }),
  );
  const abort = new AbortController();
  const pending = f.runtime.runPromise(f.tool.execute(input, f.ctx), {
    signal: abort.signal,
  });
  const failure = expect(pending).rejects.toThrow();
  await f.runtime.runPromise(Deferred.await(entered));
  abort.abort();
  await failure;
  expect(f.released).toHaveBeenCalledTimes(1);
  expect(f.dispose).toHaveBeenCalledTimes(1);
});

test("oversized results fail intact and release resources", async () => {
  const f = await fixture(Array.from({ length: 1001 }, () => 1));
  const failure = await f.runtime.runPromise(
    f.tool
      .execute({ ...input, from: 0, to: 1002 * 60_000 }, f.ctx)
      .pipe(Effect.flip),
  );
  expect(failure).toBeInstanceOf(TeaRunOutputTooLarge);
  expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.released).toHaveBeenCalledTimes(f.observe.mock.calls.length);
  const wide = await fixture();
  const largeSource = `emit "text" "${"x".repeat(100_000)}"`;
  expect(
    await wide.runtime.runPromise(
      wide.tool
        .execute({ ...input, source: largeSource }, wide.ctx)
        .pipe(Effect.flip),
    ),
  ).toBeInstanceOf(TeaRunOutputTooLarge);
  expect(wide.dispose).toHaveBeenCalledTimes(1);
});
