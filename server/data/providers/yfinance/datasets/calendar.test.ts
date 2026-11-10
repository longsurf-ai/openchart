// Purpose: Verify Yahoo trading periods become exchange-local days, closed dates and cached reads.

import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import { cachedSelectCalendar } from "./calendar";

const s = (iso: string) => Date.parse(iso) / 1000;
const day = (date: string) => ({
  pre: { start: s(`${date}T09:00Z`), end: s(`${date}T14:30Z`) },
  regular: { start: s(`${date}T14:30Z`), end: s(`${date}T21:00Z`) },
  // Post-market ends after UTC midnight but starts on the exchange date.
  post: { start: s(`${date}T21:00Z`), end: s(`${date}T21:00Z`) + 4 * 3600 },
});
const fri = day("2026-11-06");
const mon = day("2026-11-09");
const tue = day("2026-11-10");

function chart() {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            symbol: "AAPL",
            currency: "USD",
            exchangeName: "NMS",
            instrumentType: "EQUITY",
            dataGranularity: "1h",
            exchangeTimezoneName: "America/New_York",
            // The current day also appears in the per-day periods.
            currentTradingPeriod: tue,
            tradingPeriods: {
              pre: [[fri.pre], [mon.pre], [tue.pre]],
              regular: [[fri.regular], [mon.regular], [tue.regular]],
              post: [[fri.post], [mon.post], [tue.post]],
            },
          },
          indicators: { quote: [{}] },
        },
      ],
    },
  };
}

it("groups periods by exchange date, closes the weekend and reads once per hour", async () => {
  const urls: URL[] = [];
  const options = {
    fetch: (async (input) => {
      urls.push(new URL(String(input)));
      return Response.json(chart());
    }) as typeof fetch,
  };
  const now = Date.parse("2026-11-10T09:20:00Z");
  const { rows, again } = await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      const select = yield* cachedSelectCalendar(options);
      const query = {
        symbol: "AAPL",
        time: {
          from: Date.parse("2026-11-07T00:00Z"),
          to: now + 12 * 86_400_000,
        },
      };
      return { rows: yield* select(query), again: yield* select(query) };
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(
    rows.map((row) => [row.date, row.sessions.map((value) => value.type)]),
  ).toEqual([
    // 00:00 UTC on the 7th is still the 6th in New York.
    ["2026-11-06", ["pre", "regular", "post"]],
    ["2026-11-07", []],
    ["2026-11-08", []],
    ["2026-11-09", ["pre", "regular", "post"]],
    ["2026-11-10", ["pre", "regular", "post"]],
  ]);
  expect(rows.at(-1)).toMatchObject({
    timezone: "America/New_York",
    holiday: null,
    sessions: [
      { type: "pre", start: tue.pre.start * 1000, end: tue.pre.end * 1000 },
      { type: "regular" },
      { type: "post", end: tue.post.end * 1000 },
    ],
  });
  expect(again).toEqual(rows);
  expect(urls).toHaveLength(1);
  expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({
    interval: "60m",
    includePrePost: "true",
  });
});

it("requires both time bounds", async () => {
  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const select = yield* cachedSelectCalendar({
        fetch: (() => Promise.reject(new Error("unused"))) as typeof fetch,
      });
      return yield* Effect.flip(select({ symbol: "AAPL", time: { from: 0 } }));
    }),
  );
  expect(failure.reason._tag).toBe("Dataset.InvalidQuery");
});
