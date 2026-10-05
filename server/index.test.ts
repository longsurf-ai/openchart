// Purpose: Locks server composition against incomplete Dataset providers.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { createTRPCClient, httpSubscriptionLink } from "@trpc/client";
import { ConfigProvider, Effect, Fiber, Schema, Stream } from "effect";
import { EventSource } from "eventsource";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import WebSocket from "ws";
import type { Context } from "./context";

import { makeRuntime } from "./runtime";
import { EventDefinition, Events } from "./events/index";
import { createServer, hoseRouter, router } from "./index";

const RuntimeProbe = EventDefinition.define({
  type: "test.runtime-probe",
  schema: { message: Schema.String },
});

test("creates a host with unavailable feeds instead of requiring all providers", async () => {
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  await server.shutdown();
});

test("shared Hose definitions get distinct runtimes and shutdown closes live sockets", async () => {
  const contexts: Context[] = [];
  const stopped = vi.fn();
  const dispatch = vi
    .spyOn(hoseRouter, "handle")
    .mockImplementation((_body, channel, ctx) => {
      contexts.push(ctx);
      channel.data("ready");
      return stopped;
    });
  const first = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const second = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const sockets: WebSocket[] = [];
  try {
    for (const server of [first, second]) {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test port");
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/hose`);
      sockets.push(socket);
      await once(socket, "open");
      socket.send(
        JSON.stringify({ type: "open", id: "one", body: { type: "probe" } }),
      );
      await once(socket, "message");
    }
    expect(contexts).toHaveLength(2);
    expect(contexts[0]!.runtime).not.toBe(contexts[1]!.runtime);
    const disposed = vi.spyOn(contexts[0]!.runtime, "dispose");
    const closed = once(sockets[0]!, "close");
    await first.shutdown();
    await closed;
    expect(stopped).toHaveBeenCalledOnce();
    expect(disposed).toHaveBeenCalledOnce();
    sockets[1]!.send(
      JSON.stringify({ type: "open", id: "two", body: { type: "probe" } }),
    );
    await once(sockets[1]!, "message");
    expect(contexts[2]).toBe(contexts[1]);
    expect(await contexts[1]!.runtime.runPromise(Effect.succeed("alive"))).toBe(
      "alive",
    );
  } finally {
    await first.shutdown();
    await second.shutdown();
    dispatch.mockRestore();
  }
  expect(stopped).toHaveBeenCalledTimes(3);
});

test("runs the echo tRPC procedure through the managed Effect runtime", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  try {
    const caller = router.createCaller({ runtime });
    await expect(caller.echo({ message: "hello" })).resolves.toEqual({
      message: "hello",
    });
  } finally {
    await runtime.dispose();
  }
});

test("provides one shared Events service through the managed runtime", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  try {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Events.Service;
        const live = yield* events.allBounded(256);
        const received = yield* live.pipe(
          Stream.filter((event) => event.type === RuntimeProbe.type),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const sent = yield* events.publish(RuntimeProbe, { message: "hello" });
        return { sent, received: Array.from(yield* Fiber.join(received)) };
      }),
    );

    const result = await runtime.runPromise(program);
    expect(result.received).toEqual([result.sent]);
  } finally {
    await runtime.dispose();
  }
});

test("initializes the application before returning an unbound server", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "openchart-server-start-"));
  const home = path.join(directory, "profile");
  const databasePath = path.join(home, "openchart.sqlite3");
  try {
    const server = await createServer({ home });
    try {
      expect(server.listening).toBe(false);
      expect(existsSync(databasePath)).toBe(true);
    } finally {
      await server.shutdown();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const access = { token: "per-run-secret", origin: "openchart://app" };
const bearer = { authorization: `Bearer ${access.token}` };
const origin = { origin: access.origin };

async function listenWithAccess() {
  const server = await createServer(
    {
      home: temporaryHome(),
      databasePath: ":memory:",
      config: ConfigProvider.fromUnknown({}),
    },
    { access },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  return { server, port: address.port, host: `127.0.0.1:${address.port}` };
}

// node:http, not fetch: fetch cannot forge the Host header.
function send(url: string, headers: Record<string, string>, method = "GET") {
  return new Promise<IncomingMessage>((resolve, reject) => {
    httpRequest(url, { method, headers }, (response) => {
      response.resume();
      resolve(response);
    })
      .on("error", reject)
      .end();
  });
}

test("access answers 401 unless Host, Origin, and token all match", async () => {
  const { server, port, host } = await listenWithAccess();
  try {
    const echo = `http://${host}/trpc/echo?input=${encodeURIComponent(
      JSON.stringify({ message: "hi" }),
    )}`;
    expect((await send(echo, origin)).statusCode).toBe(401);
    expect(
      (
        await send(echo, {
          ...origin,
          authorization: `Bearer ${"x".repeat(access.token.length)}`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await send(echo, { ...bearer, origin: "http://evil.example" }))
        .statusCode,
    ).toBe(401);
    expect(
      (await send(echo, { ...bearer, ...origin, host: `localhost:${port}` }))
        .statusCode,
    ).toBe(401);
    const accepted = await send(echo, { ...bearer, ...origin });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["access-control-allow-origin"]).toBe(access.origin);
    expect(accepted.headers.vary).toContain("Origin");
    const missing = await send(`http://${host}/missing`, {
      ...bearer,
      ...origin,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers.vary).toBe("Origin");
    const preflight = await send(echo, origin, "OPTIONS");
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers).toMatchObject({
      "access-control-allow-origin": access.origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      vary: "Origin",
    });
  } finally {
    await server.shutdown();
  }
});

test("malformed request targets reject without stopping the backend", async () => {
  const { server, host } = await listenWithAccess();
  try {
    const malformed = `http://${host}//[`;
    expect((await send(malformed, origin)).statusCode).toBe(401);
    expect((await send(malformed, { ...bearer, ...origin })).statusCode).toBe(
      401,
    );
    expect((await send(malformed, origin, "OPTIONS")).statusCode).toBe(401);
    expect(
      (
        await send(malformed, {
          ...origin,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        })
      ).statusCode,
    ).toBe(400);
    const echo = `http://${host}/trpc/echo?input=${encodeURIComponent(
      JSON.stringify({ message: "still alive" }),
    )}`;
    expect((await send(echo, { ...bearer, ...origin })).statusCode).toBe(200);
  } finally {
    await server.shutdown();
  }
});

test("events.subscribe streams over SSE with the bearer token", async () => {
  const { server, host } = await listenWithAccess();
  const client = createTRPCClient<typeof router>({
    links: [
      httpSubscriptionLink({
        url: `http://${host}/trpc`,
        EventSource,
        eventSourceOptions: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              headers: { ...init.headers, ...bearer, ...origin },
            }),
        },
      }),
    ],
  });
  const frames: unknown[] = [];
  const failures: unknown[] = [];
  const subscription = client.events.subscribe.subscribe(undefined, {
    onData: (frame) => frames.push(frame),
    onError: (error) => failures.push(error),
  });
  try {
    await expect.poll(() => frames[0]).toEqual({ kind: "ready" });
    expect(failures).toEqual([]);
  } finally {
    subscription.unsubscribe();
    await server.shutdown();
  }
});

test("Hose upgrade needs the query token, trusted Origin, and bound Host", async () => {
  const { server, host, port } = await listenWithAccess();
  const dispatch = vi
    .spyOn(hoseRouter, "handle")
    .mockImplementation((_body, channel) => {
      channel.data("routed");
      channel.done();
      return () => {};
    });
  try {
    const endpoint = `ws://${host}/hose`;
    const authorized = `${endpoint}?token=${access.token}`;
    const cases: Array<[string, WebSocket.ClientOptions]> = [
      [endpoint, origin],
      [`${endpoint}?token=${"x".repeat(access.token.length)}`, origin],
      [authorized, { origin: "http://evil.example" }],
      [authorized, { ...origin, headers: { host: `localhost:${port}` } }],
    ];
    for (const [url, options] of cases) {
      const rejected = new WebSocket(url, options);
      rejected.on("error", () => {});
      const closed = new Promise<void>((resolve) =>
        rejected.once("close", () => resolve()),
      );
      try {
        const [, response] = await once(rejected, "unexpected-response");
        expect(response.statusCode).toBe(401);
      } finally {
        rejected.terminate();
        await closed;
      }
    }
    expect(dispatch).not.toHaveBeenCalled();
    const socket = new WebSocket(authorized, origin);
    await once(socket, "open");
    socket.send(
      JSON.stringify({ type: "open", id: "one", body: { type: "probe" } }),
    );
    const [message] = await once(socket, "message");
    expect(JSON.parse(String(message))).toEqual({
      type: "data",
      id: "one",
      body: "routed",
    });
    expect(dispatch).toHaveBeenCalledOnce();
  } finally {
    dispatch.mockRestore();
    await server.shutdown();
  }
});
