// Purpose: Edit the selected Chart Resource from the page header without renderer dependencies.
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  chartDetail,
  chartMutation,
  chartMutationKey,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { getGridPreset } from "@openchart/app/features/chart/utils/grid-layout";
import {
  getMainSource,
  replaceListing,
} from "@openchart/app/features/chart/utils/resource";
import { dashboardQueryOptions } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { ResourceNotice } from "./resource-notice";
import { SymbolPicker } from "./symbol-picker";

/** The Dashboard's target cell: the focused cell while visible, else the first visible one. @example const cell = targetCell(chart, focusedCells[chart.id]); */
export function targetCell(chart: ChartResource, cellId?: string) {
  const visible = chart.cells.slice(0, getGridPreset(chart.preset).capacity);
  return visible.find((cell) => cell.id === cellId) ?? visible[0];
}

/** Save a captured chart/cell target; changing focus never retargets an open picker. @example <SymbolControl dashboardId={dashboardId} chartId={chartId} cellId={cellId} transport={transport} /> */
export function SymbolControl({
  dashboardId,
  chartId,
  cellId,
  transport,
}: {
  dashboardId: string;
  chartId: string;
  cellId?: string;
  transport: AppTransport;
}) {
  const [target, setTarget] = useState<{ chartId: string; cellId: string }>();
  const query = useQuery(chartDetail(transport, chartId));
  const cell = query.data && targetCell(query.data, cellId);
  const source = cell ? getMainSource(cell) : undefined;
  const busy = useIsMutating({ mutationKey: chartMutationKey(chartId) }) > 0;
  const dashboard = useQuery(dashboardQueryOptions(transport, dashboardId));
  const targetStillPlaced =
    !!target &&
    dashboard.data?.widgets.some(
      (widget) =>
        widget.kind === "chart" && widget.resourceId === target.chartId,
    );
  useEffect(() => {
    if (target && dashboard.isSuccess && !targetStillPlaced)
      setTarget(undefined);
  }, [target, dashboard.isSuccess, targetStillPlaced]);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-w-0 max-w-64 shrink rounded-md px-2.5"
        disabled={!cell || busy}
        aria-label={
          source
            ? `Symbol ${source.listing.symbol}. Change symbol`
            : "Choose a chart symbol"
        }
        onClick={() => {
          if (cell) setTarget({ chartId, cellId: cell.id });
        }}
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-semibold">
          {source?.listing.symbol ?? "Symbol"}
        </span>
        {source?.listing.name ? (
          <span className="hidden truncate font-normal text-muted-foreground md:inline">
            {source.listing.name}
          </span>
        ) : null}
      </Button>
      <ResourceNotice error={query.error} />
      {target && targetStillPlaced ? (
        <CapturedSymbolPicker
          key={`${target.chartId}:${target.cellId}`}
          target={target}
          transport={transport}
          onClose={() => setTarget(undefined)}
        />
      ) : null}
    </>
  );
}

function CapturedSymbolPicker({
  target,
  transport,
  onClose,
}: {
  target: { chartId: string; cellId: string };
  transport: AppTransport;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(chartDetail(transport, target.chartId));
  const save = useMutation(
    chartMutation(transport, queryClient, target.chartId),
  );
  const exists = query.data?.cells.some((cell) => cell.id === target.cellId);
  useEffect(() => {
    if ((query.isSuccess && !exists) || query.isError) onClose();
  }, [exists, query.isSuccess, query.isError, onClose]);
  if (!exists || query.isError) return null;
  return (
    <SymbolPicker
      onClose={onClose}
      onSelect={async (listing, capabilities) => {
        await save.mutateAsync((resource) =>
          replaceListing(resource, target.cellId, listing, capabilities),
        );
        onClose();
      }}
    />
  );
}
