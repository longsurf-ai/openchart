// Purpose: Session badges honor coverage selectors and the core countdown fields.
import { expect, it } from "vitest";
import type { TradingDay } from "@openchart/market";

import {
  sessionClockStatus,
  sessionClockWindow,
  sessionInfo,
} from "@openchart/app/features/chart/utils/session-clock";

const day: TradingDay = {
  date: Date.parse("2026-11-27T00:00:00Z"),
  sessions: [
    {
      type: "pre",
      start: Date.parse("2026-11-27T09:00:00Z"),
      end: Date.parse("2026-11-27T14:30:00Z"),
    },
    {
      type: "regular",
      start: Date.parse("2026-11-27T14:30:00Z"),
      end: Date.parse("2026-11-27T21:00:00Z"),
    },
    {
      type: "post",
      start: Date.parse("2026-11-27T21:00:00Z"),
      end: Date.parse("2026-11-28T01:00:00Z"),
    },
    {
      type: "overnight",
      start: Date.parse("2026-11-28T01:00:00Z"),
      end: Date.parse("2026-11-28T09:00:00Z"),
    },
  ],
};

it("aligns the calendar request to UTC days so live ticks do not move it", () => {
  expect(sessionClockWindow(Date.parse("2026-11-27T16:00:00Z"))).toEqual({
    start: Date.parse("2026-11-25T00:00:00Z"),
    end: Date.parse("2026-12-09T00:00:00Z"),
  });
  expect(sessionClockWindow(Date.parse("2026-11-27T23:59:59Z"))).toEqual(
    sessionClockWindow(Date.parse("2026-11-27T00:00:00Z")),
  );
});

it("counts regular coverage to the cash close and extended coverage through pre-market", () => {
  const pre = sessionClockStatus({
    days: [day],
    now: Date.parse("2026-11-27T13:00:00Z"),
    coverage: "regular",
  });
  expect(pre).toMatchObject({
    kind: "closed",
    remainingMs:
      Date.parse("2026-11-27T14:30:00Z") - Date.parse("2026-11-27T13:00:00Z"),
  });
  expect(sessionInfo(pre)).toEqual({
    phase: "closed",
    nextOpenAt: Date.parse("2026-11-27T14:30:00Z") / 1000,
  });
  const open = sessionClockStatus({
    days: [day],
    now: Date.parse("2026-11-27T16:00:00Z"),
    coverage: "regular",
  });
  expect(sessionInfo(open)).toEqual({
    phase: "open",
    currentSessionOpenAt: Date.parse("2026-11-27T14:30:00Z") / 1000,
    nextCloseAt: Date.parse("2026-11-27T21:00:00Z") / 1000,
  });
  const extendedPre = sessionClockStatus({
    days: [day],
    now: Date.parse("2026-11-27T13:00:00Z"),
    coverage: "extended",
  });
  expect(sessionInfo(extendedPre)).toEqual({
    phase: "pre",
    currentSessionOpenAt: Date.parse("2026-11-27T09:00:00Z") / 1000,
    nextCloseAt: Date.parse("2026-11-27T14:30:00Z") / 1000,
  });
});

it("hides an empty calendar and leaves a close with no following session uncounted", () => {
  expect(
    sessionInfo(sessionClockStatus({ days: [], now: 1, coverage: "24h" })),
  ).toBeUndefined();
  const closed = sessionClockStatus({
    days: [day],
    now: Date.parse("2026-11-28T12:00:00Z"),
    coverage: "regular",
  });
  expect(closed).toEqual({
    kind: "closed",
    next: undefined,
    remainingMs: undefined,
  });
  expect(sessionInfo(closed)).toEqual({ phase: "closed" });
});

it("treats overnight as open for 24h and closed for extended", () => {
  const now = Date.parse("2026-11-28T02:00:00Z");
  expect(
    sessionInfo(sessionClockStatus({ days: [day], now, coverage: "24h" })),
  ).toMatchObject({
    phase: "open",
    nextCloseAt: Date.parse("2026-11-28T09:00:00Z") / 1000,
  });
  expect(
    sessionInfo(sessionClockStatus({ days: [day], now, coverage: "extended" })),
  ).toEqual({ phase: "closed" });
});
