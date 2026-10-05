// Purpose: Connect the Dashboard route to its feature, chart selection and widget registry.
import { useAssistantContext } from "@assistant-ui/react";
import { useOutletContext, useParams } from "react-router";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { DashboardView } from "@openchart/app/features/dashboard/components/dashboard-view";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { DashboardHeader } from "./dashboard-header";
import {
  widgetCatalog,
  widgetRegistry,
} from "@openchart/app/app/widgets/widget-registry";

/** Compose the URL-selected Dashboard without creating content on mount. @example <DashboardPage /> */
export function DashboardPage() {
  const { dashboardId } = useParams();
  const { transport } = useOutletContext<AppRouteContext>();
  useAssistantContext({
    getContext: () => `user is viewing dashboard with id ${dashboardId}`,
  });
  if (!dashboardId) throw new Error("Dashboard route requires dashboardId");
  return (
    <ChartSelectionProvider key={dashboardId}>
      <DashboardView
        id={dashboardId}
        transport={transport}
        registry={widgetRegistry}
        renderHeader={(dashboard, disabled, addWidget, addChart) => (
          <DashboardHeader
            dashboard={dashboard}
            transport={transport}
            disabled={disabled}
            onAddWorkspace={() => addWidget(widgetCatalog.workspace.definition)}
            onAddChart={() => addChart(widgetCatalog.chart.definition)}
          />
        )}
      />
    </ChartSelectionProvider>
  );
}
