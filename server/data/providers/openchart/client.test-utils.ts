// Purpose: Supply realistic OpenChart API fixtures for client and Provider integration tests.
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { OpenChartResolution, OpenChartAdjustment, type Bar } from "./contract";

/** Supported capabilities returned by the simulated OpenChart service. */
export const capabilities = {
  resolutions: OpenChartResolution.literals,
  historyAdjustments: OpenChartAdjustment.literals,
  liveAdjustments: OpenChartAdjustment.literals,
  adjustedLiveResolutions: OpenChartResolution.literals,
  sessions: ["regular", "extended", "24h"],
  historyFormat: "arrow",
  queryTimeUnit: "milliseconds",
  liveTimeUnit: "milliseconds",
  maxHistoryRows: 10000,
  maxConnectionSeconds: 900,
};
/** Typed series shared by client tests. */
export const series = {
  listing: 12526,
  session: "regular",
  resolution: "1m",
  adjustment: "raw",
} as const;
/** One typed historical page request. */
export const pageRequest = {
  ...series,
  start: 0,
  end: 2000,
  limit: 10,
  order: "asc",
} as const;

/** A source-native listing served by local OpenChart fixtures. */
export const listing = {
  id: 12526,
  symbol: "X:BTCUSD",
  class: "crypto" as const,
  currency: "USD",
  name: "Bitcoin",
};
/** Construct a decoded observation. @example bar(1000, 123.456) */
export const bar = (
  time: number,
  close = 100,
  final = true,
  asOf = time + 1,
): Bar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  final,
  asOf,
});
/** Encode a simulated OpenChart Arrow response. @example arrow([bar(1000)]) */
export function arrow(rows: readonly Bar[], id = listing.id) {
  const prices = (key: "open" | "high" | "low" | "close") =>
    BigInt64Array.from(rows.map((row) => BigInt(Math.round(row[key] * 1e9))));
  return tableToIPC(
    tableFromArrays({
      listing_id: Int32Array.from(rows.map(() => id)),
      ts_event: BigInt64Array.from(
        rows.map((row) => BigInt(row.time) * 1000000n),
      ),
      open: prices("open"),
      high: prices("high"),
      low: prices("low"),
      close: prices("close"),
      volume: Float64Array.from(rows.map((row) => row.volume)),
      final: rows.map((row) => row.final),
      as_of: BigInt64Array.from(rows.map((row) => BigInt(row.asOf) * 1000000n)),
    }),
  );
}

const weekdays = [0, 1, 2, 3, 4];
/** Cloud's `/calendar` body for an NYSE-like listing with an inherited parent. */
export const calendarResponse = {
  calendar: "NYSE",
  calendars: [
    {
      calendarId: 2,
      sourceCalendarId: 1,
      name: "NYSE",
      timezone: "America/New_York",
    },
    {
      calendarId: 1,
      sourceCalendarId: null,
      name: "US equities",
      timezone: "America/New_York",
    },
  ],
  rules: weekdays.flatMap((dayOfWeek) =>
    (
      [
        ["pre", "04:00:00", "09:30:00"],
        ["regular", "09:30:00", "16:00:00"],
        ["post", "16:00:00", "20:00:00"],
      ] as const
    ).map(([sessionType, openTime, closeTime]) => ({
      calendarId: 1,
      sessionType,
      dayOfWeek,
      openTime,
      closeTime,
      crossesMidnight: false,
    })),
  ),
  overrides: [
    {
      calendarId: 2,
      date: "2026-11-26",
      overrideType: "closed",
      name: "Thanksgiving",
      openTime: null,
      closeTime: null,
    },
    {
      calendarId: 2,
      date: "2026-11-27",
      overrideType: "early_close",
      name: "Thanksgiving",
      openTime: null,
      closeTime: "13:00:00",
    },
  ],
} as const;
