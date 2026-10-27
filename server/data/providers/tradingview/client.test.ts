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
  readyState = 1;
  readonly sent: string[] = [];
  readonly commands: { method: string; parameters: readonly unknown[] }[] = [];
  readonly batches: Buffer[] = [];
  readonly heartbeats: string[] = [];
  terminated = false;

  constructor(
    private readonly respond: (
      method: string,
      parameters: readonly unknown[],
      socket: FakeSocket,
    ) => void,
  ) {
    super();
    queueMicrotask(() => this.emit("open"));
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
      this.respond(parsed.m, parsed.p, this);
    }
  }

  emitMessage(...frames: readonly Buffer[]) {
    this.batches.push(...frames);
    this.emit("message", Buffer.concat(frames));
  }

  terminate() {
    this.terminated = true;
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

test("retirement stops the socket while accepted live candles drain", async () => {
  const socket = new FakeSocket((method, _parameters, socket) => {
    if (method === "create_series") socket.emitMessage(completed());
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        websocket: () => asWebSocket(socket),
      });
      const retired = yield* Deferred.make<void>();
      const updates = yield* client.live(liveRequest, retired);
      socket.emitMessage(update(candle(1_700_000_000, 12)));
      yield* Deferred.succeed(retired, undefined);
      yield* Effect.yieldNow;
      expect(socket.terminated).toBe(true);
      expect(
        yield* updates.pipe(
          Stream.filter((event) => event.type === "bars"),
          Stream.map((event) => event.bars),
          Stream.runCollect,
        ),
      ).toMatchObject([[{ time: 1_700_000_000_000, close: 12 }]]);
    }).pipe(Effect.scoped),
  );
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
