// Purpose: Let React own the vertical profiles one output draws.
import { useLayoutEffect, useRef } from "react";
import { v2 } from "@openchart/chart-core";
import type { VerticalProfile } from "@openchart/chart-core/vertical-profile";
import { useChart } from "@openchart/app/hooks/use-chart";

/**
 * Place `profiles` in the pane at index `pane`, on `axisId`'s y scale. Each new
 * set replaces the previous one in a single chart update, and unmounting
 * removes them all. A pane that does not exist yet places nothing until the
 * next set.
 * @example <ChartVerticalProfiles id={binding.id} pane={0} axisId="right" profiles={profiles} />
 */
export function ChartVerticalProfiles({
  id,
  pane,
  axisId,
  profiles,
}: {
  id: string;
  pane: number;
  axisId: string;
  profiles: readonly VerticalProfile.State[];
}) {
  const chart = useChart();
  const placed = useRef<readonly string[]>([]);
  useLayoutEffect(() => {
    const ids = profiles.map((_, index) => `${id}:${index}`);
    chart.mutate((state) => {
      for (const stale of placed.current.slice(ids.length))
        v2.ChartStateModel.removeVerticalProfileObject(state, stale);
      const paneId = state.panes[pane]?.id;
      if (!paneId) return;
      profiles.forEach((profile, index) =>
        v2.ChartStateModel.upsertVerticalProfileObject(state, {
          id: ids[index]!,
          paneId,
          axisId,
          profile,
        }),
      );
    });
    placed.current = ids;
  }, [chart, id, pane, axisId, profiles]);
  useLayoutEffect(
    () => () =>
      chart.mutate((state) => {
        for (const profileId of placed.current)
          v2.ChartStateModel.removeVerticalProfileObject(state, profileId);
      }),
    [chart],
  );
  return null;
}
