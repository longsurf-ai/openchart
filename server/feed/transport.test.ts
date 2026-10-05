// Purpose: Exercise real HTTP/SSE and Hose retirement, completion, and explicit cancellation.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { once } from "node:events";
import { createServer as createHttpServer, type Server } from "node:http";
import { createTRPCClient, httpLink } from "@trpc/client";
import { createServer, hoseRouter, type AppRouter } from "@openchart/server";
import {
  binanceBars,
  binanceSymbology,
} from "@openchart/server/data/providers/binance/datasets/definitions";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import {
  BarsCapabilities,
  BarsMessage,
  BarsRequest,
  FeedVersion,
} from "@openchart/feed";
import { symbols } from "@openchart/timeseries";
import { makeDataset, type IDatasetProvider } from "@openchart/server/data";
import { streamChannel } from "@openchart/server/lib/hose";
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { expect, it, vi } from "vitest";
import WebSocket from "ws";
import { HoseRouter } from "@openchart/hose";
import { catalogLayer } from "@openchart/server/data";
import { FeedVersionChanged } from "./events";

const Message = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("data"),
    id: Schema.String,
    body: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    id: Schema.String,
    code: Schema.Literal("failed"),
    body: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    id: Schema.String,
    code: Schema.Literals(["invalid_request", "not_found", "internal"]),
  }),
  Schema.Struct({ type: Schema.Literal("done"), id: Schema.String }),
]);
// Strict like Hose itself, so an extra field (such as leaked text) fails the test.
const parseMessage = Schema.decodeUnknownSync(Schema.fromJsonString(Message), {
  onExcessProperty: "error",
});
const parseJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown),
);
type Message = typeof Message.Type;

const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "Binance",
    currency: "USDT",
  },
  resolution: "1m",
  adjustment: "raw",
  session: "24h",
  from: 0,
  to: "now",
  countBack: 1,
});
function frame(close: number, trades: number, times = [1]) {
  return binanceBars.frame.create({
    labels: { symbol: "BTCUSDT" },
    rows: times.map((time) => ({
      time,
      open: 1,
      high: close,
      low: 1,
      close,
      volume: trades,
      trades,
      final: false,
      asOf: trades,
    })),
  });
}
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

it("rejects duplicate types when composing application routes", () => {
  const handler = vi.fn();
  expect(() => new HoseRouter(hoseRouter).route("bars.open", handler)).toThrow(
    "Duplicate channel operation bars.open",
  );
  expect(handler).not.toHaveBeenCalled();
});

it("keeps transports and accepted work alive across Provider retirement", async () => {
  let started = false;
  let aborted = false;
  let finishUpstream!: () => void;
  const upstream = createHttpServer((_request, response) => {
    finishUpstream = () => response.end();
    started = true;
    response.on("close", () => {
      aborted = true;
    });
  });
  const upstreamUrl = await listen(upstream);
  let queue:
    | Queue.Queue<ReturnType<typeof frame>, DatasetFailure | Cause.Done>
    | undefined;
  let streamsClosed = 0;
  let providersClosed = 0;
  const enabled = Effect.runSync(SubscriptionRef.make(true));
  const provider: IDatasetProvider = {
    definitions: [binanceBars, binanceSymbology],
    watch: () =>
      SubscriptionRef.changes(enabled).pipe(
        Stream.switchMap((active) =>
          active
            ? Stream.unwrap(
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      providersClosed++;
                    }),
                  );
                  const retired = yield* Deferred.make<void>();
                  yield* Effect.addFinalizer(() =>
                    Deferred.succeed(retired, undefined),
                  );
                  const bars = yield* makeDataset(binanceBars, {
                    stream: () =>
                      Effect.gen(function* () {
                        queue = yield* Queue.unbounded<
                          ReturnType<typeof frame>,
                          DatasetFailure | Cause.Done
                        >();
                        yield* Effect.addFinalizer(() =>
                          Effect.sync(() => {
                            streamsClosed++;
                          }),
                        );
                        const updates = queue;
                        yield* Deferred.await(retired).pipe(
                          Effect.andThen(Queue.end(updates)),
                          Effect.forkScoped,
                        );
                        return Stream.fromQueue(updates);
                      }),
                    select: (query) =>
                      query.count !== undefined
                        ? Effect.succeed(frame(0, 0, []))
                        : query.symbol === "BLOCK"
                          ? Effect.tryPromise({
                              try: async (signal) => {
                                await fetch(upstreamUrl, { signal });
                                return frame(9, 9);
                              },
                              catch: (cause) =>
                                new DatasetFailure(
                                  new DatasetReasons.Unavailable(),
                                  { cause },
                                ),
                            })
                          : Effect.sync(() => {
                              // Inject while history is still being produced; this must follow the wire snapshot.
                              if (queue) Queue.offerUnsafe(queue, frame(3, 3));
                              return frame(2, 2);
                            }),
                  });
                  const symbols = yield* makeDataset(binanceSymbology, {
                    select: () => Effect.succeed([]),
                    search: (query) =>
                      query.query === "BLOCK"
                        ? Effect.tryPromise({
                            try: async (signal) => {
                              await fetch(upstreamUrl, { signal });
                              return [];
                            },
                            catch: (cause) =>
                              new DatasetFailure(
                                new DatasetReasons.Unavailable(),
                                { cause },
                              ),
                          })
                        : Effect.succeed([
                            {
                              symbol: "BTCUSDT",
                              baseAsset: "BTC",
                              quoteAsset: "USDT",
                              status: "TRADING",
                            },
                          ]),
                  });
                  return [bars, symbols];
                }).pipe(
                  Effect.map((datasets) =>
                    Stream.concat(Stream.succeed(datasets), Stream.never),
                  ),
                  Effect.orDie,
                ),
              )
            : Stream.succeed([]),
        ),
      ),
  };
  const searchesClosed: string[] = [];
  const routes = new HoseRouter(hoseRouter).route(
    "test.search",
    streamChannel(
      {
        parse: Schema.decodeUnknownSync(
          Schema.Struct({
            type: Schema.Literal("test.search"),
            query: Schema.String,
            limit: Schema.Int,
          }),
        ),
      },
      (input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                searchesClosed.push(input.query);
              }),
            );
            const result = Stream.succeed({ query: input.query });
            return input.query === "hold"
              ? Stream.concat(result, Stream.never)
              : result;
          }),
        ),
    ),
  );
  const dispatch = vi
    .spyOn(hoseRouter, "handle")
    .mockImplementation(routes.handle.bind(routes));
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
    datasets: catalogLayer(Effect.succeed([provider])),
  });
  const base = await listen(server);
  const rpc = createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${base}/trpc` })],
  });
  const controller = new AbortController();
  const contexts: FeedVersion[] = [];
  let contextError: unknown;
  const contextResponse = await fetch(`${base}/trpc/events.subscribe`, {
    signal: controller.signal,
  });
  expect(contextResponse.status).toBe(200);
  const receiving = (async () => {
    if (!contextResponse.body) throw new Error("Missing SSE response body");
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = contextResponse.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!event.includes("event:")) {
          const data = event
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (data) {
            const frame = Schema.decodeUnknownSync(
              Schema.Union([
                Schema.Struct({ kind: Schema.Literal("ready") }),
                Schema.Struct({
                  kind: Schema.Literal("event"),
                  event: Schema.Struct({
                    id: Schema.String,
                    type: Schema.String,
                    data: Schema.Unknown,
                  }),
                }),
              ]),
            )(parseJson(data.slice(6)));
            if (
              frame.kind === "ready" ||
              frame.event.type === FeedVersionChanged.type
            ) {
              if (frame.kind === "event")
                Schema.decodeUnknownSync(FeedVersionChanged)(frame.event);
              contexts.push(
                Schema.decodeUnknownSync(FeedVersion)(
                  await rpc.feed.version.query(),
                ),
              );
            }
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  })().catch((error) => {
    if (!controller.signal.aborted) contextError = error;
  });
  const socket = new WebSocket(base.replace("http:", "ws:") + "/hose");
  const messages: Message[] = [];
  socket.on("message", (raw) => messages.push(parseMessage(raw.toString())));
  const send = (id: string, body: unknown) =>
    socket.send(JSON.stringify({ type: "open", id, body }));
  const data = (id: string) =>
    messages.filter((message) => message.id === id && message.type === "data");
  try {
    await once(socket, "open");
    await vi.waitFor(() => {
      if (contextError) throw contextError;
      expect(contexts.length).toBeGreaterThan(0);
    });
    let version = contexts[contexts.length - 1]!;
    let attempt = 0;
    await vi.waitFor(async () => {
      version = contexts[contexts.length - 1]!;
      const id = `capabilities-${++attempt}`;
      send(id, {
        type: "bars.capabilities",
        request: { provider: request.provider, listing: request.listing },
      });
      await vi.waitFor(() =>
        expect(
          messages.some((message) => message.id === id),
          JSON.stringify(messages),
        ).toBe(true),
      );
      const message = messages.find((message) => message.id === id);
      expect(message?.type).toBe("data");
      if (message?.type !== "data")
        throw new Error("Capabilities generation changed");
      expect(
        Schema.decodeUnknownSync(BarsCapabilities)(message.body).length,
      ).toBeGreaterThan(0);
    });
    const search = await rpc.feed.symbology.search.query({
      query: "BTC",
      indexed: false,
      limit: 5,
    });
    expect(search.map((hit) => [hit.provider, hit.listing.symbol])).toEqual([
      ["binance", "BTCUSDT"],
    ]);
    send("live", { type: "bars.open", request });
    await vi.waitFor(() => expect(data("live")).toHaveLength(2));
    const paired = data("live").map((message) => {
      if (message.type !== "data") throw new Error("Missing payload");
      return Schema.decodeUnknownSync(BarsMessage)(message.body);
    });
    expect(
      paired.map((message) => [
        message.type,
        (message.type === "snapshot"
          ? message.snapshot.data
          : message.data
        ).get(0)?.close,
      ]),
    ).toEqual([
      ["snapshot", 2],
      ["updates", 3],
    ]);

    for (const message of paired) {
      const value =
        message.type === "snapshot" ? message.snapshot.data : message.data;
      expect(value._dataFrame).toBe(symbols.dataFrame);
      expect(value.labels).toEqual({ symbol: "BTCUSDT" });
      expect(value.schema.fields.map((field) => field.name)).toEqual(
        frame(2, 2).schema.fields.map((field) => field.name),
      );
      // Native columns survive transport beside the typed Bar vocabulary.
      expect(
        [...value].map((row) => (row as Record<string, unknown>).asOf),
      ).toEqual(message.type === "snapshot" ? [2] : [3]);
    }
    if (!queue) throw new Error("Stream was not acquired");
    Queue.offerUnsafe(queue, frame(NaN, 4));
    await vi.waitFor(() => expect(data("live")).toHaveLength(3));
    const gap = data("live")[2];
    if (gap?.type !== "data") throw new Error("Missing gap frame");
    const decodedGap = Schema.decodeUnknownSync(BarsMessage)(gap.body);
    expect(
      decodedGap.type === "updates" &&
        Number.isNaN(decodedGap.data.get(0)?.close),
    ).toBe(true);

    // Other operations use their own schemas on the same socket as live bars.
    send("search-complete", {
      type: "test.search",
      query: "complete",
      indexed: false,
      limit: 1,
    });
    await vi.waitFor(() =>
      expect(messages).toContainEqual({ id: "search-complete", type: "done" }),
    );
    expect(data("search-complete")).toEqual([
      { id: "search-complete", type: "data", body: { query: "complete" } },
    ]);
    expect(searchesClosed).toEqual(["complete"]);

    send("search-hold", { type: "test.search", query: "hold", limit: 1 });
    await vi.waitFor(() => expect(data("search-hold")).toHaveLength(1));
    socket.send(JSON.stringify({ type: "close", id: "search-hold" }));
    await vi.waitFor(() =>
      expect(searchesClosed).toEqual(["complete", "hold"]),
    );

    send("search-invalid", { type: "test.search", query: 7, limit: 1 });
    send("route-invalid", { type: 7 });
    send("route-unknown", { type: "missing.operation" });
    send("provider-missing", {
      type: "bars.open",
      request: { ...request, provider: "missing" },
    });
    await vi.waitFor(() => {
      // A public Feed failure carries its encoded FeedError as the error body.
      expect(messages).toContainEqual({
        id: "provider-missing",
        type: "error",
        code: "failed",
        body: {
          _tag: "FeedError",
          reason: { _tag: "Feed.SourceUnavailable", provider: "missing" },
        },
      });
      for (const id of ["search-invalid", "route-invalid"]) {
        expect(messages).toContainEqual({
          id,
          type: "error",
          code: "invalid_request",
        });
      }
      expect(messages).toContainEqual({
        id: "route-unknown",
        type: "error",
        code: "not_found",
      });
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(
      messages.filter((message) => message.id === "search-hold"),
    ).toHaveLength(1);

    if (!queue) throw new Error("Stream was not acquired");
    // Completion, cancellation and errors on other channels leave these updates live.
    Queue.offerUnsafe(queue, frame(4, 5));
    await vi.waitFor(() => expect(data("live")).toHaveLength(4));
    const last = data("live")[3];
    expect(
      last?.type === "data" &&
        (() => {
          const message = Schema.decodeUnknownSync(BarsMessage)(last.body);
          return message.type === "updates" && message.data.get(0)?.close;
        })(),
    ).toBe(4);

    send("blocked", {
      type: "bars.open",
      request: {
        ...request,
        to: 100,
        listing: { ...request.listing, symbol: "BLOCK" },
      },
    });
    await vi.waitFor(() => expect(started).toBe(true));
    socket.send(JSON.stringify({ type: "close", id: "blocked" }));
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(messages.some((message) => message.id === "blocked")).toBe(false);

    // A finite tRPC query must cancel the backend fetch, not only its client promise.
    started = false;
    aborted = false;
    const searchController = new AbortController();
    const searchAborted = expect(
      rpc.feed.symbology.search.query(
        { query: "BLOCK", limit: 5, indexed: false },
        { signal: searchController.signal },
      ),
    ).rejects.toBeInstanceOf(Error);
    await vi.waitFor(() => expect(started).toBe(true));
    searchController.abort();
    await searchAborted;
    await vi.waitFor(() => expect(aborted).toBe(true));

    // Retirement does not cancel a finite request that already reached its source.
    started = false;
    aborted = false;
    send("finishing", {
      type: "bars.open",
      request: {
        ...request,
        to: 100,
        listing: { ...request.listing, symbol: "BLOCK" },
      },
    });
    await vi.waitFor(() => expect(started).toBe(true));
    await Effect.runPromise(SubscriptionRef.set(enabled, false));
    await vi.waitFor(() =>
      expect(contexts[contexts.length - 1]).not.toBe(version),
    );
    await vi.waitFor(() =>
      expect(messages).toContainEqual({ id: "live", type: "done" }),
    );
    await vi.waitFor(() => expect(streamsClosed).toBe(1));
    expect(aborted).toBe(false);
    finishUpstream();
    await vi.waitFor(() =>
      expect(messages).toContainEqual({ id: "finishing", type: "done" }),
    );
    expect(data("finishing")).toHaveLength(1);
    await expect(
      rpc.feed.symbology.search.query({
        query: "BTC",
        limit: 5,
        indexed: false,
      }),
    ).rejects.toMatchObject({
      data: {
        error: {
          _tag: "FeedError",
          reason: { _tag: "Feed.SourceUnavailable" },
        },
      },
    });
    send("current", {
      type: "bars.capabilities",
      request: { provider: request.provider, listing: request.listing },
    });
    await vi.waitFor(() =>
      expect(data("current")).toEqual([
        { id: "current", type: "data", body: [] },
      ]),
    );
    expect(socket.readyState).toBe(WebSocket.OPEN);
    await Effect.runPromise(SubscriptionRef.set(enabled, true));
    await vi.waitFor(async () =>
      expect(
        await rpc.feed.symbology.search.query({
          query: "BTC",
          limit: 5,
          indexed: false,
        }),
      ).toHaveLength(1),
    );
    send("invalid", {
      type: "bars.open",
      request: { ...request, start: 1 },
      private: "do not leak this",
    });
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        id: "invalid",
        type: "error",
        code: "invalid_request",
      }),
    );
    expect(JSON.stringify(messages)).not.toContain("do not leak this");
    expect(JSON.stringify(messages)).not.toContain('"stack"');
    expect(contextError).toBeUndefined();
  } finally {
    controller.abort();
    await receiving;
    socket.terminate();
    await server.shutdown();
    dispatch.mockRestore();
    await close(upstream);
    await vi.waitFor(() => expect(providersClosed).toBe(2));
  }
}, 15_000);
