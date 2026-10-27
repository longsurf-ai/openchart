// Purpose: Keep delayed revisions and newly published intervals visible through ready TradingView Datasets.

import { EventEmitter } from "node:events";
import { ConfigProvider, Deferred, Effect, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import type WebSocket from "ws";
import { Integration } from "@openchart/server/access/integration";
import type { Dataset } from "@openchart/server/data/dataset";
import {
  decodeFrame,
  encodeFrame,
  parseFrames,
  type Candle,
} from "../protocol";
import { TradingViewProvider } from "../tradingview";
import { tradingviewBars } from "./definitions";

const minute = 60_000;
const now = Date.UTC(2026, 9, 27, 14);
const bar = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});
const key = {
  symbol: "SP:SPX",
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
} as const;

class HistorySocket extends EventEmitter {
  readyState = 1;
  terminated = false;

  constructor(private readonly rows: readonly Candle[]) {
    super();
    queueMicrotask(() => this.emit("open"));
  }

  send(data: string) {
    for (const payload of parseFrames(data)) {
      const command = decodeFrame(payload);
      if (command.kind !== "message") continue;
      const session = command.parameters[0];
      if (command.method === "create_series")
        this.emit(
          "message",
          Buffer.from(
            encodeFrame("timescale_update", [
              session,
              {
                sds_1: {
                  s: this.rows.map((row) => ({
                    v: [
                      row.time / 1000,
                      row.open,
                      row.high,
                      row.low,
                      row.close,
                      row.volume,
                    ],
                  })),
                },
              },
            ]),
          ),
        );
      if (
        ["create_series", "modify_series", "request_more_data"].includes(
          command.method,
        )
      )
        this.emit(
          "message",
          Buffer.from(
            encodeFrame("series_completed", [
              session,
              "sds_1",
              "delayed_streaming_600",
              "s1",
              {},
            ]),
          ),
        );
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const unused = () => Effect.die("Unexpected Integration operation");
const integrations = Layer.mock(Integration.Service, {
  connection: {
    resolveCredential: () => Effect.succeed(undefined),
    getSavedCredential: unused,
    setActive: unused,
    setApiKey: unused,
    disconnect: unused,
  },
  oauthAttempt: {
    start: unused,
    getStatus: unused,
    complete: unused,
    cancel: unused,
  },
});

function fixture(rows: () => readonly Candle[]) {
  const sockets: HistorySocket[] = [];
  const layer = TradingViewProvider.makeLayer({
    fetch: () => Promise.reject(new Error("Unexpected HTTP request")),
    websocket: () => {
      const socket = new HistorySocket(rows());
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  }).pipe(
    Layer.provide(integrations),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  );
  return { layer, sockets };
}

// Keep the activation watch alive while exercising its actual ready Dataset.
const readyBars = Effect.fn(function* () {
  const provider = yield* TradingViewProvider;
  const ready = yield* Deferred.make<Dataset<typeof tradingviewBars>>();
  yield* provider.watch().pipe(
    Stream.runForEach((datasets) => {
      const bars = datasets.find(
        (dataset) => dataset.definition === tradingviewBars,
      ) as Dataset<typeof tradingviewBars> | undefined;
      return bars === undefined ? Effect.void : Deferred.succeed(ready, bars);
    }),
    Effect.forkScoped,
  );
  return yield* Deferred.await(ready);
});

test("ready Dataset rereads delayed bars that can still revise behind the wall clock", async () => {
  let upstream = [bar(now - 10 * minute, 100)];
  const f = fixture(() => upstream);
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      const bars = yield* readyBars();
      const query = { ...key, time: { from: now - 20 * minute, to: now } };
      expect([...(yield* bars.select(query))].map((row) => row.close)).toEqual([
        100,
      ]);
      yield* TestClock.adjust("1 minute");
      upstream = [bar(now - 10 * minute, 101), bar(now - 9 * minute, 102)];
      expect([...(yield* bars.select(query))].map((row) => row.close)).toEqual([
        101, 102,
      ]);
      expect(f.sockets).toHaveLength(2);
      expect(f.sockets.every((socket) => socket.terminated)).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(f.layer),
      Effect.provide(TestClock.layer()),
    ),
  );
});

test("ready Dataset rereads an empty delayed interval after its bars are published", async () => {
  let upstream: readonly Candle[] = [];
  const f = fixture(() => upstream);
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      const bars = yield* readyBars();
      const query = {
        ...key,
        time: { from: now - 8 * minute, to: now - 2 * minute },
      };
      expect((yield* bars.select(query)).numRows).toBe(0);
      yield* TestClock.adjust("8 minutes");
      upstream = [bar(now - 7 * minute, 103)];
      expect(
        [...(yield* bars.select(query))].map(({ time, close }) => ({
          time,
          close,
        })),
      ).toEqual(upstream.map(({ time, close }) => ({ time, close })));
      expect(f.sockets).toHaveLength(2);
      expect(f.sockets.every((socket) => socket.terminated)).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(f.layer),
      Effect.provide(TestClock.layer()),
    ),
  );
});
