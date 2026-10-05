// Purpose: Show a Post's chart Resource live, opened at the moment the Post is about.
import { useQuery } from "@tanstack/react-query";
import { resolutionMs } from "@openchart/feed";
import { Button } from "@openchart/app/components/ui/button";
import { Skeleton } from "@openchart/app/components/ui/skeleton";
import { chartDetail } from "@openchart/app/features/chart/api/queries";
import "@openchart/app/features/chart/components/workspace.css";
import { ChartCell } from "@openchart/app/features/chart/components/cell";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** A deleted chart is final: retrying can never succeed. */
function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === "NOT_FOUND"
  );
}

/** Open the chart's first cell read-only, with 60 bars before `at` and 15 after. The cell's saved view is never read or changed.
 * A deleted chart shows the unavailable placeholder; other failures offer Retry here instead of a toast.
 * @example <PostChart transport={transport} chartId={reference.id} at={occurredAt} />
 */
export function PostChart({
  transport,
  chartId,
  at,
}: {
  transport: AppTransport;
  chartId: string;
  at: number;
}) {
  const chart = useQuery({
    ...chartDetail(transport, chartId),
    meta: { silent: true },
  });
  if (chart.isError && isNotFound(chart.error))
    return (
      <p className="text-sm text-muted-foreground">
        This chart is no longer available.
      </p>
    );
  if (chart.isError)
    return (
      <Button variant="outline" size="sm" onClick={() => void chart.refetch()}>
        Retry chart
      </Button>
    );
  if (!chart.data)
    return (
      <Skeleton role="status" aria-label="Loading chart" className="h-80" />
    );
  const cell = chart.data.cells[0];
  if (!cell)
    return (
      <p className="text-sm text-muted-foreground">
        This chart is no longer available.
      </p>
    );
  const step = resolutionMs[cell.resolution];
  return (
    <ChartSelectionProvider>
      <ChartGridProvider chartId={chartId} transport={transport}>
        <div className="relative h-80 min-w-0 overflow-hidden rounded-md border">
          <ChartCell
            cellId={cell.id}
            multiple={false}
            readOnly
            initialViewport={{ from: at - 60 * step, to: at + 15 * step }}
          />
        </div>
      </ChartGridProvider>
    </ChartSelectionProvider>
  );
}
