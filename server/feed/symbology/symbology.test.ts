// Purpose: Verify local-first search, asynchronous ownership and serialized provider writes.
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { FeedError, FeedReasons } from "@openchart/feed";
import { ProviderListing } from "@openchart/market";
import { Database } from "@openchart/server/db";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { symbologyResource } from "@openchart/server/resources/symbology";
import { SymbolIndexUnavailable } from "./errors";
import { SymbologyIndex } from "./symbology";

const hit = Schema.decodeUnknownSync(ProviderListing)({
  provider: "binance",
  listing: { symbol: "BTCUSDT", currency: "USDT" },
});
const request = { query: "BTC", indexed: true, limit: 10 } as const;
const indexRequest = { providerId: "binance", filter: {} } as const;
function runtime(filename = ":memory:") {
  return ManagedRuntime.make(
    SymbologyIndex.layer.pipe(
      Layer.provideMerge(Database.layer(filename, () => Effect.void)),
    ),
  );
}

test("live and indexed searches both retain listings with identical symbols and distinct native IDs", async () => {
  const rt = runtime();
  try {
    const listings = Schema.decodeUnknownSync(Schema.Array(ProviderListing))([
      {
        provider: "openchart",
        listing: {
          id: 10244,
          symbol: "SPCX",
          name: "The SPAC and New Issue ETF",
          venue: "NASDAQ",
          currency: "USD",
        },
      },
      {
        provider: "openchart",
        listing: {
          id: 55090,
          symbol: "SPCX",
          name: "Space Exploration Technologies Corp.",
          venue: "NASDAQ",
          currency: "USD",
        },
      },
      {
        provider: "yfinance",
        listing: { symbol: "SPCX", venue: "NMS", currency: "USD" },
      },
    ]);
    const owner = await rt.runPromise(SymbologyIndex);
    const search = vi.fn(() => Effect.succeed(listings.slice(0, 2)));
    const feed = owner.provision([
      { providerId: listings[0]!.provider, search },
      {
        providerId: listings[2]!.provider,
        search: () => Effect.succeed([listings[2]!]),
      },
    ]);
    const query = { query: "spcx", limit: 30, indexed: false };
    const live = await rt.runPromise(feed.search(query));
    expect(live).toHaveLength(3);
    expect(live).toEqual(expect.arrayContaining([...listings]));
    expect(
      await rt.runPromise(feed.search({ ...query, indexed: true })),
    ).toEqual(live);
    expect(search).toHaveBeenCalledTimes(1);
  } finally {
    await rt.dispose();
  }
});

test("shutdown interrupts an unfinished run; restart retains listings and resets runtime status", async () => {
  const filename = `${temporaryHome()}/symbols.sqlite3`;
  const rt = runtime(filename);
  const started = Deferred.makeUnsafe<void>();
  let interrupted = false;
  const owner = await rt.runPromise(SymbologyIndex);
  const feed = owner.provision([
    {
      providerId: hit.provider,
      search: () => Effect.succeed([hit]),
      select: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
    },
  ]);
  await rt.runPromise(feed.search(request));
  await rt.runPromise(feed.index(indexRequest));
  await rt.runPromise(Deferred.await(started));
  await rt.dispose();
  expect(interrupted).toBe(true);
  const restarted = runtime(filename);
  try {
    const next = (await restarted.runPromise(SymbologyIndex)).provision([
      {
        providerId: hit.provider,
        search: () => Effect.die("Saved hit must not fetch"),
      },
    ]);
    expect((await restarted.runPromise(next.indexStatus()))[0]?.job).toEqual({
      state: "idle",
    });
    expect(await restarted.runPromise(next.search(request))).toEqual([hit]);
  } finally {
    await restarted.dispose();
  }
});

test("a cache miss writes through; hits skip I/O; live mode refreshes; unavailable providers stay excluded", async () => {
  const rt = runtime();
  try {
    const owner = await rt.runPromise(SymbologyIndex);
    const search = vi.fn(() => Effect.succeed([hit]));
    const feed = owner.provision([{ providerId: hit.provider, search }]);
    expect(await rt.runPromise(feed.search(request))).toEqual([hit]);
    expect(await rt.runPromise(feed.search(request))).toEqual([hit]);
    expect(search).toHaveBeenCalledTimes(1);
    await rt.runPromise(feed.search({ ...request, indexed: false }));
    expect(search).toHaveBeenCalledTimes(2);
    expect(
      await rt.runPromise(
        owner.provision([]).search(request).pipe(Effect.flip),
      ),
    ).toMatchObject({ reason: { _tag: "Feed.SourceUnavailable" } });
    expect(
      await rt.runPromise(
        Transactor.run(symbologyResource.transitions.counts()),
      ),
    ).toEqual([{ provider: "binance", count: 1 }]);
  } finally {
    await rt.dispose();
  }
});

test("the exact symbol ranks first, then symbol and name prefixes, before the limit applies", async () => {
  const rt = runtime();
  try {
    const listings = Schema.decodeUnknownSync(Schema.Array(ProviderListing))(
      [
        ["ACBE", "Pacer Metaurus Enhanced Core Income Autocallable ETF"],
        ["AMBP", "Ardagh Metal Packaging S.A."],
        ["MMAT", "Meta Materials Inc."],
        ["METAX", "Example Meta Bull ETF"],
        ["META", "Meta Platforms, Inc."],
      ].map(([symbol, name]) => ({
        provider: "openchart",
        listing: { symbol, name, currency: "USD" },
      })),
    );
    const owner = await rt.runPromise(SymbologyIndex);
    const feed = owner.provision([
      { providerId: hit.provider, search: () => Effect.succeed(listings) },
    ]);
    const meta = { query: "meta", limit: 4 } as const;
    const expected = ["META", "METAX", "MMAT", "ACBE"];
    const symbols = async (indexed: boolean) =>
      (await rt.runPromise(feed.search({ ...meta, indexed }))).map(
        (found) => found.listing.symbol,
      );
    expect(await symbols(false)).toEqual(expected);
    // Saved listings answer the indexed search with the same order.
    expect(await symbols(true)).toEqual(expected);
  } finally {
    await rt.dispose();
  }
});

test("duplicate starts share a job across Feed generations and failed enumeration preserves saved listings", async () => {
  const rt = runtime();
  const pending = Deferred.makeUnsafe<readonly (typeof hit)[], FeedError>();
  const started = Deferred.makeUnsafe<void>();
  try {
    const owner = await rt.runPromise(SymbologyIndex);
    const source = {
      providerId: hit.provider,
      search: () => Effect.succeed([hit]),
      select: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(pending)),
        ),
    };
    const feed = owner.provision([source]);
    await rt.runPromise(feed.search(request));
    const [one, two] = await Promise.all([
      rt.runPromise(feed.index(indexRequest)),
      rt.runPromise(feed.index(indexRequest)),
    ]);
    expect(one).toEqual(two);
    await rt.runPromise(Deferred.await(started));
    expect(
      await rt.runPromise(
        feed
          .index({ ...indexRequest, filter: { quoteAsset: "EUR" } })
          .pipe(Effect.flip),
      ),
    ).toMatchObject({ reason: { _tag: "Feed.InvalidRequest" } });
    expect(
      (await rt.runPromise(owner.provision([]).indexStatus()))[0]?.job,
    ).toMatchObject({ state: "running", runId: one.runId });
    await rt.runPromise(
      Deferred.fail(
        pending,
        new FeedError({
          reason: new FeedReasons.RateLimited({ provider: hit.provider }),
        }),
      ),
    );
    await vi.waitFor(async () =>
      expect((await rt.runPromise(feed.indexStatus()))[0]?.job).toMatchObject({
        state: "failed",
        reason: { _tag: "Feed.RateLimited", provider: "binance" },
      }),
    );
    expect(await rt.runPromise(feed.search(request))).toEqual([hit]);
  } finally {
    await rt.dispose();
  }
});

test("an older search finishes before replacement, so it cannot restore deleted listings", async () => {
  const rt = runtime();
  const searchStarted = Deferred.makeUnsafe<void>();
  const finishSearch = Deferred.makeUnsafe<void>();
  const select = vi.fn(() => Effect.succeed([]));
  try {
    const owner = await rt.runPromise(SymbologyIndex);
    const feed = owner.provision([
      {
        providerId: hit.provider,
        search: () =>
          Deferred.succeed(searchStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishSearch)),
            Effect.as([hit]),
          ),
        select,
      },
    ]);
    const searching = rt.runPromise(
      feed.search({ ...request, indexed: false }),
    );
    await rt.runPromise(Deferred.await(searchStarted));
    await rt.runPromise(feed.index(indexRequest));
    expect(select).not.toHaveBeenCalled();
    await rt.runPromise(Deferred.succeed(finishSearch, undefined));
    await searching;
    await vi.waitFor(async () =>
      expect((await rt.runPromise(feed.indexStatus()))[0]?.job.state).toBe(
        "succeeded",
      ),
    );
    expect(
      await rt.runPromise(
        Transactor.run(symbologyResource.transitions.listAll()),
      ),
    ).toEqual([]);
  } finally {
    await rt.dispose();
  }
});

test("index storage failures fail searches without dying and fail jobs without a public reason", async () => {
  const rt = runtime();
  try {
    const owner = await rt.runPromise(SymbologyIndex);
    const feed = owner.provision([
      {
        providerId: hit.provider,
        search: () => Effect.succeed([hit]),
        select: () => Effect.succeed([hit]),
      },
    ]);
    await rt.runPromise(
      Effect.flatMap(Database.Service, ({ db }) =>
        db.run("DROP TABLE symbology"),
      ),
    );
    expect(
      await rt.runPromise(feed.search(request).pipe(Effect.flip)),
    ).toBeInstanceOf(SymbolIndexUnavailable);
    await rt.runPromise(feed.index(indexRequest));
    await vi.waitFor(async () =>
      expect((await rt.runPromise(feed.indexStatus()))[0]?.job.state).toBe(
        "failed",
      ),
    );
    expect(
      (await rt.runPromise(feed.indexStatus()))[0]?.job,
    ).not.toHaveProperty("reason");
  } finally {
    await rt.dispose();
  }
});
