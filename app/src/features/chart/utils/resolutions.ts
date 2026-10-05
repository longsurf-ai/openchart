// Purpose: Read which bars a provider offers for a chart's market.
import {
  resolutionMs,
  type BarsCapabilities,
  type BarsSeries,
  type Resolution,
} from "@openchart/feed";

/**
 * The resolutions `capabilities` offer at the series' session and adjustment,
 * up to the series' own, finest first: the bars a profile or an auto script
 * can count in place of the chart's.
 * @example resolutionsUpTo(series, capabilities); // ["1m", "5m", "1h", "1d"]
 */
export function resolutionsUpTo(
  series: Pick<BarsSeries, "resolution" | "session" | "adjustment">,
  capabilities: BarsCapabilities,
): Resolution[] {
  return [
    ...new Set(
      capabilities.flatMap(({ resolution, session, adjustment }) =>
        session === series.session &&
        adjustment === series.adjustment &&
        resolutionMs[resolution] <= resolutionMs[series.resolution]
          ? [resolution]
          : [],
      ),
    ),
  ].sort((a, b) => resolutionMs[a] - resolutionMs[b]);
}
