// Purpose: Exercise Binance pagination, ready WS buffering, loss reporting, and cancellation.

import { ConfigProvider, Deferred, Effect, Layer, Stream } from "effect";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { ConfigProviderUpdates } from "@openchart/server/config/provider";
import type { Dataset } from "@openchart/server/data/dataset";
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import { BinanceProvider } from "./binance";
import { request } from "./client";
import {
  cachedSelectBars,
  selectBars,
  streamBars,
} from "@openchart/server/data/providers/binance/datasets/bars";
import { searchSymbols } from "@openchart/server/data/providers/binance/datasets/symbology";

const kline = (time: number, trades = 2) => [
  time,
  "10",
  "12",
  "9",
  "11",
  "20",
  time + 59_999,
  "200",
  trades,
  "10",
  "100",
  "0",
];
const message = (time: number) =>
  JSON.stringify({
    e: "kline",
    E: time + 10,
    s: "BTCUSDT",
    k: {
      t: time,
      s: "BTCUSDT",
      i: "1m",
      o: "10",
      h: "12",
      l: "9",
      c: "11",
      v: "20",
      n: 2,
      x: false,
    },
  });

describe("Binance Provider", () => {
  it("reuses native historical windows and counts, fetching only the extension", async () => {
    const minute = 60_000;
    const times = Array.from({ length: 20 }, (_, i) => (i + 1) * minute);
    const queries: URL[] = [];
    const options = {
      fetch: (async (input) => {
        const url = new URL(String(input));
        queries.push(url);
        const from = Number(url.searchParams.get("startTime"));
        const to = Number(url.searchParams.get("endTime"));
        const limit = Number(url.searchParams.get("limit"));
        const rows = times.filter((time) => time >= from && time <= to);
        return Response.json(
          (url.searchParams.has("startTime")
            ? rows.slice(0, limit)
            : rows.slice(-limit)
          ).map((time) => kline(time)),
        );
      }) as typeof fetch,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const { select: cached } = yield* cachedSelectBars((query) =>
          selectBars(options, query),
        );
        const key = { symbol: "BTCUSDT", interval: "1m" as const };
        const query = { ...key, time: { from: 3 * minute, to: 8 * minute } };
        const first = yield* cached(query);
        for (let i = 0; i < 10; i++)
          expect(yield* cached(query)).toEqual(first);
        expect(queries).toHaveLength(1);
        const extended = yield* cached({
          ...query,
          time: { from: 2 * minute, to: 10 * minute },
        });
        expect([...extended].map((r) => r.time)).toEqual(times.slice(1, 9));
        expect(
          queries
            .slice(1)
            .map((q) => [
              q.searchParams.get("startTime"),
              q.searchParams.get("endTime"),
            ]),
        ).toEqual([
          [String(2 * minute), String(3 * minute - 1)],
          [String(8 * minute), String(10 * minute - 1)],
        ]);
        expect(
          (yield* cached({ ...key, time: { to: 8 * minute }, count: 4 }))
            .numRows,
        ).toBe(4);
        expect(queries).toHaveLength(3);
      }),
    );
  });

  it("maps Binance HTTP statuses to typed reasons", async () => {
    for (const [status, tag] of [
      [400, "Dataset.InvalidQuery"],
      [401, "Dataset.AccessDenied"],
      [403, "Dataset.AccessDenied"],
      [451, "Dataset.AccessDenied"],
      [418, "Dataset.RateLimited"],
      [429, "Dataset.RateLimited"],
      [500, "Dataset.Unavailable"],
    ] as const) {
      const error = await Effect.runPromise(
        Effect.flip(
          request(
            {
              fetch: async () => new Response(null, { status }),
            },
            "/api/v3/exchangeInfo",
            {},
          ),
        ),
      );
      expect(error.reason._tag).toBe(tag);
    }
  });

  it("projects exchangeInfo trading metadata into searchable Spot pairs", async () => {
    const data = await Effect.runPromise(
      searchSymbols(
        {
          fetch: async () =>
            Response.json({
              symbols: [
                {
                  symbol: "BTCUSDT",
                  baseAsset: "BTC",
                  quoteAsset: "USDT",
                  status: "TRADING",
                  isSpotTradingAllowed: true,
                  baseAssetPrecision: 8,
                  orderTypes: ["LIMIT"],
                },
                {
                  symbol: "OLDUSDT",
                  baseAsset: "OLD",
                  quoteAsset: "USDT",
                  status: "BREAK",
                  isSpotTradingAllowed: true,
                },
              ],
            }),
        },
        { query: "BTC" },
      ),
    );
    expect(data).toEqual([
      {
        symbol: "BTCUSDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        status: "TRADING",
      },
    ]);
  });

  it("paginates latest count backwards rather than treating count as elapsed time", async () => {
    const rows = Array.from({ length: 1002 }, (_, i) =>
      kline((i + 1) * 60_000),
    );
    const ends: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const end = Number(url.searchParams.get("endTime"));
      ends.push(end);
      const limit = Number(url.searchParams.get("limit"));
      return Response.json(
        rows.filter((row) => Number(row[0]) <= end).slice(-limit),
      );
    };
    const data = await Effect.runPromise(
      selectBars(
        { fetch: fetcher },
        {
          symbol: "BTCUSDT",
          interval: "1m",
          time: { to: 1003 * 60_000 },
          count: 1002,
        },
      ),
    );
    expect([...data].map((row) => row.time)).toEqual(rows.map((row) => row[0]));
    expect(ends).toEqual([1003 * 60_000 - 1, 3 * 60_000 - 1]);
    expect([...data].map((row) => row.trades)).toHaveLength(1002);
  });

  it("rejects malformed numeric payloads and out-of-range pages", async () => {
    const query = {
      symbol: "BTCUSDT",
      interval: "1m" as const,
      time: { from: 60_000, to: 120_000 },
    };
    await expect(
      Effect.runPromise(
        selectBars(
          {
            fetch: async () =>
              Response.json([[60_000, "NaN", ...kline(60_000).slice(2)]]),
          },
          query,
        ),
      ),
    ).rejects.toMatchObject({ reason: { _tag: "Dataset.InvalidResult" } });
    await expect(
      Effect.runPromise(
        selectBars(
          { fetch: async () => Response.json([kline(120_000)]) },
          query,
        ),
      ),
    ).rejects.toMatchObject({
      reason: { _tag: "Dataset.InvalidResult" },
      cause: expect.stringContaining("out-of-range"),
    });
  });

  it("retirement drains buffered messages even before consumption and completes normally", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (typeof address !== "object" || address === null)
      throw new Error("Missing server address");
    let client: WebSocket | undefined;
    let received = 0;
    let ready!: () => void;
    const delivered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    try {
      const data = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const retired = yield* Deferred.make<void>();
            const updates = yield* streamBars(
              {
                websocketUrl: `ws://127.0.0.1:${address.port}`,
                websocket: (url) => {
                  client = new WebSocket(url);
                  client.on("message", () => {
                    if (++received === 2) ready();
                  });
                  return client;
                },
              },
              { symbol: "BTCUSDT", interval: "1m" },
              retired,
            );
            const peer = [...server.clients][0]!;
            peer.send(message(60_000));
            peer.send(message(120_000));
            yield* Effect.promise(() => delivered);
            yield* Deferred.succeed(retired, undefined);
            return yield* Stream.runCollect(updates);
          }),
        ),
      );
      expect(data.map((value) => value.get(0)?.time)).toEqual([
        60_000, 120_000,
      ]);
      expect(client!.readyState).not.toBe(WebSocket.OPEN);
    } finally {
      for (const peer of server.clients) peer.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails explicitly when a ready subscription overflows before consumption", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (typeof address !== "object" || address === null)
      throw new Error("Missing server address");
    let ready!: () => void;
    const delivered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let received = 0;
    try {
      await expect(
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const updates = yield* streamBars(
                {
                  bufferCapacity: 1,
                  websocketUrl: `ws://127.0.0.1:${address.port}`,
                  websocket: (url) => {
                    const socket = new WebSocket(url);
                    socket.on("message", () => {
                      if (++received === 2) ready();
                    });
                    return socket;
                  },
                },
                { symbol: "BTCUSDT", interval: "1m" },
                yield* Deferred.make<void>(),
              );
              const peer = [...server.clients][0]!;
              peer.send(message(60_000));
              peer.send(message(120_000));
              yield* Effect.promise(() => delivered);
              return yield* Stream.runCollect(updates);
            }),
          ),
        ),
      ).rejects.toMatchObject({
        reason: { _tag: "Dataset.StreamInterrupted", kind: "overflow" },
      });
    } finally {
      for (const peer of server.clients) peer.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("a refused stream upgrade keeps its status (451: restricted location)", async () => {
    const server = new WebSocketServer({
      port: 0,
      verifyClient: (_info, done) => done(false, 451),
    });
    await once(server, "listening");
    const address = server.address();
    if (typeof address !== "object" || address === null)
      throw new Error("Missing server address");
    try {
      const error = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            return yield* Effect.flip(
              streamBars(
                { websocketUrl: `ws://127.0.0.1:${address.port}` },
                { symbol: "BTCUSDT", interval: "1m" },
                yield* Deferred.make<void>(),
              ),
            );
          }),
        ),
      );
      expect(error.reason._tag).toBe("Dataset.AccessDenied");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("passes interruption to in-flight HTTP", async () => {
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const fetcher: typeof fetch = (_input, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => {
          aborted = true;
          reject(options!.signal!.reason);
        });
        started();
      });
    const controller = new AbortController();
    const result = Effect.runPromise(
      selectBars(
        { fetch: fetcher },
        { symbol: "BTCUSDT", interval: "1m", time: {}, count: 2 },
      ),
      { signal: controller.signal },
    );
    const rejection = expect(result).rejects.toThrow();
    await waiting;
    controller.abort();
    await rejection;
    expect(aborted).toBe(true);
  });
  it("an activation sends reads and streams to the host its probe picks", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (typeof address !== "object" || address === null)
      throw new Error("Missing server address");
    const requested: string[] = [];
    const opened: string[] = [];
    // Only api.binance.com answers its ping, so the probe picks it.
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v3/ping")
        return url.origin === "https://api.binance.com"
          ? Response.json({})
          : new Promise(() => {});
      requested.push(url.origin);
      return Response.json([]);
    };
    const layer = BinanceProvider.makeLayer({
      fetch,
      // Record where each stream goes, then serve it locally.
      websocket: (url) => {
        opened.push(url);
        return new WebSocket(`ws://127.0.0.1:${address.port}`);
      },
    }).pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
      Layer.provide(Layer.succeed(ConfigProviderUpdates, () => Stream.empty)),
    );
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* BinanceProvider;
            const ready = yield* Deferred.make<readonly Dataset[]>();
            yield* provider.watch().pipe(
              Stream.filter((datasets) => datasets.length > 0),
              Stream.runForEach((datasets) =>
                Deferred.succeed(ready, datasets),
              ),
              Effect.forkScoped,
            );
            const bars = (yield* Deferred.await(ready)).find(
              (dataset) => dataset.definition === binanceBars,
            ) as Dataset<typeof binanceBars>;
            const select = bars.select({
              symbol: "BTCUSDT",
              interval: "1m",
              time: {},
              count: 1,
            });
            yield* Effect.promise(() =>
              vi.waitFor(async () => {
                await Effect.runPromise(select);
                expect(requested.at(-1)).toBe("https://api.binance.com");
              }),
            );
            yield* bars.stream({ symbol: "BTCUSDT", interval: "1m" });
            expect(opened).toEqual([
              "wss://stream.binance.com:443/ws/btcusdt@kline_1m",
            ]);
          }),
        ).pipe(Effect.provide(layer)),
      );
    } finally {
      server.close();
    }
  });
});
