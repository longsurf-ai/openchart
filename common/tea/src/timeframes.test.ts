// Purpose: Pine timeframe strings and Feed resolutions name each other both ways.
import { Resolution } from "@openchart/feed";
import { expect, test } from "vitest";
import { resolutionOf, timeframeOf } from "./timeframes";

test.each([
  ["1", "1m"],
  ["240", "4h"],
  ["D", "1d"],
  ["1D", "1d"],
  ["W", "1W"],
  ["1M", "1M"],
  ["", undefined],
  ["3", undefined],
])("timeframe %j is resolution %s", (timeframe, resolution) => {
  expect(resolutionOf(timeframe)).toBe(resolution);
});

test("every resolution has a timeframe that names it back", () => {
  for (const resolution of Resolution.literals)
    expect(resolutionOf(timeframeOf(resolution))).toBe(resolution);
});
