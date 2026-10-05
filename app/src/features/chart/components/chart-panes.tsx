// Purpose: Project Resource pane structure independently of source loading and renderer remounts.
import { useLayoutEffect } from "react";
import { v2 } from "@openchart/chart-core";
import { useChart } from "@openchart/app/hooks/use-chart";
import { removeOwnedSeries } from "@openchart/app/lib/chart/data";

/** Mount before sources; only Resource structural edits change the pane layout.
 * @example <ChartPanes panes={cell.panes} />
 */
export function ChartPanes({
  panes,
}: {
  panes: readonly { id: string; series: readonly { id: string }[] }[];
}) {
  const chart = useChart();
  const structure = JSON.stringify(
    panes.map((pane) => ({
      id: pane.id,
      series: pane.series.map((series) => series.id),
    })),
  );
  useLayoutEffect(() => {
    const definitions = JSON.parse(structure) as {
      id: string;
      series: string[];
    }[];
    chart.mutate((state) => {
      const previous = new Map(state.panes.map((pane) => [pane.id, pane]));
      const destinations = new Map<string, string>();
      const next = definitions.map((pane, index) => {
        // The native core reserves this identity for its first pane.
        const id = index === 0 ? v2.ChartStateModel.MAIN_PANE_ID : pane.id;
        for (const seriesId of pane.series) destinations.set(seriesId, id);
        return {
          id,
          index,
          height:
            previous.get(id)?.height ??
            state.config.chart.dimensions.height / definitions.length,
          objectIds: [] as v2.Chart.Pane["objectIds"],
        };
      });
      const byId = new Map(next.map((pane) => [pane.id, pane]));
      for (const object of Object.values(state.objects)) {
        if (object.kind === "series" && !destinations.has(object.id)) {
          removeOwnedSeries(state, object.id);
          continue;
        }
        object.paneId =
          object.kind === "series"
            ? destinations.get(object.id)!
            : byId.has(object.paneId)
              ? object.paneId
              : v2.ChartStateModel.MAIN_PANE_ID;
        byId.get(object.paneId)!.objectIds.push(object.id);
      }
      state.panes = next;
      for (const object of Object.values(state.objects)) {
        if (object.kind !== "series") continue;
        const axis = state.config.yAxis.axes.find(
          (axis) => axis.id === object.axisId,
        );
        if (axis) axis.paneId = object.paneId;
      }
      v2.ChartStateModel.normalizePaneHeights(state);
    }, "full");
  }, [chart, structure]);
  return null;
}
