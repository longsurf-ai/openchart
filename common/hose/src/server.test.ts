// Purpose: Verify Node mounting, shared routes, per-connection context, and complete teardown.

import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import WebSocket from "ws";
import { afterEach, expect, test, vi } from "vitest";
import { HoseClient } from "./client";
import type { Channel } from "./connection";
import { encode, parseServer, type ServerMsg } from "./protocol";
import { HoseRouter } from "./router";
import { HoseServer } from "./server";

type Context = { name: string; channels: Channel[]; released: () => void };
// The same definition is mounted on every fixture; runtime values enter only as context.
const router = new HoseRouter<Context>()
  .route("live", (_body, channel, ctx) => {
    ctx.channels.push(channel);
    channel.data(ctx.name);
    return ctx.released;
  })
  .route("once", (_body, channel, ctx) => {
    channel.data(ctx.name);
    channel.done();
    return ctx.released;
  })
  .route("echo", (_body, channel, ctx) => {
    channel.onData((body) => channel.data(body));
    return ctx.released;
  });

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function connect(url: string, options?: WebSocket.ClientOptions) {
  const socket = new WebSocket(url, options);
  const messages: ServerMsg[] = [];
  socket.on("message", (message) =>
    messages.push(parseServer(JSON.parse(message.toString()))),
  );
  const closed = once(socket, "close");
  await once(socket, "open");
  return { socket, messages, closed };
}

async function listen(
  createContext: (request: IncomingMessage) => Context,
  authorize?: (request: IncomingMessage) => boolean,
) {
  const server = createServer((_request, response) =>
    response.end("http alive"),
  );
  const hose = new HoseServer({
    server,
    router,
    path: "/hose",
    createContext,
    authorize,
  });
  cleanup.push(async () => {
    hose.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const url = `ws://127.0.0.1:${address.port}/hose`;
  return { server, hose, url };
}

async function start(createContext: (request: IncomingMessage) => Context) {
  const listening = await listen(createContext);
  return { ...listening, ...(await connect(listening.url)) };
}

test("one router serves independent hosts and creates context once per connection", async () => {
  const a = { name: "first", channels: [] as Channel[], released: vi.fn() };
  const b = { name: "second", channels: [] as Channel[], released: vi.fn() };
  const firstContext = vi.fn<(request: IncomingMessage) => Context>(() => a);
  const first = await start(firstContext);
  const second = await start(() => b);
  first.socket.send(
    encode({ type: "open", id: "live", body: { type: "live" } }),
  );
  first.socket.send(
    encode({ type: "open", id: "once", body: { type: "once" } }),
  );
  first.socket.send(
    encode({ type: "open", id: "missing", body: { type: "missing" } }),
  );
  second.socket.send(
    encode({ type: "open", id: "live", body: { type: "live" } }),
  );
  await vi.waitFor(() => {
    expect(first.messages).toHaveLength(4);
    expect(second.messages).toEqual([
      { type: "data", id: "live", body: "second" },
    ]);
  });
  expect(first.messages).toEqual([
    { type: "data", id: "live", body: "first" },
    { type: "data", id: "once", body: "first" },
    { type: "done", id: "once" },
    { type: "error", id: "missing", code: "not_found" },
  ]);
  expect(firstContext).toHaveBeenCalledOnce();
  expect(firstContext.mock.calls[0]?.[0].url).toBe("/hose");
  expect(a.released).toHaveBeenCalledOnce();
  first.hose.dispose();
  await first.closed;
  expect(a.released).toHaveBeenCalledTimes(2);
  expect(first.server.listenerCount("upgrade")).toBe(0);
  expect(first.server.listening).toBe(true);
  const response = await fetch(first.url.replace("ws:", "http:"));
  expect(await response.text()).toBe("http alive");
  b.channels[0]!.data("still live");
  await vi.waitFor(() =>
    expect(second.messages.at(-1)).toEqual({
      type: "data",
      id: "live",
      body: "still live",
    }),
  );
  second.socket.send(encode({ type: "close", id: "live" }));
  await vi.waitFor(() => expect(b.released).toHaveBeenCalledOnce());
  second.hose.dispose();
  await second.closed;
  expect(b.released).toHaveBeenCalledOnce();
});

test.each(["binary", "malformed"])(
  "rejects %s protocol input and releases channel work",
  async (kind) => {
    const released = vi.fn();
    const fixture = await start(() => ({
      name: "test",
      channels: [],
      released,
    }));
    fixture.socket.send(
      encode({ type: "open", id: "live", body: { type: "live" } }),
    );
    await vi.waitFor(() => expect(fixture.messages).toHaveLength(1));
    fixture.socket.send(kind === "binary" ? Buffer.from("binary") : "{");
    const [code] = await fixture.closed;
    expect(code).toBe(1002);
    expect(released).toHaveBeenCalledOnce();
    const next = await connect(fixture.url);
    next.socket.send(
      encode({ type: "open", id: "new", body: { type: "once" } }),
    );
    await vi.waitFor(() => expect(next.messages).toHaveLength(2));
  },
);

test("authorize answers 401 before any context or connection exists", async () => {
  const createContext = vi.fn<(request: IncomingMessage) => Context>(() => ({
    name: "authorized",
    channels: [],
    released: vi.fn(),
  }));
  const fixture = await listen(
    createContext,
    (request) => request.headers.authorization === "Bearer secret",
  );
  const rejected = new WebSocket(fixture.url);
  const [, response] = await once(rejected, "unexpected-response");
  expect(response.statusCode).toBe(401);
  expect(createContext).not.toHaveBeenCalled();
  const accepted = await connect(fixture.url, {
    headers: { authorization: "Bearer secret" },
  });
  accepted.socket.send(
    encode({ type: "open", id: "once", body: { type: "once" } }),
  );
  await vi.waitFor(() => expect(accepted.messages).toHaveLength(2));
  expect(accepted.messages).toEqual([
    { type: "data", id: "once", body: "authorized" },
    { type: "done", id: "once" },
  ]);
  expect(createContext).toHaveBeenCalledOnce();
});

test("context failure closes only its socket without leaking the cause", async () => {
  const fixture = await start(() => {
    throw new Error("private credential");
  });
  const [code, reason] = await fixture.closed;
  expect(code).toBe(1011);
  expect(String(reason)).toBe("context_failed");
  expect(fixture.messages).toEqual([]);
  expect(fixture.server.listening).toBe(true);
});

test("disposal releases all connections even when one teardown fails", async () => {
  let opened = 0;
  const released: number[] = [];
  const fixture = await start(() => {
    const id = ++opened;
    return {
      name: String(id),
      channels: [],
      released: () => {
        released.push(id);
        if (id === 1) throw new Error("teardown failed");
      },
    };
  });
  const second = await connect(fixture.url);
  for (const client of [fixture, second]) {
    client.socket.send(
      encode({ type: "open", id: "live", body: { type: "live" } }),
    );
  }
  await vi.waitFor(() => {
    expect(fixture.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);
  });
  expect(() => fixture.hose.dispose()).toThrow("teardown failed");
  await Promise.all([fixture.closed, second.closed]);
  expect(released).toEqual([1, 2]);
  expect(fixture.server.listenerCount("upgrade")).toBe(0);
  fixture.hose.dispose();
  expect(released).toEqual([1, 2]);
});

test("a duplex channel echoes client sends, including those queued before open", async () => {
  const released = vi.fn();
  const fixture = await listen(() => ({
    name: "test",
    channels: [],
    released,
  }));
  const client = new HoseClient(fixture.url);
  cleanup.push(() => Promise.resolve(client.disconnect()));
  const received: unknown[] = [];
  const ended = vi.fn();
  const channel = client.openChannel(
    { type: "echo" },
    { data: (body) => received.push(body), error: ended, done: ended },
  );
  // The socket is still connecting: these wait behind the open message.
  channel.send("queued");
  channel.send({ n: 2 });
  await vi.waitFor(() => expect(received).toEqual(["queued", { n: 2 }]));
  channel.send("after open");
  await vi.waitFor(() => expect(received).toHaveLength(3));
  expect(received[2]).toBe("after open");
  channel.close();
  await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
  expect(() => channel.send("late")).toThrow("is closed");
  expect(ended).not.toHaveBeenCalled();
});

test("an oversize inbound frame closes the socket with 1009 and releases channel work", async () => {
  const released = vi.fn();
  const fixture = await start(() => ({ name: "test", channels: [], released }));
  fixture.socket.send(
    encode({ type: "open", id: "echo", body: { type: "echo" } }),
  );
  const body = "x".repeat(1024 * 1024 - 64);
  fixture.socket.send(encode({ type: "data", id: "echo", body }));
  await vi.waitFor(() =>
    expect(fixture.messages).toEqual([{ type: "data", id: "echo", body }]),
  );
  fixture.socket.send(
    encode({ type: "data", id: "echo", body: "x".repeat(1024 * 1024) }),
  );
  const [code] = await fixture.closed;
  expect(code).toBe(1009);
  // The server observes the close after the client does.
  await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
  expect(fixture.messages).toHaveLength(1);
});
