// Purpose: Prove complete-window/countBack semantics against sparse native history.
import { Effect, Schema } from "effect";
import { expect, it, vi } from "vitest";
import {
  BarsRequest,
  BarsSnapshot,
  FeedError,
  FeedReasons,
} from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { fromPoints, takeRows, type DataFrame } from "@openchart/timeseries";
import { readBarsHistory } from "./history";

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
  session: "24h",
  adjustment: "raw",
  from: 251,
  to: 501,
  countBack: 300,
});
const rows = fromPoints(
  { symbol: "BTCUSDT" },
  Array.from({ length: 500 }, (_, index) => ({
    time: index + 1,
    open: 2,
    high: 2,
    low: 2,
    close: index === 250 ? NaN : 2,
    volume: 1,
    final: true,
    asOf: 1000,
  })),
);
const select = (data: DataFrame) =>
  vi.fn((bounds: { from?: number; to: number; count?: number }) => {
    const indices = [...data].flatMap(({ time }, index) =>
      time >= (bounds.from ?? -Infinity) && time < bounds.to ? [index] : [],
    );
    return Effect.succeed(
      takeRows(
        data,
        bounds.count === undefined ? indices : indices.slice(-bounds.count),
      ),
    );
  });

it("returns the full range and extends only enough to satisfy countBack, excluding the probe", async () => {
  const read = select(rows);
  const result = await Effect.runPromise(readBarsHistory(request, read));
  expect([...result.data]).toEqual([
    ...takeRows(
      rows,
      Array.from({ length: rows.numRows - 200 }, (_, index) => index + 200),
    ),
  ]);
  expect(result.range).toEqual({ from: 201, to: 501 });
  expect(result.hasMoreBefore).toBe(true);
  expect(read.mock.calls).toEqual([
    [{ from: 251, to: 501 }],
    [{ to: 251, count: 301 }],
  ]);
  expect(Schema.is(BarsSnapshot)(result)).toBe(true);
  const wide = await Effect.runPromise(
    readBarsHistory({ ...request, from: 101 }, select(rows)),
  );
  expect(wide.data.numRows).toBe(400);
  expect(wide.range.from).toBe(101);
});

it("proves exhaustion across empty windows without inventing bars", async () => {
  const sparse = takeRows(rows, [0, 99]);
  const result = await Effect.runPromise(
    readBarsHistory(request, select(sparse)),
  );
  expect([...result.data]).toEqual([...sparse]);
  expect(result.hasMoreBefore).toBe(false);
  expect(result.range.from).toBe(1);
  const empty = await Effect.runPromise(
    readBarsHistory(request, select(takeRows(rows, []))),
  );
  expect(empty).toEqual({
    range: { from: 251, to: 501 },
    data: takeRows(rows, []),
    hasMoreBefore: false,
  });
  const exact = await Effect.runPromise(
    readBarsHistory({ ...request, from: 1, countBack: 500 }, select(rows)),
  );
  expect(exact.hasMoreBefore).toBe(false);
});

it("fails the entire window when probing fails and rejects future-only requests", async () => {
  const failure = new FeedError({
    reason: new FeedReasons.SourceUnavailable({
      provider: ProviderId.make("binance"),
    }),
  });
  const exit = await Effect.runPromise(
    readBarsHistory(request, (bounds) =>
      bounds.count ? Effect.fail(failure) : Effect.succeed(rows),
    ).pipe(Effect.flip),
  );
  expect(exit).toBe(failure);
  const future = await Effect.runPromise(
    readBarsHistory(
      { ...request, from: Date.now() + 100_000, to: "now" },
      select(rows),
    ).pipe(Effect.flip),
  );
  expect(future.reason._tag).toBe("Feed.InvalidRequest");
});
