// Purpose: Verify authenticated REST/WebSocket I/O, cancellation, buffering and retirement.
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { Credential } from "@openchart/server/access/credential";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { Integration } from "@openchart/server/access/integration";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { layer as integrationLayer } from "@openchart/server/access/integration/layer";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import {
  ConfigProvider,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import { WebSocketServer, type VerifyClientCallbackAsync } from "ws";
import type { BarsSubscription } from "./contract";
import { OpenChartClient, layer } from "./client";
import { openchartError } from "./errors";
import {
  arrow,
  bar,
  listing,
  calendarResponse,
  capabilities,
  series,
  pageRequest,
} from "./client.test-utils";

const initialEvent = { type: "bar", bar: bar(1000) } as const;
const wireEvent = {
  ...initialEvent,
  id: "1",
  listing: series.listing,
  resolution: series.resolution,
};
async function fixture(timeout = "2 seconds", handshakeStatus?: number) {
  const source = {
    getAccessToken: vi.fn(async (signal: AbortSignal, key: string) => {
      signal.throwIfAborted();
      return key;
    }),
  };
  const headers: Array<string | undefined> = [];
  const sockets: Array<string | undefined> = [];
  const queries: URL[] = [];
  const commands: Array<{
    type: string;
    id: string;
    series?: BarsSubscription;
  }> = [];
  const operation = vi.fn(async (url: URL): Promise<unknown> =>
    url.pathname === "/marketfeed/capabilities"
      ? capabilities
      : { results: [] },
  );
  let contentType: string | undefined;
  let initialFrame = JSON.stringify(wireEvent);
  let aborted = 0;
  let acknowledge = true;
  const server = createServer((req, res) => {
    headers.push(req.headers.authorization);
    res.on("close", () => {
      if (!res.writableEnded) aborted += 1;
    });
    const url = new URL(req.url!, "http://localhost");
    queries.push(url);
    void operation(url).then((body) => {
      res.statusCode = status;
      res.setHeader(
        "Content-Type",
        contentType ??
          (body instanceof Uint8Array
            ? "application/vnd.apache.arrow.stream"
            : "application/json"),
      );
      res.end(
        body instanceof Uint8Array || typeof body === "string"
          ? body
          : JSON.stringify(body),
      );
    });
  });
  let status = 200;
  const verifyClient = vi.fn<VerifyClientCallbackAsync>((_, done) =>
    handshakeStatus ? done(false, handshakeStatus) : done(true),
  );
  const ws = new WebSocketServer({
    server,
    path: "/marketfeed/live",
    verifyClient,
  });
  ws.on("connection", (socket, req) => {
    sockets.push(req.headers.authorization);
    queries.push(new URL(req.url!, "http://localhost"));
    socket.on("message", (data) => {
      const command = JSON.parse(data.toString());
      commands.push(command);
      if (command.type === "unsubscribe") {
        socket.send(JSON.stringify({ type: "unsubscribed", id: command.id }));
        return;
      }
      if (command.type !== "subscribe") return;
      if (acknowledge)
        socket.send(JSON.stringify({ type: "subscribed", id: command.id }));
      try {
        const event = JSON.parse(initialFrame);
        socket.send(
          JSON.stringify({
            ...event,
            ...(initialFrame === JSON.stringify(wireEvent)
              ? {
                  listing: command.series.listing,
                  resolution: command.series.resolution,
                }
              : {}),
            id: command.id,
          }),
        );
      } catch {
        socket.send(initialFrame);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const runtime = ManagedRuntime.make(
    layer().pipe(
      Layer.provideMerge(
        integrationLayer({ methods: [OPENCHART_CLOUD] }).pipe(
          Layer.provideMerge(Credential.layer(jweEncryption(randomBytes(32)))),
          Layer.provideMerge(Database.layer(":memory:", () => Effect.void)),
          // Events belongs to Integration; OpenChartClient must build without it.
          Layer.provide(Events.layer),
        ),
      ),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            openchart: {
              baseUrl: `http://127.0.0.1:${address.port}`,
              requestTimeout: timeout,
            },
          }),
        ),
      ),
    ),
  );
  const client = await runtime.runPromise(OpenChartClient);
  const integrations = await runtime.runPromise(Integration.Service);
  await runtime.runPromise(
    integrations.connection.setApiKey({
      integrationID: OPENCHART_CLOUD.integrationID,
      key: "token-a",
    }),
  );
  // Exercise the real Integration read while allowing acquisition cancellation/delay tests.
  const resolve = integrations.connection.resolveCredential;
  vi.spyOn(integrations.connection, "resolveCredential").mockImplementation(
    (id) =>
      Effect.gen(function* () {
        const stored = yield* resolve(id);
        if (stored?.type !== "key") return stored;
        const key = yield* Effect.promise((signal) =>
          source.getAccessToken(signal, stored.key),
        );
        return { ...stored, key };
      }),
  );
  const update = async (key: string | undefined) => {
    await runtime.runPromise(
      Effect.gen(function* () {
        if (key === undefined) {
          yield* integrations.connection.disconnect(
            OPENCHART_CLOUD.integrationID,
          );
        } else {
          yield* integrations.connection.setApiKey({
            integrationID: OPENCHART_CLOUD.integrationID,
            key,
          });
        }
        yield* client.reset();
      }),
    );
  };
  return {
    runtime,
    client,
    source,
    update,
    headers,
    sockets,
    operation,
    ws,
    verifyClient,
    queries,
    commands,
    setContentType: (value: string) => {
      contentType = value;
    },
    setAcknowledge: (value: boolean) => {
      acknowledge = value;
    },
    setInitialFrame: (value: string) => {
      initialFrame = value;
    },
    setStatus: (value: number) => {
      status = value;
    },
    aborted: () => aborted,
    close: async () => {
      await runtime.dispose();
      for (const socket of ws.clients) socket.terminate();
      for (const [info] of verifyClient.mock.calls) info.req.socket.destroy();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("REST uses fresh credentials and preserves parameters", async () => {
  const f = await fixture();
  try {
    f.operation.mockImplementation(async (url) => ({
      results: [{ ...listing, symbol: url.searchParams.get("query") }],
    }));
    expect(
      await f.runtime.runPromise(
        f.client.searchListings({ query: "BTC USD", limit: 20 }),
      ),
    ).toEqual([{ ...listing, symbol: "BTC USD" }]);
    expect(f.queries[0]!.pathname).toBe("/symbology/search");
    expect(Object.fromEntries(f.queries[0]!.searchParams)).toEqual({
      query: "BTC USD",
      limit: "20",
    });
    await f.update("token-b");
    await f.runtime.runPromise(f.client.searchListings({ query: "AAPL" }));
    expect(f.headers).toEqual(["Bearer token-a", "Bearer token-b"]);
  } finally {
    await f.close();
  }
});
test.each([401, 403, 422, 429, 503])(
  "REST preserves status %i",
  async (status) => {
    const f = await fixture();
    try {
      f.setStatus(status);
      await expect(
        f.runtime.runPromise(f.client.getCapabilities()),
      ).rejects.toMatchObject({ _tag: "OpenChartRejected", status });
    } finally {
      await f.close();
    }
  },
);
test("capabilities expose validated service limits without encoding metadata", async () => {
  const f = await fixture();
  try {
    const value = await f.runtime.runPromise(f.client.getCapabilities());
    expect(value).toEqual({
      resolutions: capabilities.resolutions,
      historyAdjustments: capabilities.historyAdjustments,
      liveAdjustments: capabilities.liveAdjustments,
      adjustedLiveResolutions: capabilities.adjustedLiveResolutions,
      sessions: capabilities.sessions,
      maxHistoryRows: 10000,
      maxConnectionSeconds: 900,
    });
    f.operation.mockResolvedValue({
      ...capabilities,
      liveTimeUnit: "nanoseconds",
    });
    await expect(
      f.runtime.runPromise(f.client.getCapabilities()),
    ).rejects.toMatchObject({ _tag: "OpenChartInvalidResponse" });
  } finally {
    await f.close();
  }
});
test.each([
  "{invalid json",
  { results: [{ symbol: "AAPL" }] },
  { results: null },
])(
  "search rejects malformed responses at the client boundary: %j",
  async (response) => {
    const f = await fixture();
    try {
      f.operation.mockResolvedValue(response);
      await expect(
        f.runtime.runPromise(f.client.searchListings({ query: "AAPL" })),
      ).rejects.toMatchObject({ _tag: "OpenChartInvalidResponse" });
    } finally {
      await f.close();
    }
  },
);
test("calendar reads a listing's stored rows and rejects broken references", async () => {
  const f = await fixture();
  try {
    f.operation.mockResolvedValue(calendarResponse);
    expect(await f.runtime.runPromise(f.client.readCalendar(10244))).toEqual(
      calendarResponse,
    );
    expect(f.queries[0]!.pathname).toBe("/calendar");
    expect(Object.fromEntries(f.queries[0]!.searchParams)).toEqual({
      listing: "10244",
    });
    for (const body of [
      { ...calendarResponse, calendar: "" },
      { ...calendarResponse, calendar: "NASDAQ" },
      {
        ...calendarResponse,
        calendars: calendarResponse.calendars.slice(0, 1),
      },
      {
        ...calendarResponse,
        rules: [{ ...calendarResponse.rules[0], crossesMidnight: 0 }],
      },
      {
        ...calendarResponse,
        rules: [...calendarResponse.rules, calendarResponse.rules[0]],
      },
      {
        ...calendarResponse,
        overrides: [
          ...calendarResponse.overrides,
          { ...calendarResponse.overrides[1], date: "2026-11-26" },
        ],
      },
    ]) {
      f.operation.mockResolvedValue(body);
      await expect(
        f.runtime.runPromise(f.client.readCalendar(10244)),
      ).rejects.toMatchObject({ _tag: "OpenChartInvalidResponse" });
    }
  } finally {
    await f.close();
  }
});
test("history returns decoded observations and serializes typed page parameters", async () => {
  const f = await fixture();
  try {
    f.operation.mockResolvedValue(arrow([bar(1000, 123.456)]));
    expect(
      await f.runtime.runPromise(f.client.readBarsPage(pageRequest)),
    ).toEqual([bar(1000, 123.456)]);
    expect(f.queries[0]!.pathname).toBe("/marketfeed/bars.arrow");
    expect(Object.fromEntries(f.queries[0]!.searchParams)).toEqual({
      listing: String(series.listing),
      resolution: "1m",
      adjustment: "raw",
      session: "regular",
      start: "0",
      end: "2000",
      limit: "10",
      order: "asc",
    });
    f.operation.mockResolvedValue(arrow([]));
    expect(
      await f.runtime.runPromise(f.client.readBarsPage(pageRequest)),
    ).toEqual([]);
  } finally {
    await f.close();
  }
});
test.each([
  { name: "truncated Arrow", body: arrow([bar(1000)]).slice(0, -8) },
  { name: "another listing", body: arrow([bar(1000)], 99) },
  { name: "invalid volume", body: arrow([{ ...bar(1000), volume: -1 }]) },
  {
    name: "wrong content type",
    body: arrow([bar(1000)]),
    contentType: "application/json",
  },
])(
  "history rejects $name without exposing partial data",
  async ({ body, contentType }) => {
    const f = await fixture();
    try {
      f.operation.mockResolvedValue(body);
      if (contentType) f.setContentType(contentType);
      await expect(
        f.runtime.runPromise(f.client.readBarsPage(pageRequest)),
      ).rejects.toMatchObject({ _tag: "OpenChartInvalidResponse" });
    } finally {
      await f.close();
    }
  },
);
test.each([
  "{invalid json",
  JSON.stringify({ ...wireEvent, listing: 99 }),
  JSON.stringify({ ...wireEvent, resolution: "1d" }),
  JSON.stringify({ ...wireEvent, bar: { ...bar(1000), close: null } }),
  JSON.stringify({ type: "error", id: "1", code: "unknown" }),
  JSON.stringify({ type: "unsubscribed", id: "1" }),
])(
  "live rejects invalid or mismatched frames inside the client: %s",
  async (frame) => {
    const f = await fixture();
    try {
      f.setInitialFrame(frame);
      await expect(
        f.runtime.runPromise(
          f.client.subscribeBars(series).pipe(
            Effect.flatMap((updates) =>
              updates.pipe(Stream.take(1), Stream.runCollect),
            ),
            Effect.scoped,
          ),
        ),
      ).rejects.toMatchObject({ _tag: "OpenChartInvalidResponse" });
    } finally {
      await f.close();
    }
  },
);
test("live exposes typed heartbeat activity and hides subscription identity fields", async () => {
  const f = await fixture();
  try {
    f.setInitialFrame(JSON.stringify({ type: "heartbeat" }));
    await f.runtime.runPromise(
      Effect.gen(function* () {
        const updates = yield* f.client.subscribeBars(series);
        for (const socket of f.ws.clients)
          socket.send(JSON.stringify(wireEvent));
        expect(yield* updates.pipe(Stream.take(2), Stream.runCollect)).toEqual([
          { type: "heartbeat" },
          initialEvent,
        ]);
      }).pipe(Effect.scoped),
    );
  } finally {
    await f.close();
  }
});
test.each(["REST", "WebSocket"] as const)(
  "%s timeout includes credential acquisition and cancels it",
  async (method) => {
    const f = await fixture("50 millis");
    let aborted = false;
    try {
      f.source.getAccessToken.mockImplementation(
        (signal) =>
          new Promise(() => {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
          }),
      );
      await expect(
        f.runtime.runPromise(
          (method === "REST"
            ? f.client.getCapabilities().pipe(Effect.asVoid)
            : f.client.subscribeBars(series).pipe(Effect.asVoid)
          ).pipe(Effect.scoped),
        ),
      ).rejects.toMatchObject({ _tag: "OpenChartTimeout" });
      expect(aborted).toBe(true);
      expect(f.headers).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);
test("socket deadline covers credentials and handshake and releases a timed-out connection", async () => {
  const f = await fixture();
  const credential = Deferred.makeUnsafe<string>();
  f.source.getAccessToken.mockImplementation((signal) =>
    f.runtime.runPromise(Deferred.await(credential), { signal }),
  );
  f.verifyClient.mockImplementation(({ req }) => {
    req.socket.resume();
  });
  try {
    await f.runtime.runPromise(
      Effect.gen(function* () {
        const pending = yield* f.client
          .subscribeBars(series)
          .pipe(Effect.result, Effect.forkScoped);
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(f.source.getAccessToken).toHaveBeenCalledOnce(),
          ),
        );
        yield* TestClock.adjust("1500 millis");
        yield* Deferred.succeed(credential, "token-a");
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(f.verifyClient).toHaveBeenCalledOnce()),
        );
        const socket = f.verifyClient.mock.calls[0]![0].req.socket;
        yield* TestClock.adjust("500 millis");
        expect(yield* Fiber.join(pending)).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "OpenChartTimeout" },
        });
        // The caller's scope is still open: failed acquisition must clean up now.
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(socket.readableEnded).toBe(true)),
        );
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
  } finally {
    await f.close();
  }
});
test("socket deadline ends after acquisition while the caller owns the connection", async () => {
  const f = await fixture();
  try {
    await f.runtime.runPromise(
      Effect.gen(function* () {
        const updates = yield* f.client.subscribeBars(series);
        yield* TestClock.adjust("3 seconds");
        for (const socket of f.ws.clients)
          socket.send(JSON.stringify({ ...wireEvent, bar: bar(2000) }));
        expect(yield* updates.pipe(Stream.take(2), Stream.runCollect)).toEqual([
          initialEvent,
          { type: "bar", bar: bar(2000) },
        ]);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
  } finally {
    await f.close();
  }
});
test("timeout cancels pending HTTP", async () => {
  const f = await fixture("100 millis");
  try {
    f.operation.mockImplementation(() => new Promise(() => {}));
    await expect(
      f.runtime.runPromise(f.client.getCapabilities()),
    ).rejects.toMatchObject({ _tag: "OpenChartTimeout" });
    await vi.waitFor(() => expect(f.aborted()).toBe(1));
  } finally {
    await f.close();
  }
});
test("socket buffers before history and retirement drains accepted updates", async () => {
  const f = await fixture();
  try {
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const retired = yield* Deferred.make<void>();
          const updates = yield* f.client.subscribeBars(series, retired);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(f.sockets).toEqual(["Bearer token-a"])),
          );
          yield* Effect.sleep("20 millis");
          yield* Deferred.succeed(retired, undefined);
          expect(yield* Stream.runCollect(updates)).toEqual([initialEvent]);
        }),
      ),
    );
    await vi.waitFor(() => expect(f.ws.clients.size).toBe(0));
  } finally {
    await f.close();
  }
});
test("account reset invalidates already buffered values", async () => {
  const f = await fixture();
  try {
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* f.client.subscribeBars(series);
          yield* Effect.sleep("20 millis");
          yield* f.client.reset();
          const result = yield* Stream.runCollect(updates).pipe(Effect.result);
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { reason: "changed" },
          });
        }),
      ),
    );
  } finally {
    await f.close();
  }
});
test("overflow fails rather than silently losing bars", async () => {
  const f = await fixture();
  try {
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* f.client.subscribeBars(series);
          for (const socket of f.ws.clients)
            for (let i = 0; i < 300; i++)
              socket.send(JSON.stringify(wireEvent));
          yield* Effect.sleep("50 millis");
          const result = yield* Stream.runCollect(updates).pipe(Effect.result);
          expect(result._tag).toBe("Failure");
        }),
      ),
    );
  } finally {
    await f.close();
  }
});
test.each([401, 403])(
  "socket rejects handshake %i without hanging",
  async (status) => {
    const f = await fixture("1 second", status);
    try {
      await expect(
        f.runtime.runPromise(
          f.client.subscribeBars(series).pipe(Effect.scoped),
        ),
      ).rejects.toMatchObject({ _tag: "OpenChartRejected", status });
    } finally {
      await f.close();
    }
  },
);
test.each([1012, 1013, 1000])(
  "socket close %i preserves the server renewal signal",
  async (code) => {
    const f = await fixture();
    try {
      await f.runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const updates = yield* f.client.subscribeBars(series);
            for (const socket of f.ws.clients) socket.close(code);
            const outcome = yield* Stream.runDrain(updates).pipe(Effect.result);
            expect(outcome).toMatchObject({
              _tag: "Failure",
              failure: {
                _tag:
                  code === 1000
                    ? "OpenChartUnavailable"
                    : "OpenChartResyncRequired",
              },
            });
          }),
        ),
      );
    } finally {
      await f.close();
    }
  },
);
test("caller scope closes socket even before stream consumption", async () => {
  const f = await fixture();
  try {
    const scope = await f.runtime.runPromise(Scope.make());
    await f.runtime.runPromise(
      f.client.subscribeBars(series).pipe(Scope.provide(scope)),
    );
    await f.runtime.runPromise(Scope.close(scope, Exit.void));
    await vi.waitFor(() => expect(f.ws.clients.size).toBe(0));
  } finally {
    await f.close();
  }
});

test("concurrent consumers share one socket and one subscription per complete series", async () => {
  const f = await fixture();
  const scopes = await Promise.all(
    Array.from({ length: 30 }, () => f.runtime.runPromise(Scope.make())),
  );
  try {
    const streams = await Promise.all(
      scopes.map((scope, index) =>
        f.runtime.runPromise(
          f.client
            .subscribeBars({
              ...series,
              session: index % 2 ? "extended" : "regular",
            })
            .pipe(Scope.provide(scope)),
        ),
      ),
    );
    expect(f.sockets).toHaveLength(1);
    expect(f.commands.filter((c) => c.type === "subscribe")).toHaveLength(2);
    expect(
      f.queries
        .filter((url) => url.pathname.endsWith("live"))
        .map((url) => url.search),
    ).toEqual([""]);
    // No cached finalized bar is replayed to late consumers.
    await f.runtime.runPromise(
      streams[0]!.pipe(Stream.take(1), Stream.runCollect),
    );
    const lateScope = await f.runtime.runPromise(Scope.make());
    scopes.push(lateScope);
    const lateStream = await f.runtime.runPromise(
      f.client.subscribeBars(series).pipe(Scope.provide(lateScope)),
    );
    const late = f.runtime.runPromise(
      lateStream.pipe(Stream.take(1), Stream.runCollect),
    );
    const id = f.commands.find((c) => c.series?.session === "regular")!.id;
    for (const socket of f.ws.clients)
      socket.send(
        JSON.stringify({ ...wireEvent, id, bar: bar(2000, 120, false) }),
      );
    expect(await late).toEqual([{ type: "bar", bar: bar(2000, 120, false) }]);
    await f.runtime.runPromise(Scope.close(lateScope, Exit.void));
    await Promise.all(
      scopes
        .slice(0, 28)
        .map((scope) => f.runtime.runPromise(Scope.close(scope, Exit.void))),
    );
    expect(f.commands.filter((c) => c.type === "unsubscribe")).toHaveLength(0);
    await f.runtime.runPromise(Scope.close(scopes[28]!, Exit.void));
    await vi.waitFor(() =>
      expect(f.commands.filter((c) => c.type === "unsubscribe")).toHaveLength(
        1,
      ),
    );
    expect(f.ws.clients.size).toBe(1);
    await f.runtime.runPromise(Scope.close(scopes[29]!, Exit.void));
    await vi.waitFor(() => expect(f.ws.clients.size).toBe(0));
  } finally {
    await Promise.all(
      scopes.map((scope) =>
        f.runtime.runPromise(Scope.close(scope, Exit.void)),
      ),
    );
    await f.close();
  }
});
test("retiring a 1s subscription keeps 5m consumers and another listing live", async () => {
  const f = await fixture();
  const scopes = await Promise.all(
    Array.from({ length: 4 }, () => f.runtime.runPromise(Scope.make())),
  );
  const queries = [
    { ...series, resolution: "1s" },
    { ...series, resolution: "5m" },
    { ...series, resolution: "5m" },
    { ...series, listing: 99, resolution: "1d" },
  ] as const;
  try {
    const streams = [];
    for (const [index, query] of queries.entries())
      streams.push(
        await f.runtime.runPromise(
          f.client.subscribeBars(query).pipe(Scope.provide(scopes[index]!)),
        ),
      );
    expect(f.commands.filter((c) => c.type === "subscribe")).toHaveLength(3);
    await f.runtime.runPromise(Scope.close(scopes[0]!, Exit.void));
    await vi.waitFor(() =>
      expect(f.commands).toContainEqual({
        type: "unsubscribe",
        id: f.commands[0]!.id,
      }),
    );
    // The server sends the cancellation acknowledgement before these bars.
    for (const command of f.commands.filter(
      (c) => c.type === "subscribe" && c.series?.resolution !== "1s",
    ))
      for (const socket of f.ws.clients)
        socket.send(
          JSON.stringify({
            ...wireEvent,
            id: command.id,
            listing: command.series!.listing,
            resolution: command.series!.resolution,
            bar: bar(2000),
          }),
        );
    for (const stream of streams.slice(1))
      expect(
        await f.runtime.runPromise(
          stream.pipe(
            Stream.filter(
              (event) => event.type === "bar" && event.bar.time === 2000,
            ),
            Stream.take(1),
            Stream.runCollect,
          ),
        ),
      ).toEqual([{ type: "bar", bar: bar(2000) }]);
    expect(f.sockets).toHaveLength(1);
    expect(f.ws.clients.size).toBe(1);
  } finally {
    for (const scope of scopes)
      await f.runtime.runPromise(Scope.close(scope, Exit.void));
    await f.close();
  }
});

const liveErrors = [
  ["invalid_query", { _tag: "Dataset.InvalidQuery" }],
  ["adjustment_unavailable", { _tag: "Dataset.Unsupported" }],
  ["busy", { _tag: "Dataset.StreamInterrupted", kind: "resync" }],
  ["unavailable", { _tag: "Dataset.StreamInterrupted", kind: "resync" }],
  ["resync_required", { _tag: "Dataset.StreamInterrupted", kind: "resync" }],
] as const;

test.each(liveErrors)(
  "live admission failure %s keeps its Dataset reason",
  async (code, reason) => {
    const f = await fixture();
    try {
      f.setAcknowledge(false);
      f.setInitialFrame(JSON.stringify({ type: "error", code }));
      await expect(
        f.runtime.runPromise(
          f.client
            .subscribeBars(series)
            .pipe(Effect.mapError(openchartError), Effect.scoped),
        ),
      ).rejects.toMatchObject({
        reason,
        cause: { _tag: "OpenChartLiveError", code },
      });
    } finally {
      await f.close();
    }
  },
);

test.each(liveErrors)(
  "a failed subscription (%s) can be replaced without disrupting another series",
  async (code, reason) => {
    const f = await fixture();
    try {
      await f.runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const first = yield* f.client.subscribeBars(series);
            const second = yield* f.client.subscribeBars({
              ...series,
              listing: 99,
            });
            const id = f.commands[0]!.id;
            for (const socket of f.ws.clients)
              socket.send(JSON.stringify({ type: "error", id, code }));
            expect(
              yield* first.pipe(
                Stream.runDrain,
                Effect.mapError(openchartError),
                Effect.result,
              ),
            ).toMatchObject({
              _tag: "Failure",
              failure: { reason, cause: { _tag: "OpenChartLiveError", code } },
            });
            yield* f.client.subscribeBars(series);
            expect(f.sockets).toHaveLength(1);
            expect(
              f.commands.filter((c) => c.type === "subscribe"),
            ).toHaveLength(3);
            expect(f.commands[2]!.id).not.toBe(id);
            for (const socket of f.ws.clients)
              socket.send(
                JSON.stringify({
                  ...wireEvent,
                  id: f.commands[1]!.id,
                  listing: 99,
                  bar: bar(2000),
                }),
              );
            expect(
              yield* second.pipe(Stream.take(2), Stream.runCollect),
            ).toEqual([initialEvent, { type: "bar", bar: bar(2000) }]);
          }),
        ),
      );
    } finally {
      await f.close();
    }
  },
);
test("late consumers receive the current open bar and a slow consumer cannot end a shared subscription", async () => {
  const f = await fixture();
  f.setInitialFrame(
    JSON.stringify({ ...wireEvent, bar: bar(1000, 100, false) }),
  );
  try {
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const slow = yield* f.client.subscribeBars(series);
          const fast = yield* f.client.subscribeBars(series);
          const collected: number[] = [];
          yield* fast.pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "bar") collected.push(event.bar.time);
              }),
            ),
            Effect.forkScoped,
          );
          for (let i = 0; i < 270; i++) {
            for (const socket of f.ws.clients)
              socket.send(
                JSON.stringify({
                  ...wireEvent,
                  bar: bar(2000 + i, 100, false),
                }),
              );
            if (i % 20 === 0) yield* Effect.sleep("2 millis");
          }
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(collected).toHaveLength(271)),
          );
          expect(
            yield* slow.pipe(Stream.runDrain, Effect.result),
          ).toMatchObject({ _tag: "Failure" });
          expect(f.ws.clients.size).toBe(1);
          expect(f.commands.filter((c) => c.type === "subscribe")).toHaveLength(
            1,
          );
          const late = yield* f.client.subscribeBars(series);
          expect(yield* late.pipe(Stream.take(1), Stream.runCollect)).toEqual([
            { type: "bar", bar: bar(2269, 100, false) },
          ]);
        }),
      ),
    );
  } finally {
    await f.close();
  }
});

test("twenty series renew together on one replacement connection", async () => {
  const f = await fixture();
  const scopes = await Promise.all(
    Array.from({ length: 20 }, () => f.runtime.runPromise(Scope.make())),
  );
  try {
    for (let round = 0; round < 3; round++) {
      const streams = await Promise.all(
        scopes.map((scope, index) =>
          f.runtime.runPromise(
            f.client
              .subscribeBars({ ...series, listing: index + 1 })
              .pipe(Scope.provide(scope)),
          ),
        ),
      );
      expect(f.sockets).toHaveLength(round + 1);
      expect(f.ws.clients.size).toBe(1);
      expect(f.commands.filter((c) => c.type === "subscribe")).toHaveLength(
        (round + 1) * 20,
      );
      for (const socket of f.ws.clients) socket.close(1012);
      const results = await Promise.all(
        streams.map((stream) =>
          f.runtime.runPromise(stream.pipe(Stream.runDrain, Effect.result)),
        ),
      );
      for (const result of results)
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "OpenChartResyncRequired" },
        });
    }
    expect(f.source.getAccessToken).toHaveBeenCalledTimes(3);
  } finally {
    await Promise.all(
      scopes.map((scope) =>
        f.runtime.runPromise(Scope.close(scope, Exit.void)),
      ),
    );
    await f.close();
  }
});

test("subscription acknowledgement is inside the deadline and a timed-out acquisition releases its socket", async () => {
  const f = await fixture("100 millis");
  f.setAcknowledge(false);
  try {
    await expect(
      f.runtime.runPromise(f.client.subscribeBars(series).pipe(Effect.scoped)),
    ).rejects.toMatchObject({ _tag: "OpenChartTimeout" });
    await vi.waitFor(() => expect(f.ws.clients.size).toBe(0));
    f.setAcknowledge(true);
    await f.runtime.runPromise(
      f.client.subscribeBars(series).pipe(Effect.scoped),
    );
    expect(f.sockets).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("one missing acknowledgement does not block another series on the socket", async () => {
  const f = await fixture("200 millis");
  f.setAcknowledge(false);
  try {
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pending = yield* f.client
            .subscribeBars(series)
            .pipe(Effect.result, Effect.forkScoped);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(f.commands).toHaveLength(1)),
          );
          f.setAcknowledge(true);
          const updates = yield* f.client.subscribeBars({
            ...series,
            listing: 99,
          });
          expect(
            yield* updates.pipe(Stream.take(1), Stream.runCollect),
          ).toEqual([initialEvent]);
          expect(yield* Fiber.join(pending)).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "OpenChartTimeout" },
          });
          expect(f.sockets).toHaveLength(1);
          expect(f.ws.clients.size).toBe(1);
        }),
      ),
    );
  } finally {
    await f.close();
  }
});
