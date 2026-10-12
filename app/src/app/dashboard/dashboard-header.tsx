// Purpose: Compose Dashboard actions and the one symbol control for the selected chart or custom widget.
import { PageHeader } from "@openchart/app/app/page-header";
import { SymbolControl } from "@openchart/app/features/chart/components/symbol-control";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import {
  WidgetSymbolControl,
  useSymbolReaders,
} from "@openchart/app/app/widgets/custom/symbol";
import { WidgetGallery } from "@openchart/app/app/widgets/widget-gallery";
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import { useSelectedChart } from "./selected-chart";

/** Compose page actions using Dashboard-owned selection and save state. @example <DashboardHeader {...headerProps} /> */
export function DashboardHeader({
  dashboard,
  transport,
  disabled,
  onAdd,
}: {
  dashboard: Dashboard | undefined;
  transport: AppTransport;
  disabled: boolean;
  onAdd: (definition: WidgetDefinition) => void;
}) {
  const selected = useSelectedChart(dashboard, transport);
  const { activeWidgetId } = useChartSelection();
  const readers = useSymbolReaders();
  // The last focused symbol widget wins; otherwise the chart, then the first symbol widget.
  const widgetTarget =
    activeWidgetId && readers[activeWidgetId]
      ? activeWidgetId
      : selected
        ? undefined
        : dashboard?.widgets.find((widget) => readers[widget.id])?.id;
  return (
    <PageHeader>
      <div className="flex min-w-0 items-center gap-2">
        {widgetTarget ? (
          <WidgetSymbolControl key={widgetTarget} placementId={widgetTarget} />
        ) : dashboard && selected ? (
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
              transport={transport}
              disabled={disabled}
              onAdd={onAdd}
            />
          </div>
        ) : null}
      </div>
    </PageHeader>
  );
}
