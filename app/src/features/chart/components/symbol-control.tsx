// Purpose: Edit the selected Chart Resource from the page header without renderer dependencies.
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ProviderListing } from "@openchart/market";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  chartDetail,
  chartList,
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

/** The page header's one symbol entry, shared by charts and custom widgets so every target looks the same. `label` names the action when no listing is chosen. @example <SymbolButton listing={source} label="Choose a chart symbol" onClick={open} /> */
export function SymbolButton({
  listing,
  label,
  disabled,
  onClick,
}: {
  listing: ProviderListing | undefined;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-w-0 max-w-64 shrink rounded-md px-2.5"
      disabled={disabled}
      aria-label={
        listing ? `Symbol ${listing.listing.symbol}. Change symbol` : label
      }
      onClick={onClick}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-semibold">
        {listing?.listing.symbol ?? "Symbol"}
      </span>
      {listing?.listing.name ? (
        <span className="hidden truncate font-normal text-muted-foreground md:inline">
          {listing.listing.name}
        </span>
      ) : null}
    </Button>
  );
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
  const charts = useQuery(chartList(transport, dashboardId));
  const targetStillPlaced =
    !!target &&
    charts.data?.[0]?.id === target.chartId &&
    dashboard.data?.widgets.some((widget) => widget.kind === "chart");
  useEffect(() => {
    if (target && dashboard.isSuccess && charts.isSuccess && !targetStillPlaced)
      setTarget(undefined);
  }, [target, dashboard.isSuccess, charts.isSuccess, targetStillPlaced]);
  return (
    <>
      <SymbolButton
        listing={source}
        disabled={!cell || busy}
        label="Choose a chart symbol"
        onClick={() => {
          if (cell) setTarget({ chartId, cellId: cell.id });
        }}
      />
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
