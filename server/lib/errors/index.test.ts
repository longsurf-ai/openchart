// Purpose: Verify public Feed and Tea failures are classified and encoded without their cause.

import { FeedReasons } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { feedError } from "@openchart/server/feed/errors";
import { teaError } from "@openchart/server/tea/errors";
import * as Tea from "@openchart/tea";
import { Schema } from "effect";
import { expect, test } from "vitest";

import { failureFor } from "./index";

test("classifies a FeedError by its reason tag and encodes only the public reason", () => {
  const provider = ProviderId.make("yfinance");
  const upstream = new Error("private upstream response");
  const failure = failureFor(
    feedError(new FeedReasons.RateLimited({ provider }), upstream),
  );
  expect(failure).toMatchObject({
    status: "TOO_MANY_REQUESTS",
    code: "Feed.RateLimited",
    message: "Yahoo Finance is limiting requests. Try again in a moment.",
  });
  expect(failure.details.error).toEqual({
    _tag: "FeedError",
    reason: { _tag: "Feed.RateLimited", provider },
  });
  expect(JSON.stringify(failure)).not.toContain(upstream.message);
  expect(
    failureFor(feedError(new FeedReasons.SourceUnavailable({}))).details.error,
  ).toEqual({ _tag: "FeedError", reason: { _tag: "Feed.SourceUnavailable" } });
});

test("publishes a Tea failure at details.error, with the fallback for an empty cause message", () => {
  const failure = failureFor(
    teaError("invalid_data", "Tea execution failed")(new Error("")),
  );
  expect(failure).toMatchObject({
    status: "BAD_GATEWAY",
    code: "tea.invalid_data",
  });
  expect(failure.details.error).toEqual({
    code: "invalid_data",
    message: "Tea execution failed",
  });
  expect(Schema.is(Tea.Failure)(failure.details.error)).toBe(true);
});
