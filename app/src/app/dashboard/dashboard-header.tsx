// Purpose: Compose Dashboard actions and the selected chart's symbol control.
import { PageHeader } from "@openchart/app/app/page-header";
import { SymbolControl } from "@openchart/app/features/chart/components/symbol-control";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { WidgetGallery } from "@openchart/app/app/widgets/widget-gallery";
import { useSelectedChart } from "./selected-chart";

/** Compose page actions using Dashboard-owned selection and save state. @example <DashboardHeader {...headerProps} /> */
export function DashboardHeader({
  dashboard,
  transport,
  disabled,
  onAddWorkspace,
  onAddChart,
}: {
  dashboard: Dashboard | undefined;
  transport: AppTransport;
  disabled: boolean;
  onAddWorkspace: () => void;
  onAddChart: () => void;
}) {
  const selected = useSelectedChart(dashboard);
  return (
    <PageHeader>
      <div className="flex min-w-0 items-center gap-2">
        {dashboard && selected ? (
          <SymbolControl
            dashboardId={dashboard.id}
            chartId={selected.chartId}
            cellId={selected.cellId}
            transport={transport}
          />
        ) : null}
        <h1 className="sr-only">{dashboard?.name ?? "Dashboard"}</h1>
        {dashboard ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <WidgetGallery
              dashboard={dashboard}
              disabled={disabled}
              onAddWorkspace={onAddWorkspace}
              onAddChart={onAddChart}
            />
          </div>
        ) : null}
      </div>
    </PageHeader>
  );
}
