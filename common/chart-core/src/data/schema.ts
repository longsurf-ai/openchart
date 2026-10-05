// Purpose: Data namespace — shared Effect time schema and Zod time-series point schemas (OHLCV, Line, Area, etc.) and validation helpers
// Module:  @openchart/chart-core / data

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Schema } from "effect";

export namespace Data {
  /** Unix epoch seconds (fractional seconds allowed), within calendar years 0000–9999.
   * Milliseconds and date strings are not chart coordinates.
   */
  export const Time = Schema.Finite.check(
    Schema.isGreaterThanOrEqualTo(-62167219200),
    Schema.isLessThan(253402300800),
  ).annotate({
    description:
      "Unix epoch seconds, not milliseconds or a date string (e.g. 1775534400).",
  });
  export type Time = typeof Time.Type;

  /** Reads an untyped row or option value as chart time. Finite numbers pass
   * unchanged and anything else is undefined; no units or formats are converted.
   * @example Data.readTime(row.time) ?? fallback;
   */
  export function readTime(value: unknown): Time | undefined {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  // Base data point - all series data extends this
  export const Whitespace = z.object({
    time: z.custom<Time>(Schema.is(Time)),
    custom: z.record(z.string(), z.unknown()).optional(),
  });
  export type Whitespace = z.infer<typeof Whitespace>;

  // Single value series (Line, Area, Histogram)
  export const Value = Whitespace.extend({
    value: z.number(),
    color: z.string().optional(),
  });
  export type Value = z.infer<typeof Value>;

  export const Line = Value.extend({});
  export type Line = z.infer<typeof Line>;

  // Area with gradient colors
  export const Area = Value.extend({
    lineColor: z.string().optional(),
    topColor: z.string().optional(),
    bottomColor: z.string().optional(),
  });
  export type Area = z.infer<typeof Area>;

  // Histogram with per-bar color
  export const Histogram = Value.extend({
    color: z.string().optional(),
  });
  export type Histogram = z.infer<typeof Histogram>;

  // OHLC base for Bar and Candlestick
  export const OHLC = Whitespace.extend({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
  });
  export type OHLC = z.infer<typeof OHLC>;

  // Bar with optional color
  export const Bar = OHLC.extend({
    color: z.string().optional(),
  });
  export type Bar = z.infer<typeof Bar>;

  // Candlestick with full styling
  export const Candlestick = OHLC.extend({
    color: z.string().optional(),
    borderColor: z.string().optional(),
    wickColor: z.string().optional(),
  });
  export type Candlestick = z.infer<typeof Candlestick>;

  // Baseline (same as Value)
  export const Baseline = Value.extend({});
  export type Baseline = z.infer<typeof Baseline>;

  // Map series type to data schema
  export const SchemaMap = {
    Line,
    Area,
    Histogram,
    Bar,
    Candlestick,
    Baseline,
  } as const;

  // Validate data array for a given series type
  export function validate<T extends keyof typeof SchemaMap>(
    type: T,
    data: unknown[],
  ): z.infer<(typeof SchemaMap)[T]>[] {
    const schema = SchemaMap[type];
    return data.map((d) => schema.parse(d)) as z.infer<(typeof SchemaMap)[T]>[];
  }

  // Check if data is OHLC type
  export function isOHLC(data: unknown): data is OHLC {
    return OHLC.safeParse(data).success;
  }

  // Check if data is single value type
  export function isValue(data: unknown): data is Value {
    return Value.safeParse(data).success;
  }
}
