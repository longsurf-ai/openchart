// Purpose: Keep fixed and ongoing time ranges ordered and strict at the boundary.

import { Schema } from "effect";
import { expect, it } from "vitest";
import { TimeRange } from "./timeRange";

it("accepts ordered integer bounds or now and rejects invalid ranges", () => {
  const parse = Schema.decodeUnknownSync(TimeRange);
  expect(parse({ from: -10, to: 0 })).toEqual({ from: -10, to: 0 });
  expect(parse({ from: 0, to: "now" })).toEqual({ from: 0, to: "now" });
  for (const range of [
    {},
    { from: 0 },
    { to: 10 },
    { from: 0, to: 0 },
    { from: 10, to: 0 },
    { from: 0.5, to: 10 },
    { from: 0, to: 10.5 },
    { from: NaN, to: 10 },
    { from: 0, to: Infinity },
    { from: 0, to: "latest" },
    { from: 0.5, to: "now" },
    { from: NaN, to: "now" },
    { from: Infinity, to: "now" },
    { from: "now", to: 10 },
    { from: 0, to: 10, extra: true },
  ]) {
    expect(() => parse(range)).toThrow();
  }
});
