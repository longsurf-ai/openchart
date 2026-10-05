// Purpose: Derive scanner bands from live Agent Session selections without owning execution.
import type { Drawing } from "@openchart/chart-core/drawing/types";
import type { SpanBandRenderInput } from "@openchart/chart-core/span/render";

type ProgressBand = NonNullable<SpanBandRenderInput["progressBands"]>[number];

/** Derive disjoint scanners from visible selections with live progress.
 * Overlapping selections share a count; single selections retain streamed logs.
 * Recomputing after progress disappears naturally shrinks or splits groups.
 * Inputs are never changed and groups are never persisted.
 * @example const bands = agentSessionBands(items, state.drawings.sessionProgress);
 */
export function agentSessionBands(
  items: readonly Drawing.Item[],
  progress: Readonly<Record<string, Drawing.SessionProgress>> = {},
): ProgressBand[] {
  const sessions = items
    .filter(
      (item): item is Drawing.AgentSessionItem =>
        item.type === "agent_session" && !item.hidden && !!progress[item.id],
    )
    .sort((a, b) => a.range.from - b.range.from || a.id.localeCompare(b.id));
  const groups: Array<ProgressBand & { count: number }> = [];
  for (const item of sessions) {
    const live = progress[item.id]!;
    const previous = groups.at(-1);
    if (previous && item.range.from <= previous.tEnd) {
      previous.tEnd = Math.max(previous.tEnd, item.range.to);
      previous.startedAtMs = Math.min(previous.startedAtMs, live.startedAtMs);
      previous.count++;
    } else {
      groups.push({
        xStart: 0,
        xEnd: 0,
        tStart: item.range.from,
        tEnd: item.range.to,
        color: item.style.lineColor,
        translucent: true,
        mode: "annotating",
        ...live,
        count: 1,
      });
    }
  }
  return groups.map(({ count, ...band }) => ({
    ...band,
    // Persisted selection windows use Feed milliseconds; render coordinates use seconds.
    tStart: band.tStart / 1000,
    tEnd: band.tEnd / 1000,
    progressLog:
      count === 1
        ? band.progressLog
        : [{ text: `${count} agents running`, atMs: band.startedAtMs }],
  }));
}
