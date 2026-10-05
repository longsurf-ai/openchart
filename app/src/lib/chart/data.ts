// Purpose: Convert the Feed's columns and millisecond windows into chart coordinates.
import { v2 } from "@openchart/chart-core";
import {
  resolutionMs,
  type BarsRequest,
  type BarsSeries,
} from "@openchart/feed";
import type { DataFrame } from "@openchart/timeseries";

import type { ChartPreferences } from "./preferences";

/** Renderer rows retain every source field; only time changes units. */
export type ChartRow = Readonly<{ time: number } & Record<string, unknown>>;

/** Freeze each new row before handing it to Immer. @example const rows = toRows(frame); */
export function toRows(frame: DataFrame): ChartRow[] {
  return Array.from(frame, (row) =>
    Object.freeze({
      ...row,
      time: row.time / 1000,
    }),
  );
}

/** The open time in milliseconds of the main series' bar at `index`, counting back from -1 for the newest, if it has one. @example const newest = mainBarTime(chart.store.getState(), -1); */
export function mainBarTime(
  state: v2.Chart.State,
  index: number,
): number | undefined {
  const bar = v2.ChartStateModel.mainSeries(state)?.data.at(index);
  return bar ? (bar as ChartRow).time * 1000 : undefined;
}

/** Read the timeline used by the current ordinal axis. @example const time = mainTimeline(chart.store.getState()); */
export function mainTimeline(state: v2.Chart.State): number[] {
  return (v2.ChartStateModel.mainSeries(state)?.data ?? []).map(
    (row) => (row as ChartRow).time * 1000,
  );
}

/** Interpolate fractional indices and extrapolate the future margin. @example const from = indexToTime(times, range.from, resolutionMs['1d']); */
export function indexToTime(
  time: readonly number[],
  index: number,
  step: number,
): number {
  if (!time.length) return NaN;
  if (index <= 0) return time[0]! + index * step;
  if (index >= time.length - 1)
    return time[time.length - 1]! + (index - time.length + 1) * step;
  const floor = Math.floor(index);
  return time[floor]! + (time[floor + 1]! - time[floor]!) * (index - floor);
}

/** Find a fractional position without losing a viewport while history is prepended. @example const index = timeToIndex(times, saved.from, step); */
export function timeToIndex(
  time: readonly number[],
  target: number,
  step: number,
): number {
  if (!time.length) return 0;
  if (target <= time[0]!) return (target - time[0]!) / step;
  if (target >= time[time.length - 1]!)
    return time.length - 1 + (target - time[time.length - 1]!) / step;
  let lo = 0,
    hi = time.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (time[mid]! <= target) lo = mid;
    else hi = mid;
  }
  return lo + (target - time[lo]!) / (time[hi]! - time[lo]!);
}

/**
 * Derive the initial request from display intent, not from a fixed history limit.
 * It covers a quarter more than the bars that fit at the saved spacing, so neither
 * loading more history nor an indicator window widens it on the first visible
 * range. The count rounds up to a power of two, so a width that is still settling
 * while the chart mounts asks for the same window and reuses an open one.
 * @example const request = initialBarsRequest(series, preferences.getState(), width);
 */
export function initialBarsRequest(
  series: BarsSeries,
  { viewport, barSpacing }: Pick<ChartPreferences, "viewport" | "barSpacing">,
  width: number,
): BarsRequest {
  const countBack =
    2 ** Math.ceil(Math.log2(Math.max(120, (width / barSpacing) * 1.25)));
  const step = resolutionMs[series.resolution];
  const end = viewport?.to ?? Date.now();
  return {
    ...series,
    from: Math.floor(viewport?.from ?? end - countBack * step),
    to: viewport && end < Date.now() - step ? Math.ceil(end + step) : "now",
    countBack,
  };
}

/** Re-anchor only when the target actually changed. @example applyTimeViewport(draft, saved, step); */
export function applyTimeViewport(
  state: v2.Chart.State,
  viewport: ChartPreferences["viewport"],
  step: number,
) {
  const time = mainTimeline(state);
  if (!time.length) return;
  if (!viewport) {
    v2.ChartStateUtils.scrollToRealTime(state);
    return;
  }
  const from = timeToIndex(time, viewport.from, step),
    to = timeToIndex(time, viewport.to, step);
  const current = v2.ChartStateUtils.getVisibleRange(state);
  if (
    !current ||
    Math.abs(current.from - from) > 0.1 ||
    Math.abs(current.to - to) > 0.1
  )
    v2.ChartStateUtils.setVisibleRange(state, from, to);
}

/** Remove an owned display and its interaction references; missing IDs are harmless. @example removeOwnedSeries(state, id); */
export function removeOwnedSeries(state: v2.Chart.State, id: string) {
  // React owns pane membership; a renderer remount must not compact empty panes.
  v2.ChartStateModel.removeSeriesObject(state, id);
  const axes = new Set(
    Object.values(state.objects)
      .filter((object) => object.kind === "series")
      .map((object) => object.axisId),
  );
  state.config.yAxis.axes = state.config.yAxis.axes.filter((axis) =>
    axes.has(axis.id),
  );
  for (const field of [
    "hoveredSeriesId",
    "focusedSeriesId",
    "lockedSeriesId",
    "magnetSeriesId",
  ] as const)
    if (state[field] === id) delete state[field];
}
