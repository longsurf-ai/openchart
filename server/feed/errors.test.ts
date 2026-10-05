// Purpose: Lock the Dataset-to-Feed mapping: public facts survive, the DatasetError stays a server-only cause.
import { Schema } from "effect";
import { expect, test } from "vitest";
import { FeedError } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import {
  DatasetError,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";
import { datasetFailure, unavailable } from "./errors";

const provider = ProviderId.make("yfinance");
const located = (reason: DatasetReason) =>
  new DatasetError({
    dataset: "yfinance.bars",
    operation: "select",
    reason,
    cause: new Error("upstream secret"),
  });

test("OutsideRetention becomes HistoryUnavailable and keeps the DatasetError as an unencoded cause", () => {
  const cause = located(
    new DatasetReasons.OutsideRetention({ availableFrom: 1754006400000 }),
  );
  const error = datasetFailure(provider)(cause);
  expect(error.reason).toMatchObject({
    _tag: "Feed.HistoryUnavailable",
    provider,
    availableFrom: 1754006400000,
  });
  expect(error.cause).toBe(cause);
  const wire = JSON.stringify(Schema.encodeSync(FeedError)(error));
  expect(wire).not.toContain("secret");
  expect(wire).not.toContain("yfinance.bars");
});

test("each Dataset reason maps to its Feed reason with the provider", () => {
  const cases = [
    [
      new DatasetReasons.InvalidQuery({ detail: "Bad window" }),
      { _tag: "Feed.InvalidRequest", detail: "Bad window" },
    ],
    [
      new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
      { _tag: "Feed.ResyncRequired", provider },
    ],
    [new DatasetReasons.Retired(), { _tag: "Feed.Reconfigured", provider }],
    [
      new DatasetReasons.Unavailable(),
      { _tag: "Feed.SourceUnavailable", provider },
    ],
  ] as const;
  for (const [reason, expected] of cases)
    expect(datasetFailure(provider)(located(reason)).reason).toMatchObject(
      expected,
    );
});

test("unavailable without a provider omits the key", () => {
  expect(unavailable().reason).not.toHaveProperty("provider");
  expect(unavailable(provider).reason).toMatchObject({ provider });
});
