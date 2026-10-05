// Purpose: Lock the public Feed failure wire shape, retryability and wording.

import { ProviderId } from "@openchart/market";
import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  ClientFailures,
  describeFailure,
  FeedError,
  FeedReason,
  FeedReasons,
} from "./index";

const provider = ProviderId.make("yfinance");
const reasons = [
  [
    new FeedReasons.InvalidRequest({
      detail: "Bars from must precede the cutoff",
    }),
    false,
  ],
  [new FeedReasons.Unsupported({ provider }), false],
  [new FeedReasons.HistoryUnavailable({ provider, availableFrom: 0 }), false],
  [new FeedReasons.NotFound({ provider }), false],
  [new FeedReasons.AccessDenied({ provider }), false],
  [new FeedReasons.RateLimited({ provider }), true],
  [new FeedReasons.SourceUnavailable({}), true],
  [new FeedReasons.SourceUnavailable({ provider }), true],
  [new FeedReasons.InvalidSourceData({ provider }), false],
  [new FeedReasons.ResyncRequired({ provider }), true],
  [new FeedReasons.Reconfigured({ provider }), true],
] as const;

test("every reason round-trips through the wire shape with its retryability and wording", () => {
  for (const [reason, retryable] of reasons) {
    const error = new FeedError({ reason });
    const wire: unknown = JSON.parse(
      JSON.stringify(Schema.encodeSync(FeedError)(error)),
    );
    const decoded = Schema.decodeUnknownSync(FeedError)(wire);
    expect(decoded).toBeInstanceOf(FeedError);
    expect(decoded.reason._tag).toBe(reason._tag);
    expect(decoded.isRetryable).toBe(retryable);
    expect(decoded.message).toBe(describeFailure(reason));
    expect(decoded.message.length).toBeGreaterThan(0);
  }
});

test("a server-only cause is kept locally but never encoded", () => {
  const error = Object.assign(
    new FeedError({ reason: new FeedReasons.NotFound({ provider }) }),
    { cause: new Error("upstream secret") },
  );
  expect(error.cause).toBeInstanceOf(Error);
  expect(JSON.stringify(Schema.encodeSync(FeedError)(error))).not.toContain(
    "secret",
  );
});

test("unknown reasons fail to decode", () => {
  expect(() =>
    Schema.decodeUnknownSync(FeedError)({
      _tag: "FeedError",
      reason: { _tag: "Feed.Unknown" },
    }),
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(FeedReason)({ _tag: "Feed.NotFound" }),
  ).toThrow();
});

test("client failures have wording and retryability but no public reason", () => {
  for (const [failure, retryable] of [
    [new ClientFailures.Cancelled(), false],
    [new ClientFailures.Disconnected(), true],
    [new ClientFailures.InvalidResponse(), false],
    [new ClientFailures.Internal(), true],
  ] as const) {
    expect(failure.isRetryable).toBe(retryable);
    expect(failure.message).toBe(describeFailure(failure));
    expect(failure.message.length).toBeGreaterThan(0);
    expect(Schema.is(FeedReason)(failure)).toBe(false);
  }
});

test("wording names the provider and the retained history start", () => {
  expect(
    describeFailure(
      new FeedReasons.HistoryUnavailable({
        provider,
        availableFrom: 1754006400000,
      }),
    ),
  ).toBe("Yahoo Finance only keeps this data from 2025-08-01.");
});
