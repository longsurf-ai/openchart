// Purpose: Exercise Tea metadata, Arrow outputs and independent channels through real HTTP/Hose.
import { once } from "node:events";
import { createServer } from "node:http";

import { BarsSeries } from "@openchart/feed";
import { HoseConnection, HoseRouter, type Channel } from "@openchart/hose";
import * as Tea from "@openchart/tea";
import { fromPoints, fromRows, toJson } from "@openchart/timeseries";
import {
  Bool,
  Field,
  Float64,
  List,
  Schema as ArrowSchema,
  Struct,
  TimestampMillisecond,
  Utf8,
} from "apache-arrow";
import { Schema } from "effect";
import { lastValueFrom } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { createTeaClient } from "@openchart/app/lib/tea";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { FeedTransport } from "@openchart/app/lib/feed/transport";
import type { BarsView } from "@openchart/app/feed";

const series = Schema.decodeUnknownSync(BarsSeries)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
});
const request: Tea.ObserveRequest = {
  id: "tea-1",
  ...Tea.barsInputs(series),
  parameters: { length: 20 },
  requests: {},
  nodes: {},
  from: 0,
  to: "now",
  countBack: 2,
  warmupBars: Tea.standardWarmupBars,
};
const inputs = new ArrowSchema([
  new Field("time", new TimestampMillisecond(), false),
  new Field("close", new Float64(), false, new Map([["unit", "USD"]])),
]);
const encodedNode = Schema.encodeSync(Tea.CompileResponse)({
  id: request.id,
  definition: {
    parameters: [],
    inputs,
    outputs: inputs,
    requests: {
      daily: {
        parameters: [],
        inputs,
        outputs: inputs,
        requests: {},
        target: { symbol: "binance:BTCUSDT", timeframe: "D" },
      },
    },
  },
  declaration: null,
});
const outputs = new ArrowSchema([
  new Field("time", new TimestampMillisecond(), false),
  new Field("value", new Float64(), true),
  new Field("provisional", new Bool(), false),
  new Field(
    "events",
    new List(
      new Field(
        "item",
        new Struct([
          new Field("time", new TimestampMillisecond(), false),
          new Field("text", new Utf8(), false),
        ]),
        false,
      ),
    ),
    false,
    new Map([["tea:write", "append"]]),
  ),
]);
const row = (time: number, value: number | null = null) => ({
  time,
  value,
  provisional: time > 1,
  events: [
    { time: 0, text: "first" },
    { time: 0, text: "second" },
  ],
});
const encodeMessage = Schema.encodeSync(Tea.Message);
const snapshot = () =>
  encodeMessage({
    type: "snapshot",
    config: { inputs: {}, map: {}, parameters: {}, requests: {} },
    rid: "run-1",
    snapshot: { range: { from: 0, to: 10 }, data: fromRows(outputs, [row(1)]) },
  });
const update = (time = 2) =>
  encodeMessage({ type: "updates", data: fromRows(outputs, [row(time, NaN)]) });
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});

async function start(
  handle: (channel: Channel) => void = (channel) => channel.data(snapshot()),
  options: {
    holdCompile?: boolean;
    holdDispose?: boolean;
    disposeFailures?: number;
    invalidMetadata?: boolean;
    compileFailure?: { code: "compile_failed"; message: string };
  } = {},
) {
  vi.stubGlobal("WebSocket", WebSocket);
  const http: { path: string; input: unknown }[] = [];
  let compileCancelled = false;
  let nextNode = 0;
  const compilations: (() => void)[] = [];
  const disposals: (() => void)[] = [];
  const finishCompiles = () =>
    compilations.splice(0).forEach((finish) => finish());
  const finishDisposes = () =>
    disposals.splice(0).forEach((finish) => finish());
  const server = createServer(async (incoming, response) => {
    let body = "";
    for await (const chunk of incoming) body += String(chunk);
    const path = incoming.url!.split("?")[0]!;
    http.push({ path, input: JSON.parse(body) as unknown });
    const result =
      path === "/trpc/tea.compile"
        ? {
            ...encodedNode,
            ...(options.invalidMetadata
              ? { definition: { ...encodedNode.definition, inputs: {} } }
              : {}),
            id: `tea-${++nextNode}`,
          }
        : null;
    const finish = () => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ result: { data: result } }));
    };
    if (path === "/trpc/tea.compile" && options.holdCompile) {
      response.on("close", () => {
        compileCancelled = !response.writableEnded;
      });
      compilations.push(finish);
      return;
    }
    if (path === "/trpc/tea.dispose" && options.holdDispose) {
      disposals.push(finish);
      return;
    }
    if (path === "/trpc/tea.dispose" && options.disposeFailures) {
      options.disposeFailures--;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: -32603,
            message: "Disposal failed",
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        }),
      );
      return;
    }
    response.setHeader("content-type", "application/json");
    if (options.compileFailure && path === "/trpc/tea.compile") {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: {
            code: -32603,
            message: "Internal server error",
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 500,
              error: options.compileFailure,
            },
          },
        }),
      );
      return;
    }
    finish();
  });
  const channels: Channel[] = [];
  const opened: unknown[] = [];
  const stopped = new Set<Channel>();
  const router = new HoseRouter().route("tea.open", (input, channel) => {
    opened.push(input);
    channels.push(channel);
    handle(channel);
    return () => {
      stopped.add(channel);
    };
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) => {
    const hose = new HoseConnection(
      {
        send: (message) => {
          socket.send(message);
          return true;
        },
        close: () => socket.close(),
        get bufferedAmount() {
          return socket.bufferedAmount;
        },
      },
      router,
      undefined,
    );
    socket.on("message", (data) => hose.receive(data.toString()));
    socket.on("close", () => hose.dispose());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server port");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  const client = createTeaClient(transport);
  cleanup.push(async () => {
    finishCompiles();
    finishDisposes();
    await client.close();
    transport.hose.disconnect();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    client,
    transport,
    router,
    http,
    channels,
    opened,
    stopped,
    sockets,
    compileCancelled: () => compileCancelled,
    finishCompiles,
    finishDisposes,
  };
}

it("decodes recursive Arrow metadata and avoids redisposing explicitly released nodes", async () => {
  const { client, http } = await start();
  const input = { workspaceId: "workspace-1", path: "main.tea" };
  const node = await client.compile(input);
  expect(node.id).toBe(request.id);
  expect(node.definition.inputs).toBeInstanceOf(ArrowSchema);
  expect(node.definition.inputs.fields[1]!.metadata.get("unit")).toBe("USD");
  expect(
    node.definition.requests.daily!.inputs.fields.map((field) => field.name),
  ).toEqual(["time", "close"]);
  await client.dispose({ id: node.id });
  await client.close();
  expect(http).toEqual([
    { path: "/trpc/tea.compile", input },
    { path: "/trpc/tea.dispose", input: { id: node.id } },
  ]);
});

it("keeps observations cold, preserves nested values and cancels only the subscriber's channel", async () => {
  const { client, channels, stopped, sockets, http } = await start();
  const one: Tea.Message[] = [];
  const two: Tea.Message[] = [];
  const stream = client.observe(request);
  expect(channels).toHaveLength(0);
  const first = stream.subscribe((message) => one.push(message));
  const second = stream.subscribe((message) => two.push(message));
  cleanup.push(() => {
    first.unsubscribe();
    second.unsubscribe();
  });
  await vi.waitFor(() => expect(channels).toHaveLength(2));
  await vi.waitFor(() => expect(one).toHaveLength(1));
  const message = one[0]!;
  expect(message.type).toBe("snapshot");
  if (message.type !== "snapshot") throw new Error("Expected initial snapshot");
  expect(Array.from(message.snapshot.data)).toEqual([row(1)]);
  expect(
    message.snapshot.data.schema.fields[3]!.metadata.get("tea:write"),
  ).toBe("append");
  first.unsubscribe();
  await vi.waitFor(() => expect(stopped.size).toBe(1));
  channels[1]!.data(update());
  await vi.waitFor(() => expect(two).toHaveLength(2));
  const live = two[1]!;
  if (live.type !== "updates") throw new Error("Expected update");
  expect(Array.from(live.data)).toEqual([row(2, NaN)]);
  expect(one).toHaveLength(1);
  expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
  second.unsubscribe();
  await vi.waitFor(() => expect(stopped.size).toBe(2));
  expect(http).toEqual([]);
});

it.each(["feed", "tea", "app"] as const)(
  "%s cleanup respects ownership of the shared Feed/Tea socket",
  async (owner) => {
    const { client, transport, router, sockets, channels, stopped, http } =
      await start();
    const feed = new FeedTransport(transport).client();
    cleanup.push(() => feed.close());
    let connections = 0;
    sockets.on("connection", () => connections++);
    expect(sockets.clients.size).toBe(0);
    const barsFrame = (time: number) =>
      toJson(
        fromPoints({}, [
          {
            time,
            open: 1,
            high: 2,
            low: 1,
            close: 2,
            volume: 3,
            asOf: 10,
            final: true,
          },
        ]),
      );
    let barsChannel: Channel | undefined;
    let barsStopped = false;
    router.route("bars.open", (_input, channel) => {
      barsChannel = channel;
      channel.data({
        type: "snapshot",
        snapshot: {
          range: { from: 0, to: 10 },
          data: barsFrame(1),
          hasMoreBefore: false,
        },
      });
      return () => {
        barsStopped = true;
      };
    });
    const views: BarsView[] = [];
    const messages: Tea.Message[] = [];
    const feedErrors: unknown[] = [];
    const teaErrors: unknown[] = [];
    const barsSubscription = feed.bars
      .observe({ ...series, from: 0, to: "now", countBack: 2 })
      .subscribe({
        next: (view) => views.push(view),
        error: (error) => feedErrors.push(error),
      });
    const teaSubscription = client.observe(request).subscribe({
      next: (message) => messages.push(message),
      error: (error) => teaErrors.push(error),
    });
    cleanup.push(() => {
      barsSubscription.unsubscribe();
      teaSubscription.unsubscribe();
    });
    await vi.waitFor(() => {
      expect(views).toHaveLength(1);
      expect(messages).toHaveLength(1);
    });
    expect(connections).toBe(1);
    const socket = [...sockets.clients][0]!;

    if (owner === "feed") {
      feed.close();
      await vi.waitFor(() => expect(barsStopped).toBe(true));
      expect(feedErrors).toMatchObject([{ _tag: "Client.Cancelled" }]);
      expect(stopped.size).toBe(0);
      channels[0]!.data(update());
      await vi.waitFor(() => expect(messages).toHaveLength(2));
      expect(teaErrors).toEqual([]);
    } else if (owner === "tea") {
      await client.close();
      await vi.waitFor(() => expect(stopped.size).toBe(1));
      expect(teaErrors).toMatchObject([{ code: "cancelled" }]);
      expect(barsStopped).toBe(false);
      const times: number[] = [];
      const updates = views[0]!.updates.subscribe({
        next: (frame) => times.push(frame.get(0)!.time),
        error: () => {},
      });
      cleanup.push(() => updates.unsubscribe());
      barsChannel!.data({ type: "updates", data: barsFrame(2) });
      await vi.waitFor(() => expect(times).toEqual([2]));
      expect(feedErrors).toEqual([]);
    }
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(connections).toBe(1);
    transport.hose.disconnect();
    await vi.waitFor(() => {
      expect(barsStopped).toBe(true);
      expect(stopped.size).toBe(1);
      expect(sockets.clients.size).toBe(0);
    });
    expect(feedErrors).toHaveLength(1);
    expect(teaErrors).toHaveLength(1);
    expect(http).toEqual([]);
  },
);

it("invalid IPC fails only its channel without restarting or disposing the node", async () => {
  const { client, channels, stopped, sockets, http } = await start();
  const errors: unknown[] = [];
  const healthy: Tea.Message[] = [];
  const failed = client
    .observe(request)
    .subscribe({ error: (error) => errors.push(error) });
  const other = client
    .observe(request)
    .subscribe((message) => healthy.push(message));
  cleanup.push(() => {
    failed.unsubscribe();
    other.unsubscribe();
  });
  await vi.waitFor(() => expect(channels).toHaveLength(2));
  channels[0]!.data({ type: "updates", data: "invalid IPC" });
  await vi.waitFor(() =>
    expect(errors).toMatchObject([{ code: "invalid_data" }]),
  );
  await vi.waitFor(() => expect(stopped.size).toBe(1));
  channels[1]!.data(update());
  await vi.waitFor(() => expect(healthy).toHaveLength(2));
  expect(channels).toHaveLength(2);
  expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
  expect(http).toEqual([]);
});

it("an explicit abort reason cancels only that observation", async () => {
  const { client, channels, stopped, http } = await start();
  const controller = new AbortController();
  const errors: unknown[] = [];
  const values: Tea.Message[] = [];
  const cancelled = client
    .observe(request, { signal: controller.signal })
    .subscribe({ error: (error) => errors.push(error) });
  const active = client
    .observe(request)
    .subscribe((message) => values.push(message));
  cleanup.push(() => {
    cancelled.unsubscribe();
    active.unsubscribe();
  });
  await vi.waitFor(() => expect(channels).toHaveLength(2));
  controller.abort(new Error("Consumer switched nodes"));
  await vi.waitFor(() => expect(errors).toMatchObject([{ code: "cancelled" }]));
  await vi.waitFor(() => expect(stopped.size).toBe(1));
  channels[1]!.data(update());
  await vi.waitFor(() => expect(values).toHaveLength(2));
  await expect(
    lastValueFrom(client.observe(request, { signal: controller.signal })),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(channels).toHaveLength(2);
  expect(http).toEqual([]);
});

it.each(["empty", "updates-first", "duplicate", "finite-updates"])(
  "rejects %s protocol delivery",
  async (mode) => {
    const { client } = await start((channel) => {
      if (mode !== "empty" && mode !== "updates-first")
        channel.data(snapshot());
      if (mode === "duplicate") channel.data(snapshot());
      if (mode === "updates-first" || mode === "finite-updates")
        channel.data(update());
      channel.done();
    });
    await expect(
      lastValueFrom(
        client.observe(
          mode === "finite-updates" ? { ...request, to: 10 } : request,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_data" });
  },
);

it("shutdown stops observations, drains late compilations and disposes their server IDs", async () => {
  const { client, http, channels, stopped, compileCancelled, finishCompiles } =
    await start(undefined, { holdCompile: true });
  const errors: unknown[] = [];
  const subscription = client
    .observe(request)
    .subscribe({ error: (error) => errors.push(error) });
  cleanup.push(() => subscription.unsubscribe());
  const pending = client
    .compile({ workspaceId: "workspace-1", path: "main.tea" })
    .catch((error: unknown) => error);
  await vi.waitFor(() => expect(http).toHaveLength(1));
  await vi.waitFor(() => expect(channels).toHaveLength(1));
  const closing = client.close();
  expect(client.close()).toBe(closing);
  await vi.waitFor(() => expect(stopped.size).toBe(1));
  expect(compileCancelled()).toBe(false);
  expect(http).toHaveLength(1);
  expect(errors).toMatchObject([{ code: "cancelled" }]);
  await expect(lastValueFrom(client.observe(request))).rejects.toMatchObject({
    code: "cancelled",
  });
  await expect(
    client.compile({ workspaceId: "workspace-1", path: "other.tea" }),
  ).rejects.toMatchObject({ code: "cancelled" });
  finishCompiles();
  expect(await pending).toMatchObject({ code: "cancelled" });
  await closing;
  expect(http.map((call) => [call.path, call.input])).toEqual([
    ["/trpc/tea.compile", { workspaceId: "workspace-1", path: "main.tea" }],
    ["/trpc/tea.dispose", { id: "tea-1" }],
  ]);
});

it("owns only its compilations and joins concurrent explicit/shutdown disposal", async () => {
  const { client, transport, http, finishDisposes } = await start(undefined, {
    holdDispose: true,
  });
  const other = createTeaClient(transport);
  cleanup.push(async () => {
    finishDisposes();
    await other.close();
  });
  const own = await client.compile({ workspaceId: "w", path: "one.tea" });
  const theirs = await other.compile({ workspaceId: "w", path: "two.tea" });
  const releasing = client.dispose({ id: own.id });
  const closing = client.close();
  await vi.waitFor(() =>
    expect(http.filter((call) => call.path.endsWith("dispose"))).toHaveLength(
      1,
    ),
  );
  expect(http.at(-1)?.input).toEqual({ id: own.id });
  finishDisposes();
  await Promise.all([releasing, closing]);
  const otherClose = other.close();
  await vi.waitFor(() =>
    expect(http.filter((call) => call.path.endsWith("dispose"))).toHaveLength(
      2,
    ),
  );
  expect(http.at(-1)?.input).toEqual({ id: theirs.id });
  finishDisposes();
  await otherClose;
});

it("reports failed shutdown and retains IDs for an explicit retry", async () => {
  const { client, http } = await start(undefined, { disposeFailures: 1 });
  await client.compile({ workspaceId: "w", path: "main.tea" });
  await expect(client.close()).rejects.toThrow("Could not dispose Tea nodes");
  await client.close();
  expect(http.filter((call) => call.path.endsWith("dispose"))).toHaveLength(2);
});

it("releases a cancelled caller's late compilation without closing other consumers", async () => {
  const { client, http, finishCompiles } = await start(undefined, {
    holdCompile: true,
  });
  const controller = new AbortController();
  const pending = client
    .compile(
      { workspaceId: "w", path: "main.tea" },
      { signal: controller.signal },
    )
    .catch((error: unknown) => error);
  await vi.waitFor(() => expect(http).toHaveLength(1));
  controller.abort();
  finishCompiles();
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(http.at(-1)?.path).toBe("/trpc/tea.dispose");
  const active = client.compile({ workspaceId: "w", path: "next.tea" });
  await vi.waitFor(() => expect(http).toHaveLength(3));
  finishCompiles();
  expect((await active).id).toBe("tea-2");
});

it("sends a request's Arrow schemas as JSON that decodes with their metadata", async () => {
  const { client, opened } = await start();
  // A Bars schema whose close column carries field metadata.
  const priced = new ArrowSchema(
    Tea.barsSchema.fields.map((field) =>
      field.name === "close"
        ? new Field("close", new Float64(), true, new Map([["unit", "USDT"]]))
        : field,
    ),
  );
  const bars = { _tag: "Bars" as const, ...series, schema: priced };
  const observed = { ...request, inputs: { bars } };
  const subscription = client.observe(observed).subscribe();
  cleanup.push(() => subscription.unsubscribe());
  await vi.waitFor(() => expect(opened).toHaveLength(1));
  expect(opened[0]).toEqual(
    Schema.encodeSync(Tea.ChannelRequest)({
      type: "tea.open",
      request: observed,
    }),
  );
  const received = Schema.decodeUnknownSync(Tea.ChannelRequest)(opened[0]);
  const close = received.request.inputs.bars!.schema.fields.find(
    (field) => field.name === "close",
  );
  expect(close?.metadata.get("unit")).toBe("USDT");
});

it("validates request shapes before opening a channel and forwards safe server failures", async () => {
  const failure = {
    code: "compile_failed",
    message: "Tea source has a syntax error",
  } as const;
  const { client, channels } = await start(
    (channel) =>
      channel.error("failed", {
        code: "node_unavailable",
        message: "Tea node is unavailable",
      }),
    { compileFailure: failure },
  );
  await expect(
    lastValueFrom(client.observe({ ...request, from: 20, to: 10 })),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(channels).toHaveLength(0);
  await expect(
    client.compile({ workspaceId: "workspace-1", path: "main.tea" }),
  ).rejects.toMatchObject(failure);
  await expect(lastValueFrom(client.observe(request))).rejects.toMatchObject({
    code: "node_unavailable",
    message: "Tea node is unavailable",
  });
});

it("reports a Hose failure without a Tea body as an upstream failure", async () => {
  const { client } = await start((channel) => channel.error("internal"));
  await expect(lastValueFrom(client.observe(request))).rejects.toMatchObject({
    code: "upstream",
    message: "Tea connection failed",
    cause: { code: "internal" },
  });
});

it("releases a returned ID when the remaining compilation metadata cannot be decoded", async () => {
  const { client, http } = await start(undefined, { invalidMetadata: true });
  await expect(
    client.compile({ workspaceId: "w", path: "bad.tea" }),
  ).rejects.toMatchObject({ code: "invalid_data" });
  expect(http.at(-1)).toEqual({
    path: "/trpc/tea.dispose",
    input: { id: "tea-1" },
  });
  await client.close();
  expect(http).toHaveLength(2);
});
