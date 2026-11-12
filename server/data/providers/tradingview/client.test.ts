import { EventEmitter } from "node:events";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import type WebSocket from "ws";
import { makeClient } from "./client";
import { encodeFrame, heartbeatFrame, parseFrames } from "./protocol";

const searchBody = {
  symbols: [
    {
      symbol: "<em>AAPL</em>",
      description: "Apple Inc.",
      type: "stock",
      exchange: "NASDAQ",
      source_id: "NASDAQ",
      currency_code: "USD",
      typespecs: ["common"],
    },
    {
      symbol: "<em>BTCUSDT</em>",
      description: "Bitcoin / TetherUS",
      type: "spot",
      exchange: "Binance",
      source_id: "BINANCE",
      currency_code: "USDT",
      typespecs: ["crypto"],
    },
    { symbol: "<em>NOPE</em>", type: "stock" },
  ],
};

const paidHomepage =
  '<script>var user = {"username":"TestUser","is_pro":true,"pro_plan":"pro_premium","auth_token":"test-auth-token"};</script>';

test("search retains native symbols and drops hits without a venue", async () => {
  const client = await Effect.runPromise(
    makeClient({
      fetch: async () => Response.json(searchBody),
    }),
  );
  const rows = await Effect.runPromise(client.search("AAPL"));
  expect(rows).toEqual([
    {
      symbol: "AAPL",
      exchange: "NASDAQ",
      name: "Apple Inc.",
      type: "stock",
      currency: "USD",
      typespecs: ["common"],
    },
    {
      symbol: "BTCUSDT",
      exchange: "BINANCE",
      name: "Bitcoin / TetherUS",
      type: "spot",
      currency: "USDT",
      typespecs: ["crypto"],
    },
  ]);
});

test.each([
  ["NQ", "NQ", ""],
  ["nq!", "nq1!", ""],
  ["CME_MINI:NQ1!", "NQ1!", "CME_MINI"],
  ["cme_mini : nq!", "nq1!", "CME_MINI"],
  ["NQ!!", "NQ!!", ""],
])(
  "search %s returns actual futures contracts, never the family symbol",
  async (query, text, exchange) => {
    let request: URL | undefined;
    const client = await Effect.runPromise(
      makeClient({
        fetch: async (input) => {
          request = new URL(String(input));
          return Response.json({
            symbols: [
              {
                symbol: "<em>NQ</em>",
                description: "E-mini Nasdaq-100 Futures",
                type: "futures",
                exchange: "CME",
                source_id: "CME_MINI",
                currency_code: "USD",
                contracts: [
                  {
                    symbol: "<em>NQ</em>1!",
                    prefix: "CME_MINI",
                    typespecs: ["continuous"],
                  },
                  {
                    symbol: "<em>NQ</em>Z2026",
                    description: "Dec 2026",
                    prefix: "CME_MINI",
                  },
                ],
              },
            ],
          });
        },
      }),
    );
    const rows = await Effect.runPromise(client.search(query));
    expect(request?.searchParams.get("text")).toBe(text);
    expect(request?.searchParams.get("exchange")).toBe(exchange);
    expect(rows).toEqual([
      {
        symbol: "NQ1!",
        name: "E-mini Nasdaq-100 Futures",
        exchange: "CME_MINI",
        type: "futures",
        currency: "USD",
        typespecs: ["continuous"],
      },
      {
        symbol: "NQZ2026",
        name: "E-mini Nasdaq-100 Futures · Dec 2026",
        exchange: "CME_MINI",
        type: "futures",
        currency: "USD",
      },
    ]);
  },
);

test("a rate-limited search waits for Retry-After and tries again", async () => {
  let requests = 0;
  const client = await Effect.runPromise(
    makeClient({
      fetch: async () =>
        ++requests === 1
          ? new Response("", { status: 429, headers: { "retry-after": "0" } })
          : Response.json(searchBody),
    }),
  );
  const rows = await Effect.runPromise(client.search("AAPL"));
  expect(rows.map(({ symbol }) => symbol)).toEqual(["AAPL", "BTCUSDT"]);
  expect(requests).toBe(2);
});

test("indices and yields without a currency remain searchable without inventing one", async () => {
  const client = await Effect.runPromise(
    makeClient({
      fetch: async () =>
        Response.json({
          symbols: [
            {
              symbol: "SPX",
              description: "S&P 500",
              source_id: "SP",
              type: "index",
            },
            {
              symbol: "US10Y",
              description: "US Government Bonds 10Y Yield",
              source_id: "TVC",
              type: "bond",
            },
          ],
        }),
    }),
  );
  expect(await Effect.runPromise(client.search("SPX"))).toEqual([
    {
      symbol: "SPX",
      name: "S&P 500",
      exchange: "SP",
      type: "index",
      currency: "",
    },
    {
      symbol: "US10Y",
      name: "US Government Bonds 10Y Yield",
      exchange: "TVC",
      type: "bond",
      currency: "",
    },
  ]);
});

const candle = (seconds: number, close = 10) => [
  seconds,
  10,
  11,
  9,
  close,
  100,
];

const message = (method: string, parameters: readonly unknown[]) =>
  Buffer.from(encodeFrame(method, parameters));

const update = (candle: unknown[]) =>
  message("timescale_update", ["cs", { sds_1: { s: [{ v: candle }] } }]);
const completed = (mode = "streaming") =>
  message("series_completed", ["cs", "sds_1", mode, "s1", {}]);

class FakeSocket extends EventEmitter {
  readyState = 0;
  readonly sent: string[] = [];
  readonly commands: { method: string; parameters: readonly unknown[] }[] = [];
  readonly batches: Buffer[] = [];
  readonly heartbeats: string[] = [];
  terminated = false;
  /** Chart session the test's fixed `cs` address is translated to. */
  chartSession: string | undefined;
  /** Session currently issuing a command; responses answer it. */
  activeSession: string | undefined;

  constructor(
    private readonly respond: (
      method: string,
      parameters: readonly unknown[],
      socket: FakeSocket,
    ) => void,
    private readonly refuseStatus?: number,
  ) {
    super();
    queueMicrotask(() => {
      if (this.refuseStatus === undefined) {
        this.readyState = 1;
        this.emit("open");
      } else {
        this.readyState = 3;
        this.emit(
          "unexpected-response",
          {},
          { statusCode: this.refuseStatus, resume() {} },
        );
      }
    });
  }

  send(data: string) {
    for (const payload of parseFrames(data)) {
      if (payload.startsWith("~h~")) {
        this.heartbeats.push(payload);
        continue;
      }
      const parsed = JSON.parse(payload) as {
        m: string;
        p: readonly unknown[];
      };
      this.sent.push(parsed.m);
      this.commands.push({ method: parsed.m, parameters: parsed.p });
      if (parsed.m === "chart_create_session")
        this.chartSession = String(parsed.p[0]);
      this.activeSession =
        typeof parsed.p[0] === "string" ? parsed.p[0] : this.activeSession;
      try {
        this.respond(parsed.m, parsed.p, this);
      } finally {
        this.activeSession = undefined;
      }
    }
  }

  emitMessage(...frames: readonly Buffer[]) {
    this.emitFor(this.activeSession ?? this.chartSession, ...frames);
  }

  /** Emits frames addressed to a specific chart session, even outside a command. */
  emitFor(session: string | undefined, ...frames: readonly Buffer[]) {
    const translated = frames.map((frame) => {
      const payloads = parseFrames(frame.toString()).map((payload) => {
        if (payload.startsWith("~h~") || session === undefined) return payload;
        const message = JSON.parse(payload) as {
          m: string;
          p: unknown[];
        };
        if (message.p[0] === "cs") message.p[0] = session;
        return JSON.stringify(message);
      });
      return Buffer.from(
        payloads.map((payload) => `~m~${payload.length}~m~${payload}`).join(""),
      );
    });
    this.batches.push(...translated);
    this.emit("message", Buffer.concat(translated));
  }

  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.readyState = 3;
    this.emit("close", 1006, Buffer.from(""));
  }
}

const asWebSocket = (socket: FakeSocket) => socket as unknown as WebSocket;

test("history reads both create and modify completions inside its half-open range", async () => {
  const from = Date.UTC(2026, 0, 5, 14, 30);
  const to = from + 3 * 60_000;
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(
        update(candle(from / 1000, 20)),
        update(candle((from - 60_000) / 1000, 99)),
        completed(),
      );
    if (method === "modify_series")
      socket.emitMessage(
        update(candle((from + 60_000) / 1000, 21)),
        update(candle((from + 2 * 60_000) / 1000, 22)),
        update(candle(to / 1000, 98)),
        completed(),
      );
  });
  const client = await Effect.runPromise(
    makeClient({ websocket: () => asWebSocket(socket) }),
  );
  const rows = await Effect.runPromise(
    Effect.scoped(
      client.history({
        symbol: "NASDAQ:AAPL",
        resolution: "1m",
        adjustment: "split",
        from,
        to,
      }),
    ),
  );
  expect(rows.map(({ time, close }) => [time, close])).toEqual([
    [from, 20],
    [from + 60_000, 21],
    [from + 2 * 60_000, 22],
  ]);
  expect(socket.sent).toContain("modify_series");
});

test("a count-only read pages backwards until it has enough bars", async () => {
  const to = Date.UTC(2026, 0, 5, 15, 0);
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series") {
      socket.emitMessage(
        update(candle((to - 60_000) / 1000, 20)),
        completed(),
        update(candle((to - 120_000) / 1000, 21)),
        completed(),
      );
    }
    if (method === "request_more_data") {
      socket.emitMessage(
        update(candle((to - 180_000) / 1000, 22)),
        completed(),
      );
    }
  });
  const client = await Effect.runPromise(
    makeClient({ websocket: () => asWebSocket(socket) }),
  );
  const rows = await Effect.runPromise(
    Effect.scoped(
      client.history({
        symbol: "NASDAQ:AAPL",
        resolution: "1m",
        adjustment: "raw",
        to,
        count: 3,
      }),
    ),
  );
  expect(rows.map(({ close }) => close)).toEqual([22, 21, 20]);
  expect(socket.sent).toContain("request_more_data");
});

test("history reads multiplex onto a live chart's physical socket", async () => {
  const time = Date.UTC(2026, 0, 5, 15);
  let connections = 0;
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(
        update(candle((time - 60_000) / 1000, 20)),
        completed(),
      );
    if (method === "modify_series") socket.emitMessage(completed());
  });
  const rows = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => {
          connections++;
          return asWebSocket(socket);
        },
      });
      const updates = yield* client.live(
        liveRequest,
        yield* Deferred.make<void>(),
      );
      yield* updates.pipe(Stream.take(1), Stream.runDrain);
      const first = yield* client.history({
        ...liveRequest,
        to: time,
        count: 1,
      });
      const second = yield* client.history({
        ...liveRequest,
        to: time,
        count: 1,
      });
      // Each finite read ends its upstream chart session while the live
      // chart keeps the physical socket open.
      expect(
        socket.commands.filter(
          (command) => command.method === "chart_delete_session",
        ),
      ).toHaveLength(2);
      return [first, second];
    }).pipe(Effect.scoped),
  );
  expect(rows.map((bars) => bars.map((bar) => bar.close))).toEqual([
    [20],
    [20],
  ]);
  expect(
    socket.commands.filter(
      (command) => command.method === "chart_delete_session",
    ),
  ).toHaveLength(3);
  expect(connections).toBe(1);
});

test("an HTTP 429 upgrade is rate limiting and holds back new connections", async () => {
  let connections = 0;
  const results = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => {
          connections++;
          return asWebSocket(new FakeSocket(() => {}, 429));
        },
      });
      const first = yield* client
        .history({ ...liveRequest, count: 1 })
        .pipe(Effect.result);
      const second = yield* client
        .history({ ...liveRequest, count: 1 })
        .pipe(Effect.result);
      return [first, second];
    }),
  );
  for (const result of results)
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: { _tag: "Dataset.RateLimited" } },
    });
  expect(connections).toBe(1);
});

test("an upgrade cooldown does not block sockets that still have room", async () => {
  const time = Date.UTC(2026, 0, 5, 15);
  let connections = 0;
  const shared = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(
        update(candle((time - 60_000) / 1000, 20)),
        completed(),
      );
    if (method === "modify_series") socket.emitMessage(completed());
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        sockets: 2,
        sessions: 2,
        websocket: () => {
          connections++;
          return asWebSocket(
            connections === 1 ? shared : new FakeSocket(() => {}, 429),
          );
        },
      });
      const hold = () =>
        Effect.gen(function* () {
          const retired = yield* Deferred.make<void>();
          const ready = yield* Deferred.make<void>();
          const reader = yield* Effect.scoped(
            Effect.gen(function* () {
              const updates = yield* client.live(liveRequest, retired);
              yield* Deferred.succeed(ready, undefined);
              yield* updates.pipe(Stream.runDrain);
            }),
          ).pipe(Effect.forkScoped);
          yield* Deferred.await(ready);
          return { retired, reader };
        });
      const first = yield* hold();
      yield* hold();
      // Both slots on the healthy socket are taken, so the next read needs a
      // new socket, which TradingView refuses.
      const blocked = yield* client
        .history({ ...liveRequest, count: 1 })
        .pipe(Effect.result);
      // Retiring one chart frees a slot while the other keeps the socket open.
      yield* Deferred.succeed(first.retired, undefined);
      yield* Fiber.join(first.reader);
      const rows = yield* client.history({ ...liveRequest, count: 1 });
      return { blocked, rows };
    }).pipe(Effect.scoped),
  );
  expect(result.blocked).toMatchObject({
    _tag: "Failure",
    failure: { reason: { _tag: "Dataset.RateLimited" } },
  });
  expect(result.rows.map((row) => row.close)).toEqual([20]);
  expect(connections).toBe(2);
});

test("cancelling an unfinished history request immediately releases its socket", async () => {
  const socket = new FakeSocket(() => {});
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const running = yield* client
        .history({ ...liveRequest, count: 10 })
        .pipe(Effect.scoped, Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(socket.sent).toContain("create_series");
      expect(socket.terminated).toBe(false);
      yield* Fiber.interrupt(running);
      expect(socket.terminated).toBe(true);
    }).pipe(Effect.scoped),
  );
});

test("a symbol refusal keeps its TradingView reason", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(
        message("symbol_error", [
          "cs",
          "sds_sym_1",
          "invalid symbol",
          "unknown",
        ]),
      );
  });
  const client = await Effect.runPromise(
    makeClient({ websocket: () => asWebSocket(socket) }),
  );
  const failure = await Effect.runPromise(
    Effect.flip(
      Effect.scoped(
        client.history({
          symbol: "NASDAQ:NOPE",
          resolution: "1m",
          adjustment: "raw",
          count: 1,
        }),
      ),
    ),
  );
  expect(failure.reason._tag).toBe("Dataset.NotFound");
});

test("history pages to the requested start without treating two missing bars as coverage", async () => {
  const from = Date.UTC(2026, 0, 5, 14, 30);
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(update(candle((from + 120_000) / 1000)), completed());
    if (method === "modify_series") socket.emitMessage(completed());
    if (method === "request_more_data")
      socket.emitMessage(
        update(candle(from / 1000)),
        update(candle((from + 60_000) / 1000)),
        completed(),
      );
  });
  const client = await Effect.runPromise(
    makeClient({ websocket: () => asWebSocket(socket) }),
  );
  const rows = await Effect.runPromise(
    Effect.scoped(
      client.history({
        ...liveRequest,
        from,
        to: from + 180_000,
      }),
    ),
  );
  expect(rows.map(({ time }) => time)).toEqual([
    from,
    from + 60_000,
    from + 120_000,
  ]);
});

test("history follows older pages until count is satisfied, including more than eight pages", async () => {
  const to = Date.UTC(2026, 0, 5, 15, 0);
  let pages = 0;
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(update(candle((to - 60_000) / 1000)), completed());
    if (method === "modify_series") socket.emitMessage(completed());
    if (method === "request_more_data") {
      pages++;
      socket.emitMessage(
        update(candle((to - (pages + 1) * 60_000) / 1000)),
        completed(),
      );
    }
  });
  const client = await Effect.runPromise(
    makeClient({ websocket: () => asWebSocket(socket) }),
  );
  const rows = await Effect.runPromise(
    Effect.scoped(client.history({ ...liveRequest, to, count: 11 })),
  );
  expect(rows).toHaveLength(11);
  expect(pages).toBe(10);
});

test("a stored session that TradingView rejects denies access instead of falling back", async () => {
  const client = await Effect.runPromise(
    makeClient({
      credential: () => Effect.succeed({ sessionid: "expired" }),
      fetch: async () =>
        new Response('<script>var user = {"username":"Guest"};</script>'),
    }),
  );
  const failure = await Effect.runPromise(Effect.flip(client.access()));
  expect(failure.reason._tag).toBe("Dataset.AccessDenied");
});

test.each(["history", "live"] as const)(
  "a rejected stored session prevents %s from opening an anonymous socket",
  async (mode) => {
    let sockets = 0;
    const client = await Effect.runPromise(
      makeClient({
        credential: () => Effect.succeed({ sessionid: "expired" }),
        fetch: async () =>
          new Response('<script>var user = {"username":"Guest"};</script>'),
        websocket: () => {
          sockets++;
          throw new Error("must reject before opening a socket");
        },
      }),
    );
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        return mode === "history"
          ? yield* client
              .history({ ...liveRequest, count: 1 })
              .pipe(Effect.result)
          : yield* client
              .live(liveRequest, yield* Deferred.make<void>())
              .pipe(Effect.result);
      }).pipe(Effect.scoped),
    );
    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { reason: { _tag: "Dataset.AccessDenied" } },
    });
    expect(sockets).toBe(0);
  },
);

test("an authenticated paid account uses its token and pro endpoint for history", async () => {
  let opened: string | undefined;
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series" || method === "modify_series")
      socket.emitMessage(completed());
    if (method === "request_more_data") socket.emitMessage(completed());
  });
  const client = await Effect.runPromise(
    makeClient({
      credential: () => Effect.succeed({ sessionid: "test-session" }),
      fetch: async () => new Response(paidHomepage),
      websocket: (url) => {
        opened = url;
        return asWebSocket(socket);
      },
    }),
  );
  await Effect.runPromise(
    Effect.scoped(client.history({ ...liveRequest, count: 1 })),
  );
  expect(new URL(opened!).host).toBe("prodata.tradingview.com");
  expect(socket.commands).toContainEqual({
    method: "set_auth_token",
    parameters: ["test-auth-token"],
  });
});

test("equal sessions share one profile read until reset or a credential change", async () => {
  let device = "device-1";
  let reads = 0;
  const client = await Effect.runPromise(
    makeClient({
      // Each read decodes a new object, as Integration does.
      credential: () =>
        Effect.sync(() => ({ sessionid: "session", device_t: device })),
      fetch: async () => {
        reads++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(paidHomepage);
      },
    }),
  );
  await Effect.runPromise(
    Effect.all([client.access(), client.access(), client.access()], {
      concurrency: "unbounded",
    }),
  );
  await Effect.runPromise(client.access());
  expect(reads).toBe(1);
  await Effect.runPromise(client.reset());
  await Effect.runPromise(client.access());
  expect(reads).toBe(2);
  device = "device-2";
  await Effect.runPromise(client.access());
  expect(reads).toBe(3);
});

test("reset closes authenticated sockets before the next anonymous read", async () => {
  let session: { sessionid: string } | undefined = { sessionid: "session" };
  let connections = 0;
  const paid = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series") socket.emitMessage(completed());
  });
  const anonymous = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(update(candle(1_700_000_000, 12)), completed());
    if (method === "modify_series") socket.emitMessage(completed());
  });
  const rows = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        credential: () => Effect.succeed(session),
        fetch: async () => new Response(paidHomepage),
        websocket: () => {
          connections++;
          return asWebSocket(connections === 1 ? paid : anonymous);
        },
      });
      yield* client.live(liveRequest, yield* Deferred.make<void>());
      yield* client.reset();
      session = undefined;
      expect(paid.terminated).toBe(true);
      return yield* client.history({ ...liveRequest, count: 1 });
    }).pipe(Effect.scoped),
  );
  expect(rows.map((row) => row.close)).toEqual([12]);
  const tokens = (socket: FakeSocket) =>
    socket.commands
      .filter((command) => command.method === "set_auth_token")
      .map((command) => command.parameters[0]);
  expect(tokens(paid)).toEqual(["test-auth-token"]);
  expect(tokens(anonymous)).toEqual(["unauthorized_user_token"]);
});

test("a rejected session is not cached, so a later valid read succeeds", async () => {
  let accepted = false;
  const client = await Effect.runPromise(
    makeClient({
      credential: () => Effect.succeed({ sessionid: "session" }),
      fetch: async () =>
        new Response(
          accepted
            ? paidHomepage
            : '<script>var user = {"username":"Guest"};</script>',
        ),
    }),
  );
  const failure = await Effect.runPromise(Effect.flip(client.access()));
  expect(failure.reason._tag).toBe("Dataset.AccessDenied");
  accepted = true;
  await expect(Effect.runPromise(client.access())).resolves.toEqual({
    status: "granted",
  });
});

test.each(["history", "live"] as const)(
  "heartbeats alone cannot keep a pending %s request waiting",
  async (mode) => {
    // History waits for its modify_series completion; live waits for its first.
    const socket = new FakeSocket((method, _parameters, socket) => {
      if (mode === "history" && method === "create_series")
        socket.emitMessage(completed());
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 0, 5, 15));
        const client = yield* makeClient({
          websocket: () => asWebSocket(socket),
        });
        const request =
          mode === "history"
            ? Effect.asVoid(client.history({ ...liveRequest, count: 10 }))
            : Effect.asVoid(
                client.live(liveRequest, yield* Deferred.make<void>()),
              );
        const running = yield* request.pipe(
          Effect.scoped,
          Effect.result,
          Effect.forkScoped,
        );
        yield* Effect.yieldNow;
        expect(socket.sent).toContain("create_series");
        for (let heartbeat = 1; heartbeat <= 6; heartbeat++) {
          yield* TestClock.adjust("10 seconds");
          socket.emitMessage(Buffer.from(heartbeatFrame(`~h~${heartbeat}`)));
        }
        expect(running.pollUnsafe()).toBeDefined();
        return yield* Fiber.join(running);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: { _tag: "Dataset.Unavailable" } },
    });
    expect(socket.terminated).toBe(true);
  },
);

test("anonymous access needs no credential and no network", async () => {
  const client = await Effect.runPromise(
    makeClient({
      fetch: async () => {
        throw new Error("anonymous access must not fetch");
      },
    }),
  );
  await expect(Effect.runPromise(client.access())).resolves.toEqual({
    status: "granted",
  });
});

const liveRequest = {
  symbol: "NASDAQ:AAPL",
  resolution: "1m",
  adjustment: "raw",
} as const;

test("heartbeats keep an idle live series alive without becoming candle updates", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series") socket.emitMessage(completed());
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const updates = yield* client.live(
        liveRequest,
        yield* Deferred.make<void>(),
      );
      const running = yield* updates.pipe(
        Stream.filter((event) => event.type === "bars"),
        Stream.map((event) => event.bars),
        Stream.take(1),
        Stream.runCollect,
        Effect.result,
        Effect.forkScoped,
      );
      yield* TestClock.adjust("20 seconds");
      socket.emitMessage(Buffer.from(heartbeatFrame("~h~42")));
      yield* TestClock.adjust("20 seconds");
      expect(running.pollUnsafe()).toBeUndefined();
      socket.emitMessage(update(candle(1_700_000_000, 12)));
      return yield* Fiber.join(running);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
  expect(result).toMatchObject({
    _tag: "Success",
    success: [[{ time: 1_700_000_000_000, close: 12 }]],
  });
  expect(socket.heartbeats).toEqual(["~h~42"]);
  expect(socket.terminated).toBe(true);
});

test("a live connection without messages fails and is released on cancellation", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series") socket.emitMessage(completed());
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const updates = yield* client.live(
        liveRequest,
        yield* Deferred.make<void>(),
      );
      const running = yield* updates.pipe(
        Stream.runDrain,
        Effect.result,
        Effect.forkScoped,
      );
      yield* TestClock.adjust("30 seconds");
      return yield* Fiber.join(running);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
  expect(result).toMatchObject({
    _tag: "Failure",
    failure: { reason: { _tag: "Dataset.Unavailable" } },
  });
  expect(socket.terminated).toBe(true);
});

test.each(["critical_error", "protocol_error"])(
  "%s after live readiness fails immediately and closes its socket",
  async (method) => {
    const socket = new FakeSocket((method, _parameters, socket) => {
      if (method === "create_series") socket.emitMessage(completed());
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeClient({
          websocket: () => asWebSocket(socket),
        });
        const updates = yield* client.live(
          liveRequest,
          yield* Deferred.make<void>(),
        );
        socket.emitMessage(message(method, ["cs", "failure"]));
        return yield* updates.pipe(Stream.runDrain, Effect.result);
      }).pipe(Effect.scoped),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: { _tag: "Dataset.Unavailable" } },
    });
    expect(socket.terminated).toBe(true);
  },
);

test("retirement ends its session while accepted live candles drain, closing the last socket", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series") socket.emitMessage(completed());
  });
  const drained = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const retired = yield* Deferred.make<void>();
      const updates = yield* client.live(liveRequest, retired);
      socket.emitMessage(update(candle(1_700_000_000, 12)));
      yield* Deferred.succeed(retired, undefined);
      yield* Effect.yieldNow;
      // Another chart could still be multiplexed here, so the physical
      // socket stays open until the retiring session's Scope closes.
      expect(socket.terminated).toBe(false);
      return yield* updates.pipe(
        Stream.filter((event) => event.type === "bars"),
        Stream.map((event) => event.bars),
        Stream.runCollect,
      );
    }).pipe(Effect.scoped),
  );
  expect(drained).toMatchObject([[{ time: 1_700_000_000_000, close: 12 }]]);
  expect(socket.terminated).toBe(true);
});

test("candles sent before the live subscription completes reach the stream in order", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(
        update(candle(1_700_000_000, 12)),
        update(candle(1_700_000_001, 13)),
        completed(),
      );
  });
  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const updates = yield* client.live(
        liveRequest,
        yield* Deferred.make<void>(),
      );
      socket.emitMessage(update(candle(1_700_000_002, 14)));
      return yield* updates.pipe(Stream.take(4), Stream.runCollect);
    }).pipe(Effect.scoped),
  );
  expect(events).toMatchObject([
    { type: "bars", bars: [{ time: 1_700_000_000_000, close: 12 }] },
    { type: "bars", bars: [{ time: 1_700_000_001_000, close: 13 }] },
    { type: "status", status: { mode: "live" } },
    { type: "bars", bars: [{ time: 1_700_000_002_000, close: 14 }] },
  ]);
});

test("live activity retains the source-reported delay and heartbeat separately from prices", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(completed("delayed_streaming_600"));
  });
  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const updates = yield* client.live(
        liveRequest,
        yield* Deferred.make<void>(),
      );
      socket.emitMessage(
        Buffer.from(heartbeatFrame("~h~42")),
        update(candle(1_700_000_000, 12)),
      );
      return yield* updates.pipe(Stream.take(3), Stream.runCollect);
    }).pipe(Effect.scoped),
  );
  expect(events).toMatchObject([
    { type: "status", status: { mode: "delayed", delaySeconds: 600 } },
    { type: "heartbeat" },
    { type: "bars", bars: [{ time: 1_700_000_000_000, close: 12 }] },
  ]);
});

test("receipt sequences preserve arrival order across multiplexed live and history sessions", async () => {
  const time = Date.UTC(2026, 0, 5, 15);
  const receipts: string[] = [];
  const sessions: string[] = [];
  const socket = new FakeSocket((method, parameters, socket) => {
    const session = String(parameters[0]);
    if (method === "chart_create_session") {
      sessions.push(session);
      return;
    }
    if (method === "create_series" && sessions.length === 1) {
      receipts.push("pre-ack live");
      socket.emitMessage(update(candle(time / 1000, 10)), completed());
    }
    if (method === "create_series" && sessions.length === 2) {
      receipts.push("live before history data");
      socket.emitFor(sessions[0], update(candle(time / 1000, 10.25)));
      receipts.push("history data");
      socket.emitMessage(update(candle(time / 1000, 10.5)), completed());
    }
    if (method === "modify_series") {
      receipts.push("live after history data");
      socket.emitFor(sessions[0], update(candle(time / 1000, 10.75)));
      receipts.push("history completed");
      socket.emitMessage(completed());
    }
  });
  let connections = 0;
  const { history, live } = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => {
          connections++;
          return asWebSocket(socket);
        },
      });
      const updates = yield* client.live(
        liveRequest,
        yield* Deferred.make<void>(),
      );
      const history = yield* client.history({
        ...liveRequest,
        to: time + 60_000,
        count: 1,
      });
      receipts.push("history returned before consuming live");
      const live = yield* updates.pipe(
        Stream.filter((event) => event.type === "bars"),
        Stream.map((event) => event.bars[0]!),
        Stream.take(3),
        Stream.runCollect,
      );
      return { history, live };
    }).pipe(Effect.scoped),
  );
  expect(receipts).toEqual([
    "pre-ack live",
    "live before history data",
    "history data",
    "live after history data",
    "history completed",
    "history returned before consuming live",
  ]);
  expect(history.map((bar) => bar.close)).toEqual([10.5]);
  expect(live.map((bar) => bar.close)).toEqual([10, 10.25, 10.75]);
  expect(live[0]!.receivedSequence).toBeLessThan(live[1]!.receivedSequence);
  expect(live[1]!.receivedSequence).toBeLessThan(history[0]!.receivedSequence);
  expect(live[2]!.receivedSequence).toBeGreaterThan(
    history[0]!.receivedSequence,
  );
  expect(connections).toBe(1);
  expect(socket.terminated).toBe(true);
});

test("receipt sequences are shared within a candle frame and increase for the next frame", async () => {
  const time = Date.UTC(2026, 0, 5, 15);
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series")
      socket.emitMessage(
        message("timescale_update", [
          "cs",
          {
            sds_1: {
              s: [
                { v: candle(time / 1000, 10) },
                { v: candle((time + 60_000) / 1000, 10.25) },
              ],
            },
          },
        ]),
        completed(),
      );
    if (method === "modify_series")
      socket.emitMessage(
        update(candle((time + 120_000) / 1000, 10.5)),
        completed(),
      );
  });
  const bars = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      return yield* client.history({
        ...liveRequest,
        to: time + 180_000,
        count: 3,
      });
    }).pipe(Effect.scoped),
  );
  expect(bars.map((bar) => bar.close)).toEqual([10, 10.25, 10.5]);
  expect(bars[0]!.receivedSequence).toBeGreaterThan(0);
  expect(bars[1]!.receivedSequence).toBe(bars[0]!.receivedSequence);
  expect(bars[2]!.receivedSequence).toBeGreaterThan(bars[1]!.receivedSequence);
  expect(socket.terminated).toBe(true);
});
