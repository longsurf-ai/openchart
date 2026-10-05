// Purpose: Expand an existing chart cell over the alert's original Drawing Resource.
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router";
import { Button } from "@openchart/app/components/ui/button";
import {
  alertDrawingQueryOptions,
  type DrawingAlert,
} from "@openchart/app/features/alerts/api/queries";
import { chartList } from "@openchart/app/features/chart/api/queries";
import "@openchart/app/features/chart/components/workspace.css";
import { ChartCell } from "@openchart/app/features/chart/components/cell";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { getMainSource } from "@openchart/app/features/chart/utils/resource";
import { getGridPreset } from "@openchart/app/features/chart/utils/grid-layout";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import { drawingScopeKey } from "@openchart/app/lib/chart/drawings";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Resolve saved identity only; mounting never creates a chart or copies drawing geometry.
 * @example <AlertDrawingChart drawing={rule.alertable} transport={transport} />
 */
export function AlertDrawingChart({
  drawing,
  transport,
}: {
  drawing: DrawingAlert;
  transport: AppTransport;
}) {
  const source = useQuery(
    alertDrawingQueryOptions(transport, drawing.drawingId),
  );
  const charts = useQuery(chartList(transport, source.data?.dashboardId ?? ""));
  if (source.isError)
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => void source.refetch()}
      >
        Retry drawing
      </Button>
    );
  if (source.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading drawing…
      </p>
    );
  if (!source.data)
    return (
      <p className="text-sm text-muted-foreground">
        This drawing is no longer available.
      </p>
    );
  if (charts.isError)
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => void charts.refetch()}
      >
        Retry chart
      </Button>
    );
  if (!charts.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading chart…
      </p>
    );

  const scope = drawingScopeKey(source.data);
  const candidates = charts.data.flatMap((chart) =>
    chart.cells
      .slice(0, getGridPreset(chart.preset).capacity)
      .flatMap((cell) =>
        drawingScopeKey({
          dashboardId: chart.dashboardId,
          ...getMainSource(cell),
        }) === scope
          ? [{ chartId: chart.id, cell }]
          : [],
      ),
  );
  // Drawings belong to the Dashboard/listing, not one chart. Prefer the alert's bar settings.
  const target =
    candidates.find(
      ({ cell }) =>
        cell.resolution === drawing.inputs.resolution &&
        cell.session === drawing.inputs.session &&
        cell.adjustment === drawing.inputs.adjustment,
    ) ?? candidates[0];
  if (!target)
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          This drawing is not currently displayed on a saved chart.
        </p>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link
            to={`/app/dashboards/${encodeURIComponent(source.data.dashboardId)}`}
          >
            Open dashboard
          </Link>
        </Button>
      </div>
    );
  return (
    <section aria-label="Alert chart" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {source.data.listing.symbol} · {target.cell.resolution}
        </span>
        <span className="text-xs text-muted-foreground">
          Drawing changes save automatically
        </span>
      </div>
      <ChartSelectionProvider key={target.chartId}>
        <ChartGridProvider chartId={target.chartId} transport={transport}>
          <InlineChart
            key={`${target.cell.id}:${drawing.drawingId}`}
            cellId={target.cell.id}
            drawingId={drawing.drawingId}
          />
        </ChartGridProvider>
      </ChartSelectionProvider>
    </section>
  );
}

function InlineChart({
  cellId,
  drawingId,
}: {
  cellId: string;
  drawingId: string;
}) {
  const { setFocused } = useChartGrid();
  useEffect(() => setFocused(cellId), [cellId, setFocused]);
  return (
    <div className="relative h-[50vh] min-h-80 min-w-0 overflow-hidden rounded-md border">
      <ChartCell cellId={cellId} multiple={false} drawingId={drawingId} />
    </div>
  );
}
