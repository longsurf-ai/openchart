// Purpose: Verify the calendar declaration and session validation without importing provider code.
import { Schema } from "effect";

import { calendar } from "@openchart/server/data/providers/local";
import { expect, test } from "vitest";

test("Catalog knows the calendar and accepts one-ended ranges", () => {
  const definition = calendar;
  expect(Object.keys(definition.access)).toEqual(["select"]);
  for (const time of [{ from: 1 }, { to: 2 }, {}]) {
    expect(
      Schema.decodeUnknownSync(definition.access.select.input)({
        calendar: "NYSE",
        time,
        count: 2,
      }),
    ).toEqual({ calendar: "NYSE", time, count: 2 });
  }
});

test("calendar rows preserve closed dates and reject invalid windows", () => {
  const definition = calendar;
  const row = {
    date: "2026-11-26",
    timezone: "America/New_York",
    holiday: "Thanksgiving",
    sessions: [],
  };
  expect(
    Schema.decodeUnknownSync(definition.access.select.output)([row]),
  ).toEqual([row]);
  for (const sessions of [
    [{ type: "regular", start: 2, end: 1 }],
    [
      { type: "regular", start: 1, end: 3 },
      { type: "post", start: 2, end: 4 },
    ],
    [{ type: "closed", start: 1, end: 2 }],
    [{ type: "regular", start: 1, end: 2, typo: true }],
  ])
    expect(() =>
      Schema.decodeUnknownSync(definition.access.select.output)([
        { ...row, sessions },
      ]),
    ).toThrow();
});
