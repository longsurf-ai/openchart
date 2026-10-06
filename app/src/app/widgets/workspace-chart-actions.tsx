// Purpose: Give Dashboard Workspace tabs an Add to chart action aimed at the Dashboard's target chart.
import { useQuery } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useSelectedChart } from "@openchart/app/app/dashboard/selected-chart";
import { AddToChartAction } from "@openchart/app/features/chart/components/add-to-chart";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { dashboardQueryOptions } from "@openchart/app/lib/resource/dashboard";
import { WorkspaceFileActions } from "@openchart/app/lib/workspace/workspace";

/** `.tea` tabs add to, or reload on, the chart the header targets: the active chart and its focused cell. A Dashboard without charts adds nothing. Requires ChartSelectionContext. @example <WorkspaceChartActions><WorkspaceContent /></WorkspaceChartActions> */
export function WorkspaceChartActions({ children }: PropsWithChildren) {
  const { dashboardId, transport } = useWidget();
  const dashboard = useQuery(dashboardQueryOptions(transport, dashboardId));
  const target = useSelectedChart(dashboard.data ?? undefined);
  return (
    <WorkspaceFileActions.Provider
      value={
        target
          ? (file, prepare) => (
              // A new target starts fresh; an add in flight never switches charts.
              <AddToChartAction
                key={target.chartId}
                transport={transport}
                chartId={target.chartId}
                cellId={target.cellId}
                file={file}
                prepare={prepare}
              />
            )
          : null
      }
    >
      {children}
    </WorkspaceFileActions.Provider>
  );
}
