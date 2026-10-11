// Purpose: Align finite Dataset observations to the chart's bounded bar intervals.
import { resolutionMs, type Resolution } from "@openchart/feed";
import type { DataFrame } from "@openchart/timeseries";

/**
 * Reads the latest Dataset observation before each bar's exclusive end, carrying
 * observations from before the loaded window. Intervals end at the earlier of
 * the next bar open or the resolution boundary; months end at the next UTC
 * calendar month. An unfinished bar only includes observations through `now`.
 * Inputs must ascend in epoch milliseconds. Source rows stay unchanged; missing
 * observations produce a row containing only the requested bar time.
 * @example const rows = alignDatasetToBars(timeline, frame, "1d", Date.now());
 */
export function alignDatasetToBars(
  timeline: readonly number[],
  frame: DataFrame,
  resolution: Resolution,
  now: number,
): Array<Record<string, unknown> & { time: number }> {
  const source = Array.from(frame);
  let cursor = -1;
  return timeline.map((time, index) => {
    const date = new Date(time);
    const boundary =
      resolution === "1M"
        ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
        : time + resolutionMs[resolution];
    const end = Math.min(boundary, timeline[index + 1] ?? boundary, now + 1);
    while (cursor + 1 < source.length && source[cursor + 1]!.time < end)
      cursor++;
    return { ...source[cursor], time };
  });
}
