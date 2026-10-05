// Purpose: Read one Resource cell and own its preferences, data bindings, and renderer.
import { useAssistantContext } from "@assistant-ui/react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { barsSeries } from "@openchart/feed";

import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  chartDetail,
  indicatorList,
  chartMutation,
  chartMutationKey,
} from "@openchart/app/features/chart/api/queries";
import { DrawingSource } from "@openchart/app/features/chart/components/sources/drawings";
import { MarketSource } from "@openchart/app/features/chart/components/sources/market";
import { IndicatorSource } from "@openchart/app/features/chart/components/sources/indicator";
import {
  getMainSource,
  moveSeries,
  removeSeries,
  updateCell,
} from "@openchart/app/features/chart/utils/resource";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";
import type { MarketSeriesInput } from "@openchart/app/hooks/use-market-series-source";
import { ChartCore } from "@openchart/app/lib/chart/core";
import {
  createChartPreferences,
  type ChartPreferences,
} from "@openchart/app/lib/chart/preferences";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import { cn } from "@openchart/app/utils/cn";

import { ChartMenus } from "./menus";
import { ChartLegend } from "./legend";
import { ChartPanes } from "./chart-panes";
import { AxisControls } from "./axis-controls";
import { ChartAlertButton, type AlertableOutputs } from "./alert-button";
import { ChartAlertLines } from "./alert-lines";
import { ResourceNotice } from "./resource-notice";

/** Subscribe to this cell; stable bindings isolate its renderer from workspace interactions. @example <ChartCell cellId={cellId} multiple={multiple} /> */
export function ChartCell({
  cellId,
  multiple,
  drawingId,
  initialViewport,
  readOnly = false,
}: {
  cellId: string;
  multiple: boolean;
  /** Restrict this view to editing one existing Drawing Resource. */
  drawingId?: string;
  /** View only: pan and zoom stay; editing, menus, alerts and axis controls are hidden, and drawings are locked. */
  readOnly?: boolean;
  /** Open at this time range without reading or saving the cell's stored view. */
  initialViewport?: ChartPreferences["viewport"];
}) {
  const {
    chartId,
    transport,
    focusedId,
    register,
    setFocused,
    maximizedId,
    toggleMaximized,
  } = useChartGrid();
  const { activeChartId } = useChartSelection();
  const maximized = maximizedId === cellId;
  const maximizeLabel = maximized ? "Restore chart" : "Maximize chart";
  const query = useQuery({
    ...chartDetail(transport, chartId),
    select: (resource) => resource.cells.find((cell) => cell.id === cellId),
  });
  const cell = query.data;
  // Indicators are their own Resource; a stray one outside every cell never mounts.
  const indicators = useQuery({
    ...indicatorList(transport, chartId),
    select: (items) => items.filter((item) => item.cellId === cellId),
  }).data;
  useAssistantContext({
    disabled: !cell || (!!maximizedId && !maximized),
    getContext: () => {
      if (!cell) return "";
      return JSON.stringify({
        view: "chart",
        chartId,
        cellId,
        focused: activeChartId === chartId && focusedId === cellId,
        ...barsSeries(getMainSource(cell), cell),
      });
    },
  });
  const client = useQueryClient();
  const save = useMutation(chartMutation(transport, client, chartId));
  const saving = useIsMutating({ mutationKey: chartMutationKey(chartId) }) > 0;
  const [preferences] = useState(() =>
    createChartPreferences(cellId, initialViewport),
  );
  const [resolution, setResolution] = useState(cell?.resolution);
  useLayoutEffect(() => {
    if (!cell || resolution === cell.resolution) return;
    // Sources stay unmounted until the new interval can request a fresh live window.
    if (resolution !== undefined) preferences.setState({ viewport: null });
    setResolution(cell.resolution);
  }, [cell, resolution, preferences]);
  const [legendTargets, setLegendTargets] = useState<
    ReadonlyMap<string, HTMLDivElement>
  >(() => new Map());
  const registerLegendTarget = useCallback(
    (id: string, node: HTMLDivElement | null) => {
      setLegendTargets((previous) => {
        if (previous.get(id) === node || (!node && !previous.has(id)))
          return previous;
        const next = new Map(previous);
        if (node) next.set(id, node);
        else next.delete(id);
        return next;
      });
    },
    [],
  );
  const onReady = useCallback(
    (chart: ChartRuntime) => register(chart, preferences),
    [register, preferences],
  );
  const rememberPaneHeights = useCallback(
    (chart: ChartRuntime) => {
      const heights = chart.store.getState().panes.map((pane) => pane.height);
      const saved = preferences.getState().paneHeights;
      const sum = heights.reduce((a, b) => a + b, 0);
      const previous = saved.reduce((a, b) => a + b, 0);
      if (
        heights.length > 1 &&
        (heights.length !== saved.length ||
          heights.some(
            (height, index) =>
              Math.abs(height / sum - saved[index]! / previous) > 0.0001,
          ))
      ) {
        preferences.setState({ paneHeights: heights });
      }
    },
    [preferences],
  );
  // Read on hover, so filling it re-renders nothing.
  const alertable = useRef<AlertableOutputs>(new Map()).current;
  const marketInputs = useMemo<MarketSeriesInput[]>(
    () =>
      cell
        ? cell.marketSources.flatMap((source, colorIndex) => {
            const bindings = cell.panes.flatMap((pane, index) =>
              pane.series.flatMap((series) =>
                series.source.kind === "market" &&
                series.source.marketSourceId === source.id
                  ? [
                      {
                        id: series.id,
                        main: series.role === "main",
                        output: series.source.output,
                        pane: index,
                        paneId: pane.id,
                        // Only a volume profile binding has settings.
                        ...("resolution" in series || "rows" in series
                          ? {
                              profile: {
                                resolution: series.resolution,
                                rows: series.rows,
                              },
                            }
                          : {}),
                      },
                    ]
                  : [],
              ),
            );
            return bindings.length
              ? [
                  {
                    id: source.id,
                    colorIndex,
                    bindings,
                    series: barsSeries(source, cell),
                  },
                ]
              : [];
          })
        : [],
    [cell],
  );
  if (!cell)
    return (
      <ResourceNotice
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  const onRemove = (seriesId: string) =>
    save.mutate((resource) =>
      updateCell(resource, cellId, (current) =>
        removeSeries(current, seriesId),
      ),
    );
  return (
    <ChartCore
      id={cellId}
      className={cn(
        "group/cell h-full w-full bg-background",
        maximized && "chart-cell-maximized",
      )}
      onReady={onReady}
      onInteractionEnd={rememberPaneHeights}
      onFocus={() => setFocused(cellId)}
    >
      {multiple || maximized ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                "absolute right-2 top-2 z-[5] bg-background text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/cell:opacity-100 motion-reduce:transition-none dark:hover:bg-accent [@media(hover:none)]:opacity-100",
                maximized && "opacity-100",
              )}
              aria-label={maximizeLabel}
              aria-pressed={maximized}
              onClick={() => toggleMaximized(cellId)}
            >
              {maximized ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{maximizeLabel}</TooltipContent>
        </Tooltip>
      ) : null}
      <ChartPanes panes={cell.panes} />
      <ChartLegend panes={cell.panes} register={registerLegendTarget} />
      {(resolution === cell.resolution ? (indicators ?? []) : []).map(
        (indicator) => (
          <IndicatorSource
            key={indicator.id}
            indicator={indicator}
            cell={cell}
            targets={legendTargets}
            localStore={preferences}
            disabled={saving || !!drawingId}
            readOnly={readOnly}
            alertable={alertable}
          />
        ),
      )}
      {(resolution === cell.resolution ? marketInputs : []).map((input) => (
        <MarketSource
          key={input.id}
          input={input}
          cell={cell}
          targets={legendTargets}
          localStore={preferences}
          disabled={saving || !!drawingId}
          readOnly={readOnly}
          onRemove={onRemove}
        />
      ))}
      {readOnly ? null : <AxisControls localStore={preferences} />}
      {!drawingId && !readOnly ? (
        <ChartAlertButton cell={cell} alertable={alertable} />
      ) : null}
      {!drawingId && !readOnly ? <ChartAlertLines cell={cell} /> : null}
      <DrawingSource cellId={cellId} drawingId={drawingId} readOnly={readOnly}>
        {readOnly
          ? undefined
          : ({ ensureSaved }) => (
              <ChartMenus
                drawingOnly={!!drawingId}
                saveDrawing={ensureSaved}
                cell={cell}
                localStore={preferences}
                disabled={saving}
                onRemove={onRemove}
                onMove={(seriesId, paneId) =>
                  save.mutate((resource) =>
                    updateCell(resource, cellId, (current) =>
                      moveSeries(current, seriesId, paneId),
                    ),
                  )
                }
              />
            )}
      </DrawingSource>
      {save.error ? (
        <div className="absolute bottom-2 left-2 right-2 z-[6]">
          <ResourceNotice
            error={save.error}
            onRetry={() => {
              save.reset();
              void query.refetch();
            }}
          />
        </div>
      ) : null}
    </ChartCore>
  );
}
