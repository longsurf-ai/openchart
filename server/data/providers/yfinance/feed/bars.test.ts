// Purpose: Verify which listings Yahoo offers extended hours for, and that the session reaches the native query.

import { Effect, type Scope } from "effect";
import { expect, test } from "vitest";
import type { BarsRequest } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { yfinanceBars } from "../datasets/definitions/bars";
import { yfinanceBarsFeed } from "./bars";

const provider = ProviderId.make("yfinance");
const aapl = { symbol: "AAPL", currency: "USD", class: "stock" } as const;

const withFeed = <A>(
  run: (
    feed: ReturnType<typeof yfinanceBarsFeed>,
    queries: unknown[],
  ) => Effect.Effect<A, unknown, Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queries: unknown[] = [];
      const dataset = yield* makeDataset(yfinanceBars, {
        select: (query) => {
          queries.push(query);
          return Effect.die("stop after the query");
        },
        stream: () => Effect.die("unused"),
      });
      return yield* run(yfinanceBarsFeed(dataset, provider), queries);
    }).pipe(Effect.scoped),
  );

const sessions = (listing: BarsRequest["listing"], resolution: string) =>
  withFeed((feed) => feed.getCapabilities({ provider, listing })).then(
    (capabilities) =>
      capabilities
        .filter((value) => value.resolution === resolution)
        .map((value) => value.session),
  );

test("US equities offer extended first at every interval; others stay regular", async () => {
  expect(await sessions(aapl, "5m")).toEqual(["extended", "regular"]);
  expect(
    await sessions({ symbol: "SPY", currency: "USD", class: "etf" }, "1h"),
  ).toEqual(["extended", "regular"]);
  expect(await sessions(aapl, "1d")).toEqual(["extended", "regular"]);
  expect(
    await sessions({ symbol: "VOD.L", currency: "GBp", class: "stock" }, "5m"),
  ).toEqual(["regular"]);
  expect(
    await sessions({ symbol: "^GSPC", currency: "USD", class: "index" }, "5m"),
  ).toEqual(["regular"]);
});

test("the extended session asks Yahoo for intraday pre- and post-market bars", async () => {
  const request = (
    session: BarsRequest["session"],
    resolution: BarsRequest["resolution"] = "5m",
  ): BarsRequest => ({
    provider,
    listing: aapl,
    resolution,
    session,
    adjustment: "split",
    from: 0,
    to: 300_000,
    countBack: 1,
  });
  const queries = await withFeed((feed, queries) =>
    Effect.gen(function* () {
      yield* Effect.exit(feed.observe(request("regular")));
      yield* Effect.exit(feed.observe(request("extended")));
      yield* Effect.exit(feed.observe(request("extended", "1d")));
      return queries;
    }),
  );
  expect(queries).toMatchObject([
    { symbol: "AAPL", interval: "5m", includePrePost: false },
    { symbol: "AAPL", interval: "5m", includePrePost: true },
    { symbol: "AAPL", interval: "1d", includePrePost: false },
  ]);
});
