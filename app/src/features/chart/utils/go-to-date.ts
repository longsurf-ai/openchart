// Purpose: Turn a display-timezone civil date into a saved chart time window.
import { resolutionMs, type Resolution } from "@openchart/feed";

import type { ChartPreferences } from "@openchart/app/lib/chart/preferences";

/** Wall-clock fields in a named display zone. Month is 1–12. */
export type ZonedCivilTime = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second?: number;
};

function zoneName(timezone: string): string | undefined {
  return timezone === "local" ? undefined : timezone;
}

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = Number(parts.find((entry) => entry.type === type)?.value);
  return Number.isFinite(value) ? value : NaN;
}

function wallAsUtcMs(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneName(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  let hour = part(parts, "hour");
  if (hour === 24) hour = 0;
  return Date.UTC(
    part(parts, "year"),
    part(parts, "month") - 1,
    part(parts, "day"),
    hour,
    part(parts, "minute"),
    part(parts, "second"),
  );
}

/**
 * Read year/month/day/hour/minute of `instant` in `timezone`.
 * `local` uses the host zone; `UTC` and IANA names match chart display settings.
 * @example instantToZonedParts(Date.UTC(2026, 6, 15, 13, 30), "America/New_York");
 */
export function instantToZonedParts(
  instant: number,
  timezone: string,
): ZonedCivilTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneName(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  let hour = part(parts, "hour");
  if (hour === 24) hour = 0;
  return {
    year: part(parts, "year"),
    month: part(parts, "month"),
    day: part(parts, "day"),
    hour,
    minute: part(parts, "minute"),
  };
}

/**
 * UTC millisecond instant for a civil date and clock in `timezone`.
 * DST gaps and overlaps resolve to the offset of a same-named UTC guess, then
 * one correction so the wall clock round-trips. Invalid civil fields yield NaN.
 * @example zonedCivilToUtcMs({ year: 2026, month: 7, day: 15, hour: 9, minute: 30 }, "America/New_York");
 */
export function zonedCivilToUtcMs(
  civil: ZonedCivilTime,
  timezone: string,
): number {
  const second = civil.second ?? 0;
  const asUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    second,
  );
  if (!Number.isFinite(asUtc)) return NaN;
  if (timezone === "UTC") return asUtc;
  let utc = asUtc;
  utc -= wallAsUtcMs(utc, timezone) - asUtc;
  utc -= wallAsUtcMs(utc, timezone) - asUtc;
  return utc;
}

/**
 * `HH:MM` clock text, or undefined when the value is not a 24-hour clock.
 * @example parseClock("09:30");
 */
export function parseClock(
  value: string,
): { hour: number; minute: number } | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Zero-padded 24-hour `HH:MM` for a time input.
 * @example formatClock(9, 30);
 */
export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Center of the saved window, or `now` when the chart follows the latest bars.
 * @example defaultGoToInstant({ viewport: { from: 0, to: 10 } }, 50);
 */
export function defaultGoToInstant(
  prefs: Pick<ChartPreferences, "viewport">,
  now = Date.now(),
): number {
  const viewport = prefs.viewport;
  return viewport ? Math.round((viewport.from + viewport.to) / 2) : now;
}

/**
 * Visible window length in milliseconds: the saved viewport, or the bars that
 * fit at the current spacing with a floor of eighty bars.
 * @example visibleSpanMs({ viewport: null, barSpacing: 6 }, "1d");
 */
export function visibleSpanMs(
  prefs: Pick<ChartPreferences, "viewport" | "barSpacing">,
  resolution: Resolution,
  width = 800,
): number {
  if (prefs.viewport)
    return Math.max(1, prefs.viewport.to - prefs.viewport.from);
  const step = resolutionMs[resolution];
  return Math.max(step * 80, (width / Math.max(0.5, prefs.barSpacing)) * step);
}

/**
 * A historical viewport centered on `at`, shifted left when the right edge
 * would pass `now` so follow-latest stays a separate action.
 * @example viewportAroundInstant(Date.UTC(2024, 0, 2), { spanMs: 86_400_000, now: Date.UTC(2026, 0, 1) });
 */
export function viewportAroundInstant(
  at: number,
  options: { readonly spanMs: number; readonly now?: number },
): { from: number; to: number } {
  const span = Math.max(1, options.spanMs);
  const now = options.now ?? Date.now();
  let to = at + span / 2;
  let from = to - span;
  if (to > now) {
    to = now;
    from = to - span;
  }
  if (!(from < to)) {
    to = now;
    from = to - span;
  }
  return { from: Math.floor(from), to: Math.ceil(to) };
}
