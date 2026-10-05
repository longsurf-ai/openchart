// Purpose: Adapt a Dashboard placement to the existing chart grid and its controls.
import { useQuery } from "@tanstack/react-query";
import { ChartCandlestick } from "lucide-react";
import type { PropsWithChildren } from "react";

import { useWidget } from "@openchart/app/hooks/use-widget";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import { dashboardQueryOptions } from "@openchart/app/lib/resource/dashboard";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

import { FocusedDrawingToolbar } from "./drawing-toolbar";
import { ChartGrid } from "./grid";
import { ChartToolbar } from "./toolbar";
import "./workspace.css";

function ChartPlacement({ children }: PropsWithChildren) {
  const { placementId, dashboardId, transport } = useWidget();
  const query = useQuery({
    ...dashboardQueryOptions(transport, dashboardId),
    select: (dashboard) => {
      const placement = dashboard.widgets.find(
        (item) => item.id === placementId,
      );
      return {
        chartId: placement?.resourceId,
        firstPlacementId: dashboard.widgets.find(
          (item) =>
            item.kind === "chart" && item.resourceId === placement?.resourceId,
        )?.id,
      };
    },
  });
  const chartId = query.data?.chartId;
  if (query.isPending)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading chart…
      </p>
    );
  if (!chartId)
    throw query.error ?? new Error("This chart widget has no chart.");
  if (query.data?.firstPlacementId !== placementId)
    throw new Error("This chart is already displayed by another widget.");
  return (
    <ChartGridProvider key={chartId} chartId={chartId} transport={transport}>
      {children}
    </ChartGridProvider>
  );
}

function ChartWidgetContent() {
  return (
    <div className="relative h-full min-h-0 min-w-0">
      <ChartGrid />
      <FocusedDrawingToolbar />
    </div>
  );
}

/** Chart controls and content share existing grid interactions, never Resource copies. */
export const chartWidget: WidgetDefinition = {
  kind: "chart",
  title: "Chart",
  Icon: ChartCandlestick,
  defaultSize: { w: 12, h: 12 },
  minSize: { w: 4, h: 6 },
  Provider: ChartPlacement,
  Controls: ChartToolbar,
  Content: ChartWidgetContent,
};
