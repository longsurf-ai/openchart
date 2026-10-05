// Purpose: Lock which Feed failures raise the Cloud offer and how the cooldown paces it.
import { FeedError, FeedReasons, type FeedReason } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { beforeEach, expect, test } from "vitest";
import {
  cloudOffersOption,
  cloudSolves,
  offerCooldownMs,
  reportLockedOption,
  useUpsell,
} from "@openchart/app/lib/upsell/upsell";

const yahoo = ProviderId.make("yfinance");
const binance = ProviderId.make("binance");
const cloud = ProviderId.make("openchart");
const failure = (reason: FeedReason) => new FeedError({ reason });

beforeEach(() => {
  useUpsell.setState({
    pending: undefined,
    open: false,
    lastShownAt: undefined,
  });
});

test("only failures Cloud removes raise the offer", () => {
  const cases: [FeedReason, boolean][] = [
    [
      new FeedReasons.HistoryUnavailable({ provider: yahoo, availableFrom: 0 }),
      true,
    ],
    [new FeedReasons.RateLimited({ provider: yahoo }), true],
    [new FeedReasons.RateLimited({ provider: binance }), true],
    [new FeedReasons.AccessDenied({ provider: cloud }), true],
    [
      new FeedReasons.HistoryUnavailable({ provider: cloud, availableFrom: 0 }),
      false,
    ],
    [new FeedReasons.RateLimited({ provider: cloud }), false],
    [new FeedReasons.AccessDenied({ provider: yahoo }), false],
    [new FeedReasons.NotFound({ provider: yahoo }), false],
    [new FeedReasons.SourceUnavailable({ provider: yahoo }), false],
  ];
  expect(cases.map(([reason]) => cloudSolves(failure(reason)))).toEqual(
    cases.map(([, expected]) => expected),
  );
});

test("a reported moment shows once, then waits out the three-day cooldown", () => {
  const { report, present, close } = useUpsell.getState();
  report(failure(new FeedReasons.NotFound({ provider: yahoo })));
  expect(useUpsell.getState().pending).toBeUndefined();

  report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(1_000);
  expect(useUpsell.getState()).toMatchObject({
    pending: undefined,
    open: true,
    lastShownAt: 1_000,
  });
  close();

  report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(1_000 + offerCooldownMs - 1);
  expect(useUpsell.getState()).toMatchObject({
    pending: undefined,
    open: false,
  });

  report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(1_000 + offerCooldownMs);
  expect(useUpsell.getState()).toMatchObject({
    open: true,
    lastShownAt: 1_000 + offerCooldownMs,
  });
});

test("locked chart options raise the offer only where Cloud offers them", () => {
  const stock = { provider: yahoo, listingClass: "stock" as const };
  expect([
    cloudOffersOption("resolution", stock),
    cloudOffersOption("session", stock),
    cloudOffersOption("adjustment", stock),
    // Crypto has no sessions or splits.
    cloudOffersOption("session", {
      provider: binance,
      listingClass: "crypto",
    }),
    cloudOffersOption("adjustment", {
      provider: binance,
      listingClass: "crypto",
    }),
    cloudOffersOption("resolution", {
      provider: binance,
      listingClass: "crypto",
    }),
    // A chart already on Cloud has nothing to upgrade to.
    cloudOffersOption("resolution", { provider: cloud }),
  ]).toEqual([true, true, true, false, false, true, false]);

  reportLockedOption("session", {
    provider: binance,
    listingClass: "crypto",
  });
  expect(useUpsell.getState().pending).toBeUndefined();
});

test("choosing a locked option shows the offer every time, despite the cooldown", () => {
  const stock = { provider: yahoo, listingClass: "stock" as const };
  const { present, close } = useUpsell.getState();
  for (const now of [1_000, 2_000, 3_000]) {
    reportLockedOption("resolution", stock);
    expect(useUpsell.getState().pending).toBe("request");
    present(now);
    expect(useUpsell.getState()).toMatchObject({
      open: true,
      lastShownAt: now,
    });
    close();
  }
  // A failure right after still respects the cooldown the request started.
  useUpsell
    .getState()
    .report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(4_000);
  expect(useUpsell.getState()).toMatchObject({
    open: false,
    lastShownAt: 3_000,
  });
});
