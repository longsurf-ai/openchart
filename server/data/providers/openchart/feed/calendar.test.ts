// Purpose: Prove Cloud calendar rows reach consumers as provider-routed trading days.
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProviderId } from "@openchart/market";
import type { CalendarRequest } from "@openchart/feed";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { calendarFeed } from "@openchart/server/feed/calendar/calendar";
import type { Client } from "@openchart/server/data/providers/openchart/contract";
import { cachedSelectCalendar } from "@openchart/server/data/providers/openchart/datasets/calendar";
import { openchartCalendar } from "@openchart/server/data/providers/openchart/datasets/definitions";
import { OpenChartRejected } from "@openchart/server/data/providers/openchart/errors";
import { calendarResponse } from "@openchart/server/data/providers/openchart/client.test-utils";

const request: CalendarRequest = {
  provider: ProviderId.make("openchart"),
  listing: { id: 10244, symbol: "AAPL", currency: "USD", venue: "NASDAQ" },
  start: Date.parse("2026-11-26T05:00Z"),
  end: Date.parse("2026-11-28T05:00Z"),
  timezone: "Asia/Shanghai",
};

function serve(readCalendar: Client["readCalendar"]) {
  const client = { readCalendar } as Client;
  return <A, E>(
    use: (feed: ReturnType<typeof calendarFeed>) => Effect.Effect<A, E>,
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const dataset = yield* makeDataset(openchartCalendar, {
            select: yield* cachedSelectCalendar(client),
          });
          return yield* use(calendarFeed([dataset]));
        }),
      ),
    );
}

test("expands the listing's calendar once and labels days in the consumer zone", async () => {
  const reads: number[] = [];
  const run = serve((listing) => {
    reads.push(listing);
    return Effect.succeed(calendarResponse);
  });
  const [first, second] = await run((feed) =>
    Effect.all([feed.getCalendar(request), feed.getCalendar(request)]),
  );
  expect(reads).toEqual([10244]);
  expect(second).toEqual(first);
  expect(first).toEqual({
    venue: "NASDAQ",
    calendar: "NYSE",
    timezone: "Asia/Shanghai",
    days: [
      { date: Date.parse("2026-11-25T16:00Z"), sessions: [] },
      {
        date: Date.parse("2026-11-26T16:00Z"),
        sessions: [
          {
            type: "pre",
            start: Date.parse("2026-11-27T09:00Z"),
            end: Date.parse("2026-11-27T14:30Z"),
          },
          {
            type: "regular",
            start: Date.parse("2026-11-27T14:30Z"),
            end: Date.parse("2026-11-27T18:00Z"),
          },
          {
            type: "post",
            start: Date.parse("2026-11-27T18:00Z"),
            end: Date.parse("2026-11-28T01:00Z"),
          },
        ],
      },
    ],
  });
});

test("rejects requests it cannot resolve and never routes to another provider", async () => {
  const run = serve(() => Effect.succeed(calendarResponse));
  const failure = (input: CalendarRequest) =>
    run((feed) => Effect.flip(feed.getCalendar(input))).then(
      (error) => error.reason,
    );
  expect(
    await failure({ ...request, listing: { symbol: "AAPL", currency: "USD" } }),
  ).toMatchObject({ _tag: "Feed.InvalidRequest" });
  expect(await failure({ ...request, timezone: "Mars/Base" })).toMatchObject({
    _tag: "Feed.InvalidRequest",
  });
  expect(
    await failure({ ...request, provider: ProviderId.make("yfinance") }),
  ).toMatchObject({ _tag: "Feed.SourceUnavailable", provider: "yfinance" });
});

test("Cloud failures stay provider failures and are retried on the next read", async () => {
  let reads = 0;
  const run = serve(() => {
    reads++;
    return Effect.fail(new OpenChartRejected({ status: 503 }));
  });
  const reasons = await run((feed) =>
    Effect.all([
      Effect.flip(feed.getCalendar(request)),
      Effect.flip(feed.getCalendar(request)),
    ]),
  );
  expect(reasons.map((error) => error.reason)).toMatchObject([
    { _tag: "Feed.SourceUnavailable", provider: "openchart" },
    { _tag: "Feed.SourceUnavailable", provider: "openchart" },
  ]);
  expect(reads).toBe(2);
});
