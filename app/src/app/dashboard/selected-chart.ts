// Purpose: Resolve the Dashboard's only chart and its focused cell for app composition.
import { useQuery } from "@tanstack/react-query";
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";
import { chartList } from "@openchart/app/features/chart/api/queries";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Read the Dashboard's unique Chart only while its widget is placed. Query owns
 * observation and errors; this hook creates nothing and releases observation on
 * unmount. Returns undefined until a Chart is available.
 * @example const target = useSelectedChart(dashboard, transport);
 */
export function useSelectedChart(
  dashboard: Dashboard | undefined,
  transport: AppTransport,
) {
  const { focusedCells } = useChartSelection();
  const placed = dashboard?.widgets.some((widget) => widget.kind === "chart");
  const chart = useQuery({
    ...chartList(transport, dashboard?.id ?? ""),
    enabled: !!placed,
  });
  const chartId = placed ? chart.data?.[0]?.id : undefined;
  return chartId ? { chartId, cellId: focusedCells[chartId] } : undefined;
}
