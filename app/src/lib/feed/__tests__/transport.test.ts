// Purpose: Verify actual HTTP cancellation and lossless Hose session handoff.
import { once } from "node:events";
import { createServer } from "node:http";

import {
  BarsRequest,
  ClientFailures,
  FeedError,
  FeedReasons,
} from "@openchart/feed";
import {
  HoseConnection,
  HoseRouter,
  type Channel,
  type ChannelHandler,
} from "@openchart/hose";
import { BarColumns, ProviderId } from "@openchart/market";
import { defineDataFrame, toJson, symbols } from "@openchart/timeseries";
import { TRPCClientError } from "@trpc/client";
import { Schema } from "effect";
import { lastValueFrom } from "rxjs";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import type { FeedClient, BarsView } from "@openchart/app/feed";
import {
  FeedTransport,
  feedError,
  offersRetry,
} from "@openchart/app/lib/feed/transport";
import { createTransport } from "@openchart/app/lib/transport/transport";

const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
  from: 0,
  to: "now",
  countBack: 500,
});
const bar = (time: number) => ({
  time,
  open: 1,
  high: 2,
  low: 1,
  close: 2,
  volume: 3,
  asOf: 100,
  final: true,
});
// Declared like a real source, so an empty window still carries its columns.
const NativeBars = defineDataFrame({
  ...BarColumns,
  asOf: Schema.Finite,
  final: Schema.Boolean,
});
const wireFrame = (rows: readonly ReturnType<typeof bar>[]) =>
  toJson(NativeBars.create({ labels: { symbol: "BTCUSDT" }, rows }));
const snapshot = (rows: readonly ReturnType<typeof bar>[]) => ({
  type: "snapshot",
  snapshot: {
    data: wireFrame(rows),
    range: { from: 0, to: 100 },
    hasMoreBefore: false,
  },
});
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});

async function start(handle: ChannelHandler) {
  vi.stubGlobal("WebSocket", WebSocket);
  let httpStarted = false;
  let httpCancelled = false;
  let httpPath: string | undefined;
  const server = createServer((_request, response) => {
    httpStarted = true;
    httpPath = _request.url;
    response.on("close", () => {
      httpCancelled = true;
    });
  });
  const routes = new HoseRouter()
    .route("bars.open", handle)
    .route("bars.capabilities", handle);
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
      routes,
      undefined,
    );
    socket.on("message", (data) => hose.receive(data.toString()));
    socket.on("close", () => hose.dispose());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  const client = new FeedTransport(transport).client();
  cleanup.push(async () => {
    client.close();
    transport.hose.disconnect();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    client,
    sockets,
    http: () => ({
      started: httpStarted,
      cancelled: httpCancelled,
      path: httpPath,
    }),
  };
}

async function watch(client: FeedClient, input = request) {
  const views: BarsView[] = [];
  const errors: unknown[] = [];
  const subscription = client.bars.observe(input).subscribe({
    next: (view) => views.push(view),
    error: (error) => errors.push(error),
  });
  cleanup.push(() => subscription.unsubscribe());
  await vi.waitFor(() => expect(views).toHaveLength(1));
  const view = views[0];
  assert.isDefined(view);
  return { view, subscription, errors };
}

describe("Feed transport", () => {
  it("shares one live channel across subscribers and keeps it open after they leave", async () => {
    const channels: Channel[] = [];
    const stopped = new Set<Channel>();
    const { client, sockets } = await start((_input, channel) => {
      channels.push(channel);
      channel.data(snapshot([bar(1)]));
      return () => {
        stopped.add(channel);
      };
    });
    const first = await watch(client);
    const second = await watch(client);
    expect(second.view).toBe(first.view);
    first.subscription.unsubscribe();
    second.subscription.unsubscribe();
    const again = await watch(client);
    expect(again.view).toBe(first.view);
    const values: number[] = [];
    const errors: unknown[] = [];
    again.view.updates.subscribe({
      next: (batch) => values.push(batch.get(0)!.time),
      error: (error) => errors.push(error),
    });
    channels[0]!.data({ type: "updates", data: wireFrame([bar(2)]) });
    await vi.waitFor(() => expect(values).toEqual([2]));
    expect(channels).toHaveLength(1);
    expect(stopped.size).toBe(0);
    expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
    client.close();
    await vi.waitFor(() => expect(stopped.size).toBe(1));
    expect(errors).toMatchObject([{ _tag: "Client.Cancelled" }]);
  });

  it.each(["empty", "malformed"])(
    "rejects %s capabilities through the generic request boundary",
    async (mode) => {
      const { client, sockets } = await start((_input, opened) => {
        if (mode === "malformed") opened.data({ modes: "not capabilities" });
        opened.done();
      });
      await expect(client.bars.getCapabilities(request)).rejects.toBeInstanceOf(
        ClientFailures.InvalidResponse,
      );
      expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
    },
  );

  it.each(["missing", "updates-first", "duplicate"])(
    "rejects %s snapshots without changing the socket",
    async (mode) => {
      const { client, sockets } = await start((_input, opened) => {
        if (mode === "updates-first")
          opened.data({ type: "updates", data: wireFrame([bar(2)]) });
        if (mode === "duplicate") {
          opened.data(snapshot([]));
          opened.data(snapshot([]));
        }
        opened.done();
      });
      await expect(
        lastValueFrom(client.bars.observe(request)),
      ).rejects.toBeInstanceOf(ClientFailures.InvalidResponse);
      expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
    },
  );

  it("replays every post-snapshot batch independently for delayed subscribers", async () => {
    let channel: Channel | undefined;
    const { client } = await start((_input, opened) => {
      channel = opened;
      opened.data(snapshot([bar(1)]));
      opened.data({ type: "updates", data: wireFrame([bar(2)]) });
    });
    const { view } = await watch(client);
    expect(Array.from(view.data)).toEqual([bar(1)]);
    expect(view.data.labels).toEqual({ symbol: "BTCUSDT" });
    expect(Object.isFrozen(view.data)).toBe(true);
    const first: number[] = [];
    const errors: unknown[] = [];
    const one = view.updates!.subscribe({
      next: (batch) => first.push(...Array.from(batch, (row) => row.time)),
      error: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(first).toEqual([2]));
    one.unsubscribe();
    channel!.data({ type: "updates", data: wireFrame([bar(3)]) });
    const second: number[] = [];
    view.updates!.subscribe({
      next: (batch) => second.push(...Array.from(batch, (row) => row.time)),
      error: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(second).toEqual([2, 3]));
    expect(first).toEqual([2]);
    expect(errors).toEqual([]);
  });

  it("decodes source columns, labels and gaps for both snapshot and live frames", async () => {
    const gap = { ...bar(1), close: NaN };
    const { client } = await start((_input, opened) => {
      opened.data(snapshot([gap]));
      opened.data({ type: "updates", data: wireFrame([{ ...gap, time: 2 }]) });
      opened.done();
    });
    const { view } = await watch(client);
    expect(view.data._dataFrame).toBe(symbols.dataFrame);
    expect(Array.from(view.data)).toEqual([gap]);
    expect(view.data.labels).toEqual({ symbol: "BTCUSDT" });
    const update = await lastValueFrom(view.updates);
    expect(Array.from(update)).toEqual([{ ...gap, time: 2 }]);
    expect(update.labels).toEqual({ symbol: "BTCUSDT" });
    expect(Object.isFrozen(update.get(0))).toBe(true);
  });

  it("rejects malformed Arrow IPC without closing the shared socket", async () => {
    const { client, sockets } = await start((_input, opened) => {
      opened.data({
        type: "snapshot",
        snapshot: {
          data: "not Arrow IPC",
          range: { from: 0, to: 100 },
          hasMoreBefore: false,
        },
      });
      opened.done();
    });
    await expect(
      lastValueFrom(client.bars.observe(request)),
    ).rejects.toBeInstanceOf(ClientFailures.InvalidResponse);
    expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
  });

  it("client close aborts in-flight HTTP and permanently revokes old handles", async () => {
    const { client, http } = await start(() => {});
    const result = client.symbology
      .search({ query: "BTC", limit: 20, indexed: false })
      .catch((error) => error);
    await vi.waitFor(() => expect(http().started).toBe(true));
    expect(http().path?.split("?")[0]).toBe("/trpc/feed.symbology.search");
    client.close();
    expect(await result).toBeInstanceOf(ClientFailures.Cancelled);
    await vi.waitFor(() => expect(http().cancelled).toBe(true));
    await expect(
      client.symbology.search({ query: "BTC", limit: 20, indexed: false }),
    ).rejects.toBeInstanceOf(ClientFailures.Cancelled);
    await expect(
      lastValueFrom(client.bars.observe(request)),
    ).rejects.toBeInstanceOf(ClientFailures.Cancelled);
  });

  it("client close cancels a pending Bars channel before any snapshot", async () => {
    let opened = false;
    let stopped = false;
    const { client } = await start(() => {
      opened = true;
      return () => {
        stopped = true;
      };
    });
    const pending = lastValueFrom(client.bars.observe(request)).catch(
      (error) => error,
    );
    await vi.waitFor(() => expect(opened).toBe(true));
    client.close();
    expect(await pending).toBeInstanceOf(ClientFailures.Cancelled);
    await vi.waitFor(() => expect(stopped).toBe(true));
  });

  it("normal completion preserves replay for late subscribers and leaves the socket usable", async () => {
    let channel: Channel | undefined;
    const { client, sockets } = await start((_input, opened) => {
      channel = opened;
      opened.data(snapshot([bar(1)]));
      opened.data({ type: "updates", data: wireFrame([bar(2)]) });
      opened.done();
    });
    const { view, subscription } = await watch(client);
    for (let i = 0; i < 2; i++) {
      const values: number[] = [];
      const complete = vi.fn();
      const error = vi.fn();
      view.updates!.subscribe({
        next: (batch) => values.push(...Array.from(batch, (row) => row.time)),
        complete,
        error,
      });
      await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
      expect(values).toEqual([2]);
      expect(error).not.toHaveBeenCalled();
    }
    const first = channel;
    const again = await watch(client);
    expect(channel).not.toBe(first);
    expect(sockets.clients.size).toBe(1);
    expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
    again.subscription.unsubscribe();
    subscription.unsubscribe();
  });

  it("a broken socket fails the old Observable without replaying its channel", async () => {
    const { client, sockets } = await start((_input, opened) =>
      opened.data(snapshot([bar(1)])),
    );
    const { view } = await watch(client);
    const errors: unknown[] = [];
    view.updates!.subscribe({ error: (error) => errors.push(error) });
    for (const socket of sockets.clients) socket.terminate();
    await vi.waitFor(() =>
      expect(errors).toMatchObject([{ _tag: "Client.Disconnected" }]),
    );
    const late: unknown[] = [];
    view.updates!.subscribe({ error: (error) => late.push(error) });
    expect(late).toMatchObject([{ _tag: "Client.Disconnected" }]);
  });

  it("overflow fails explicitly before dropping any retained history", async () => {
    let channel: Channel | undefined;
    const { client } = await start((_input, opened) => {
      channel = opened;
      opened.data(snapshot([]));
    });
    const { view } = await watch(client);
    const errors: unknown[] = [];
    view.updates!.subscribe({ error: (error) => errors.push(error) });
    channel!.data({
      type: "updates",
      data: wireFrame(Array.from({ length: 50_001 }, (_, index) => bar(index))),
    });
    await vi.waitFor(() =>
      expect(errors).toMatchObject([
        { reason: { _tag: "Feed.ResyncRequired", provider: "binance" } },
      ]),
    );
    expect(errors[0]).toBeInstanceOf(FeedError);
  });

  it("decodes a Hose failed body into the public FeedError", async () => {
    const reason = new FeedReasons.HistoryUnavailable({
      provider: ProviderId.make("yfinance"),
      availableFrom: 1754006400000,
    });
    const bodies: Record<string, unknown> = {
      public: Schema.encodeSync(FeedError)(new FeedError({ reason })),
      unknown: { _tag: "FeedError", reason: { _tag: "Feed.Gone" } },
      none: undefined,
    };
    const { client, sockets } = await start((input, opened) => {
      const mode = (input as { request: { listing: { symbol: string } } })
        .request.listing.symbol;
      const body = bodies[mode];
      if (body === undefined) opened.error("internal");
      else opened.error("failed", body);
    });
    const failure = (mode: string) =>
      client.bars
        .getCapabilities({
          ...request,
          listing: { ...request.listing, symbol: mode },
        })
        .catch((error: unknown) => error);
    const decoded = await failure("public");
    expect(decoded).toBeInstanceOf(FeedError);
    expect(decoded).toMatchObject({ reason, isRetryable: false });
    expect(await failure("unknown")).toBeInstanceOf(
      ClientFailures.InvalidResponse,
    );
    expect(await failure("none")).toBeInstanceOf(ClientFailures.Internal);
    expect([...sockets.clients][0]!.readyState).toBe(WebSocket.OPEN);
  });
});

describe("feedError over tRPC", () => {
  const response = (data: Record<string, unknown>) =>
    TRPCClientError.from({
      error: { message: "upstream text", code: -32603, data },
    });

  it("decodes data.error into the public FeedError", () => {
    const reason = new FeedReasons.RateLimited({
      provider: ProviderId.make("binance"),
    });
    const failure = feedError(
      response({
        code: "TOO_MANY_REQUESTS",
        error: Schema.encodeSync(FeedError)(new FeedError({ reason })),
      }),
    );
    expect(failure).toBeInstanceOf(FeedError);
    expect(failure).toMatchObject({ reason, isRetryable: true });
  });

  it("classifies responses without a public error, and lost requests", () => {
    expect(
      feedError(response({ code: "INTERNAL_SERVER_ERROR", error: null })),
    ).toBeInstanceOf(ClientFailures.Internal);
    expect(
      feedError(response({ code: "BAD_REQUEST", error: { reason: 1 } })),
    ).toBeInstanceOf(ClientFailures.InvalidResponse);
    expect(
      feedError(TRPCClientError.from(new TypeError("fetch failed"))),
    ).toBeInstanceOf(ClientFailures.Disconnected);
  });
});

it("offers Retry only for retryable failures other than rate limits", () => {
  const provider = ProviderId.make("yfinance");
  expect(offersRetry(new FeedReasons.SourceUnavailable({ provider }))).toBe(
    true,
  );
  expect(
    offersRetry(
      new FeedError({ reason: new FeedReasons.RateLimited({ provider }) }),
    ),
  ).toBe(false);
  expect(offersRetry(new FeedReasons.NotFound({ provider }))).toBe(false);
  expect(offersRetry(new ClientFailures.Disconnected())).toBe(true);
});
