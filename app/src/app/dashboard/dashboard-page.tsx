// Purpose: Connect the Dashboard route to its feature, chart selection, intent routing and widget registry.
import { useAssistantContext } from "@assistant-ui/react";
import { Link, useOutletContext, useParams } from "react-router";
import { Button } from "@openchart/app/components/ui/button";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { DashboardView } from "@openchart/app/features/dashboard/components/dashboard-view";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { WidgetIntentProvider } from "@openchart/app/lib/widget/intent/provider";
import { DashboardHeader } from "./dashboard-header";
import { resolveWidget } from "@openchart/app/app/widgets/widget-registry";

/** Compose the URL-selected Dashboard without creating content on mount; its widgets share one chart selection and one intent router, both reset per Dashboard. @example <DashboardPage /> */
export function DashboardPage() {
  const { dashboardId } = useParams();
  const { transport } = useOutletContext<AppRouteContext>();
  useAssistantContext({
    getContext: () => `user is viewing dashboard with id ${dashboardId}`,
  });
  if (!dashboardId) throw new Error("Dashboard route requires dashboardId");
  return (
    <ChartSelectionProvider key={dashboardId}>
      <WidgetIntentProvider>
        <DashboardView
          id={dashboardId}
          transport={transport}
          registry={resolveWidget}
          missingAction={
            <Button variant="outline" asChild>
              <Link to="/app" replace>
                Go to home
              </Link>
            </Button>
          }
          renderHeader={(dashboard, disabled, addWidget) => (
            <DashboardHeader
              dashboard={dashboard}
              transport={transport}
              disabled={disabled}
              onAdd={addWidget}
            />
          )}
        />
      </WidgetIntentProvider>
    </ChartSelectionProvider>
  );
}
