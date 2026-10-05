// Purpose: Prove Binance session health: pings keep idle sockets alive, silence fails, late data degrades.

import type { DatasetFailure } from "@openchart/server/data/dataset";
import { Monitoring } from "@openchart/server/monitoring";
import { Deferred, Effect, Stream } from "effect";
import { TestClock } from "effect/testing";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { streamBars } from "./bars";

const NOW = 1_790_000_000_000;
const kline = (eventTime: number) =>
  JSON.stringify({
    e: "kline",
    E: eventTime,
    s: "BTCUSDT",
    k: {
      t: eventTime - 30_000,
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

/** Opens one monitored subscription against a local server that sends nothing unless told. */
async function session<A>(
  program: (tools: {
    readonly updates: Stream.Stream<unknown, DatasetFailure>;
    readonly peer: WebSocket;
    readonly client: () => WebSocket;
    readonly health: () => Monitoring.Health | undefined;
  }) => Effect.Effect<A, unknown[]>,
) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || address === null)
    throw new Error("Missing server address");
  let client: WebSocket | undefined;
  try {
    return await Effect.runPromise(
      TestClock.setTime(NOW).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const monitoring = yield* Monitoring.Service;
            const updates = yield* streamBars(
              {
                websocketUrl: `ws://127.0.0.1:${address.port}`,
                websocket: (url) => (client = new WebSocket(url)),
              },
              { symbol: "BTCUSDT", interval: "1m" },
              yield* Deferred.make<void>(),
            ).pipe(
              Effect.provideService(
                Monitoring.Reporter,
                monitoring.reporter("alert/a1", "BTC > 70k"),
              ),
            );
            const health = () =>
              Effect.runSync(monitoring.status)[0]?.checks[0]?.health;
            const peer = [...server.clients][0]!;
            // Opening alone proves nothing: the check starts unknown.
            yield* TestClock.adjust("5 seconds");
            expect(health()).toMatchObject({
              state: "unknown",
              reason: { code: "starting" },
            });
            const pinged = once(client!, "ping");
            peer.ping();
            yield* Effect.promise(() => pinged);
            yield* TestClock.adjust("5 seconds");
            yield* Effect.promise(() =>
              vi.waitFor(() => expect(health()?.state).toBe("healthy")),
            );
            return yield* program({
              updates,
              peer,
              client: () => client!,
              health,
            });
          }),
        ),
        Effect.scoped,
        Effect.provide(Monitoring.layer),
        Effect.provide(TestClock.layer()),
      ),
    );
  } finally {
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it("an idle pair stays healthy on pings; 45 s without any frame fails the stream", async () => {
  const error = await session(({ updates, peer, client, health }) =>
    Effect.gen(function* () {
      yield* TestClock.adjust("30 seconds");
      const pinged = once(client(), "ping");
      peer.ping();
      yield* Effect.promise(() => pinged);
      yield* TestClock.adjust("40 seconds");
      expect(health()).toEqual({ state: "healthy" });
      yield* TestClock.adjust("10 seconds");
      return yield* Stream.runCollect(updates).pipe(Effect.flip);
    }),
  );
  expect(error).toMatchObject({
    reason: { _tag: "Dataset.Unavailable" },
    cause: "Binance stopped sending data.",
  });
});

it("a late kline degrades only while it is recent; pings then restore health", async () => {
  const [late, later] = await session(({ peer, client, health }) =>
    Effect.gen(function* () {
      const received = once(client(), "message");
      // Session setup advanced the clock 10 s: this kline's event time is 20 s old.
      peer.send(kline(NOW - 10_000));
      yield* Effect.promise(() => received);
      yield* TestClock.adjust("5 seconds");
      const late = health();
      const pinged = once(client(), "ping");
      peer.ping();
      yield* Effect.promise(() => pinged);
      yield* TestClock.adjust("15 seconds");
      return [late, health()] as const;
    }),
  );
  expect(late).toEqual({
    state: "degraded",
    reason: {
      code: "late",
      message: "Binance data is arriving more than 10 seconds late.",
    },
  });
  expect(later).toEqual({ state: "healthy" });
});
