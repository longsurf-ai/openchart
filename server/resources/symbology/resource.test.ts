// Purpose: Verify uniqueness, immutable public surface and atomic scoped reconciliation.
import { Effect, ManagedRuntime, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ProviderListing } from "@openchart/market";
import { Database } from "@openchart/server/db";
import { Transactor, Transition } from "@openchart/server/lib/resource";
import { symbologyResource, upsertListings, replaceScope } from "./resource";

const runtime = () =>
  ManagedRuntime.make(Database.layer(":memory:", () => Effect.void));
let db = runtime();
afterEach(async () => {
  await db.dispose();
  db = runtime();
});
const hit = (
  symbol: string,
  currency = "USDT",
  provider = "binance",
  venue?: string,
) =>
  Schema.decodeUnknownSync(ProviderListing)({
    provider,
    listing: { symbol, currency, ...(venue === undefined ? {} : { venue }) },
  });
const list = () =>
  db.runPromise(Transactor.run(symbologyResource.transitions.listAll()));

test("native IDs preserve same-symbol listings and stable Resource IDs across metadata changes", async () => {
  const listings = [10244, 55090].map((id) => ({
    ...hit("SPCX", "USD", "openchart", "NASDAQ"),
    listing: { id, symbol: "SPCX", currency: "USD", venue: "NASDAQ" },
  }));
  await db.runPromise(Transactor.run(upsertListings(listings)));
  const before = await list();
  expect(before).toHaveLength(2);
  await db.runPromise(Transactor.run(upsertListings(listings)));
  expect(await list()).toEqual(before);
  const updated = {
    ...listings[0]!,
    listing: { ...listings[0]!.listing, symbol: "NEW", venue: "NYSE" },
  };
  await db.runPromise(Transactor.run(upsertListings([updated])));
  expect(await list()).toEqual([
    {
      ...before[0],
      listing: updated.listing,
      revision: 2,
      updatedAt: expect.any(Number),
    },
    before[1],
  ]);
  const saved = await list();
  await expect(
    db.runPromise(Transactor.run(upsertListings([updated, updated]))),
  ).rejects.toThrow("duplicate identities");
  expect(await list()).toEqual(saved);
});

test("read-only Resource retains stable IDs/revisions and distinct provider/venue identities", async () => {
  expect(symbologyResource.readOnly).toBe(true);
  expect(Object.keys(symbologyResource.transitionDefinitions)).not.toContain(
    "upsertListings",
  );
  const hits = [
    hit("BTC"),
    hit("BTC", "USD", "yfinance"),
    hit("BTC", "USDT", "binance", ""),
  ];
  await db.runPromise(Transactor.run(upsertListings(hits)));
  const before = await list();
  await db.runPromise(Transactor.run(upsertListings(hits)));
  expect(await list()).toEqual(before);
  expect(before).toHaveLength(3);
  await db.runPromise(Transactor.run(upsertListings([hit("BTC", "EUR")])));
  expect((await list()).find((row) => row.id === before[0]!.id)?.revision).toBe(
    2,
  );
});

test("replacement clears only its complete scope and rejects corrupt batches atomically", async () => {
  await db.runPromise(
    Transactor.run(
      upsertListings([
        hit("OLD"),
        hit("KEEP", "EUR"),
        hit("OTHER", "USD", "yfinance"),
      ]),
    ),
  );
  const before = await list();
  await expect(
    db.runPromise(
      Transactor.run(
        replaceScope(
          { providerId: "binance", filter: { quoteAsset: "USDT" } },
          [hit("NEW"), hit("BAD", "EUR")],
        ),
      ),
    ),
  ).rejects.toThrow("out-of-scope");
  expect(await list()).toEqual(before);
  await db.runPromise(
    Transactor.run(
      replaceScope(
        { providerId: "binance", filter: { quoteAsset: "USDT" } },
        [],
      ),
    ),
  );
  expect((await list()).map((row) => row.listing.symbol)).toEqual([
    "KEEP",
    "OTHER",
  ]);
  await db.runPromise(Transactor.run(upsertListings([])));
  expect(
    await db.runPromise(Transactor.run(symbologyResource.transitions.counts())),
  ).toEqual([
    { provider: "binance", count: 1 },
    { provider: "yfinance", count: 1 },
  ]);
});

test("transaction interruption/failure cannot publish a partial snapshot", async () => {
  await db.runPromise(Transactor.run(upsertListings([hit("OLD")])));
  const before = await list();
  const replacement = replaceScope({ providerId: "binance", filter: {} }, [
    hit("NEW"),
  ]);
  await expect(
    db.runPromise(
      Transactor.run(
        Transition.from((tx) =>
          replacement
            .apply(tx, undefined)
            .pipe(Effect.andThen(Effect.fail("rollback"))),
        ),
      ),
    ),
  ).rejects.toThrow();
  expect(await list()).toEqual(before);
});
