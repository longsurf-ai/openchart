// Purpose: Pick the Dashboard's target chart once for the header and widgets that act on "the chart".
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";

/** The active chart while it is placed, else the first chart widget, with its focused cell if any; undefined without a chart. @example const target = useSelectedChart(dashboard); */
export function useSelectedChart(dashboard: Dashboard | undefined) {
  const { activeChartId, focusedCells } = useChartSelection();
  const charts =
    dashboard?.widgets.flatMap((widget) =>
      widget.kind === "chart" && widget.resourceId ? [widget.resourceId] : [],
    ) ?? [];
  const chartId = charts.find((id) => id === activeChartId) ?? charts[0];
  return chartId ? { chartId, cellId: focusedCells[chartId] } : undefined;
}
