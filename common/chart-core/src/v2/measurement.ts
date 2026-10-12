// Purpose: Derive ruler statistics from time/price anchors and resolved series rows.
import type { Chart } from "@openchart/chart-core/chart/state";
import type { Series } from "@openchart/chart-core/series";
import { continuousIndexFromTime } from "@openchart/chart-core/drawing/geometry";
import { Locale } from "@openchart/chart-core/format";
import { resolveField, readNumber } from "./series/fields";

/** Resolve ruler endpoints and statistics against current rows, including prepended history.
 * Pure; returns undefined when anchors cannot be projected. Counts bar intervals,
 * sums inclusive endpoint volume, and marks missing/out-of-window volume partial.
 * Margin projection estimates positions only; volume covers available rows.
 * @example const result = measurementStats(state.measurement, resolvedSeries);
 */
export function measurementStats(
  measurement: NonNullable<Chart.State["measurement"]>,
  series: Series.State,
) {
  const field = resolveField(series, "x", "time");
  const timeline =
    field === "time"
      ? series.data
      : series.data.map((row) => ({
          time: (row as Record<string, unknown>)[field],
        }));
  const from = continuousIndexFromTime(timeline, measurement.start.time);
  const to = continuousIndexFromTime(timeline, measurement.end.time);
  if (from === null || to === null) return undefined;
  const first = Math.round(Math.min(from, to));
  const last = Math.round(Math.max(from, to));
  let volume = 0;
  let volumeCount = 0;
  for (
    let index = Math.max(0, first);
    index <= Math.min(series.data.length - 1, last);
    index++
  ) {
    const value = readNumber(series.data[index], series, "volume", "volume");
    if (value === undefined || value < 0) continue;
    volume += value;
    volumeCount++;
  }
  const delta = measurement.end.price - measurement.start.price;
  const percent =
    measurement.start.price === 0
      ? undefined
      : (delta / Math.abs(measurement.start.price)) * 100;
  const format = series.options.valueFormat as
    Series.Options["valueFormat"] | undefined;
  const minMove = format?.minMove;
  return {
    from,
    to,
    delta,
    percent,
    precision: Math.max(0, Math.min(12, format?.precision ?? 2)),
    ticks: minMove && minMove > 0 ? Math.round(delta / minMove) : undefined,
    bars: Math.abs(Math.round(to) - Math.round(from)),
    seconds: Math.abs(measurement.end.time - measurement.start.time),
    volume: volumeCount ? volume : undefined,
    partialVolume: volumeCount < last - first + 1,
  };
}

/** Format elapsed calendar time (seconds), without estimating trading sessions.
 * Pure; owns no resources. Non-finite durations display an em dash.
 * @example measurementDuration(90061); // "1d 1h 1m 1s"
 */
export function measurementDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  let remaining = Math.round(Math.abs(seconds));
  const parts: string[] = [];
  for (const [unit, size] of [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ] as const) {
    const count = Math.floor(remaining / size);
    if (count)
      parts.push(`${count.toLocaleString(Locale.get().locale)}${unit}`);
    remaining %= size;
  }
  return parts.join(" ") || "0s";
}
