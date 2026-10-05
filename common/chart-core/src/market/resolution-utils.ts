// Purpose: Timezone-aware bar-boundary math for resolution period calculations
// Module:  @openchart/chart-core / market

import { type BarCadence, barCadenceToSeconds } from "./resolution";

/**
 * Parse a canonical bar cadence to seconds.
 */
export function toSeconds(resolution: BarCadence): number {
  const seconds = barCadenceToSeconds(resolution);
  if (seconds === undefined) {
    throw new Error(`unsupported bar cadence ${resolution}`);
  }
  return seconds;
}

// ── Intl.DateTimeFormat caches ────────────────────────────

const datePartsFmtCache = new Map<string, Intl.DateTimeFormat>();
const midnightFmtCache = new Map<string, Intl.DateTimeFormat>();

function getDatePartsFmt(tz: string): Intl.DateTimeFormat {
  let fmt = datePartsFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz === "local" ? undefined : tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    datePartsFmtCache.set(tz, fmt);
  }
  return fmt;
}

function getMidnightFmt(tz: string): Intl.DateTimeFormat {
  let fmt = midnightFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    midnightFmtCache.set(tz, fmt);
  }
  return fmt;
}

/**
 * Get the UTC timestamp (in ms) for midnight on the given date in the specified timezone.
 */
function getMidnightUtc(
  year: number,
  month: number,
  day: number,
  tz: string,
): number {
  if (tz === "UTC") {
    return Date.UTC(year, month, day, 0, 0, 0, 0);
  }

  if (tz === "local") {
    return new Date(year, month, day, 0, 0, 0, 0).getTime();
  }

  // For arbitrary timezones, compute the offset using a reference point
  const refTime = Date.UTC(year, month, day, 12, 0, 0, 0);

  const parts = getMidnightFmt(tz).formatToParts(new Date(refTime));
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0");

  const wallClockUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );

  const offsetMs = wallClockUtc - refTime;
  return Date.UTC(year, month, day, 0, 0, 0, 0) - offsetMs;
}

/**
 * Get the start timestamp of the bar containing `time` for given resolution.
 * All timestamps are in seconds (Unix epoch).
 * For daily+ resolutions, uses specified timezone for bar boundaries.
 */
export function getBarStart(
  time: number,
  resolution: BarCadence,
  tz: string = "UTC",
): number {
  const seconds = toSeconds(resolution);

  // For sub-day resolutions, simple floor division works (timezone-agnostic)
  if (seconds < 86400) {
    return Math.floor(time / seconds) * seconds;
  }

  // For daily+ resolutions, use timezone-aware boundaries
  const date = new Date(time * 1000);
  const parts = getDatePartsFmt(tz).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "1";

  const year = parseInt(get("year"));
  const month = parseInt(get("month")) - 1;
  const day = parseInt(get("day"));

  if (seconds === 86400) {
    return getMidnightUtc(year, month, day, tz) / 1000;
  }

  if (seconds === 604800) {
    const midnightMs = getMidnightUtc(year, month, day, tz);
    const weekday = new Date(midnightMs).getUTCDay();
    const diff = weekday === 0 ? 6 : weekday - 1;
    return (midnightMs - diff * 86400000) / 1000;
  }

  if (seconds >= 2592000) {
    return getMidnightUtc(year, month, 1, tz) / 1000;
  }

  return Math.floor(time / seconds) * seconds;
}

/**
 * Check if a new period has started between two timestamps.
 * Returns true if `newTime` is in a different bar than `prevTime`.
 */
export function isNewPeriod(
  prevTime: number,
  newTime: number,
  resolution: BarCadence,
  tz: string = "UTC",
): boolean {
  return (
    getBarStart(prevTime, resolution, tz) !==
    getBarStart(newTime, resolution, tz)
  );
}

/**
 * Get the end timestamp of the bar starting at `barStart`.
 * The end is exclusive (start of next bar).
 */
export function getBarEnd(barStart: number, resolution: BarCadence): number {
  return barStart + toSeconds(resolution);
}
