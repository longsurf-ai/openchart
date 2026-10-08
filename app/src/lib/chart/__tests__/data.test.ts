// Purpose: Chart windows cover the saved zoom; session shading reads only the calendar it needs.
import { BarsSeries, resolutionMs } from "@openchart/feed";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import {
  initialBarsRequest,
  sessionDaysWindow,
  tagSessions,
} from "@openchart/app/lib/chart/data";

const series = Schema.decodeUnknownSync(BarsSeries)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1d",
  session: "24h",
  adjustment: "raw",
});

afterEach(() => {
  vi.useRealTimers();
});

it("requests a power of two covering a quarter more than the bars that fit at the saved spacing", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 3) });
  // A zoomed-out chart: 1016 px at 1.3 px per bar shows about 780 bars.
  const zoomedOut = initialBarsRequest(
    series,
    { viewport: null, barSpacing: 1.3 },
    1016,
  );
  expect(zoomedOut).toMatchObject({ countBack: 1024, to: "now" });
  expect(zoomedOut.from).toBe(Date.now() - 1024 * resolutionMs["1d"]);
  // A width still settling while the chart mounts asks for the same window.
  expect(
    initialBarsRequest(series, { viewport: null, barSpacing: 1.3 }, 1040)
      .countBack,
  ).toBe(1024);
  expect(
    initialBarsRequest(series, { viewport: null, barSpacing: 6 }, 1016)
      .countBack,
  ).toBe(256);
  expect(
    initialBarsRequest(series, { viewport: null, barSpacing: 50 }, 1016)
      .countBack,
  ).toBe(128);
});

it("tags rows inside calendar sessions and leaves the rest untouched", () => {
  const seconds = (iso: string) => Date.parse(iso) / 1000;
  const rows = [
    "2026-11-27T08:00Z", // before pre-market
    "2026-11-27T09:00Z",
    "2026-11-27T14:30Z", // the open belongs to the regular session
    "2026-11-27T18:00Z",
    "2026-11-28T01:00Z", // the post-market end is exclusive
    "2026-11-30T09:00Z", // beyond the calendar's days
  ].map((iso) => Object.freeze({ time: seconds(iso), close: 1 }));
  const session = (
    type: "pre" | "regular" | "post",
    start: string,
    end: string,
  ) => ({
    type,
    start: Date.parse(start),
    end: Date.parse(end),
  });
  const tagged = tagSessions(rows, [
    { date: Date.parse("2026-11-26T05:00Z"), sessions: [] },
    {
      date: Date.parse("2026-11-27T05:00Z"),
      sessions: [
        session("pre", "2026-11-27T09:00Z", "2026-11-27T14:30Z"),
        session("regular", "2026-11-27T14:30Z", "2026-11-27T18:00Z"),
        session("post", "2026-11-27T18:00Z", "2026-11-28T01:00Z"),
      ],
    },
  ]);
  expect(tagged.map((row) => row.sessionType)).toEqual([
    undefined,
    "pre",
    "regular",
    "post",
    undefined,
    undefined,
  ]);
  expect(tagged[1]).toEqual({
    ...rows[1],
    sessionType: "pre",
    sessionStart: seconds("2026-11-27T09:00Z"),
    sessionEnd: seconds("2026-11-27T14:30Z"),
  });
  expect(Object.isFrozen(tagged[1])).toBe(true);
  expect(tagged[0]).toBe(rows[0]);
});

it("asks for calendar days only under intraday Extended/24h bars", () => {
  const first = Date.parse("2026-10-05T13:00Z");
  const last = Date.parse("2026-10-07T23:00Z");
  expect(
    sessionDaysWindow({ resolution: "1h", session: "extended" }, first, last),
  ).toEqual({
    start: Date.parse("2026-10-05T00:00Z"),
    end: Date.parse("2026-10-08T00:00Z"),
  });
  expect(
    sessionDaysWindow({ resolution: "1m", session: "24h" }, last, last),
  ).toEqual({
    start: Date.parse("2026-10-07T00:00Z"),
    end: Date.parse("2026-10-08T00:00Z"),
  });
  for (const series of [
    { resolution: "1h", session: "regular" },
    { resolution: "1d", session: "extended" },
  ] as const)
    expect(sessionDaysWindow(series, first, last)).toBeUndefined();
  expect(
    sessionDaysWindow(
      { resolution: "1h", session: "extended" },
      undefined,
      undefined,
    ),
  ).toBeUndefined();
});
