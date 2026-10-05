// Purpose: Lock which Feed failures raise the Cloud offer and how the cooldown paces it.
import { FeedError, FeedReasons, type FeedReason } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { beforeEach, expect, test } from "vitest";
import {
  cloudSolves,
  offerCooldownMs,
  useUpsell,
} from "@openchart/app/lib/upsell/upsell";

const yahoo = ProviderId.make("yfinance");
const binance = ProviderId.make("binance");
const cloud = ProviderId.make("openchart");
const failure = (reason: FeedReason) => new FeedError({ reason });

beforeEach(() => {
  useUpsell.setState({ pending: false, open: false, lastShownAt: undefined });
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
  expect(useUpsell.getState().pending).toBe(false);

  report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(1_000);
  expect(useUpsell.getState()).toMatchObject({
    pending: false,
    open: true,
    lastShownAt: 1_000,
  });
  close();

  report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(1_000 + offerCooldownMs - 1);
  expect(useUpsell.getState()).toMatchObject({ pending: false, open: false });

  report(failure(new FeedReasons.RateLimited({ provider: yahoo })));
  present(1_000 + offerCooldownMs);
  expect(useUpsell.getState()).toMatchObject({
    open: true,
    lastShownAt: 1_000 + offerCooldownMs,
  });
});
