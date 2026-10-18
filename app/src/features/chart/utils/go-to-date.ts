// Purpose: Turn a display-timezone civil date into a saved chart time window.
import { Temporal } from "temporal-polyfill";
import { resolutionMs, type Resolution } from "@openchart/feed";

import type { ChartPreferences } from "@openchart/app/lib/chart/preferences";

function zoneId(timezone: string): string {
  return timezone === "local" ? Temporal.Now.timeZoneId() : timezone;
}

/**
 * UTC milliseconds for a `YYYY-MM-DD` date and `HH:MM` clock in `timezone`.
 * `local` uses the host zone. Daylight-saving gaps and overlaps follow Temporal.
 * @example zonedWallToUtcMs("2026-07-15", "09:30", "America/New_York");
 */
export function zonedWallToUtcMs(
  date: string,
  time: string,
  timezone: string,
): number {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(
    zoneId(timezone),
  ).epochMilliseconds;
}

/**
 * `YYYY-MM-DD` and `HH:MM` of `instant` in `timezone`.
 * `local` uses the host zone; `UTC` and IANA names match chart display settings.
 * @example zonedWallFromUtcMs(Date.UTC(2026, 6, 15, 13, 30), "America/New_York");
 */
export function zonedWallFromUtcMs(
  instant: number,
  timezone: string,
): { readonly date: string; readonly time: string } {
  const zoned = Temporal.Instant.fromEpochMilliseconds(
    instant,
  ).toZonedDateTimeISO(zoneId(timezone));
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: zoned.toPlainDate().toString(),
    time: `${pad(zoned.hour)}:${pad(zoned.minute)}`,
  };
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
 * fit `width` at the current spacing.
 * @example visibleSpanMs({ viewport: null, barSpacing: 6 }, "1d", 480);
 */
export function visibleSpanMs(
  prefs: Pick<ChartPreferences, "viewport" | "barSpacing">,
  resolution: Resolution,
  width: number,
): number {
  if (prefs.viewport)
    return Math.max(1, prefs.viewport.to - prefs.viewport.from);
  const step = resolutionMs[resolution];
  return (width / Math.max(0.5, prefs.barSpacing)) * step;
}

/**
 * A historical viewport centered on `at`. The window shifts left when its
 * right edge would pass `now`.
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
  return { from: Math.floor(from), to: Math.ceil(to) };
}
