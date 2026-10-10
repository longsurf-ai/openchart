// Purpose: Draw a Workspace Dataset's bound columns on the chart's bar timeline, one legend per column.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useStore } from "zustand";
import { v2 } from "@openchart/chart-core";
import { Color } from "@openchart/chart-core/util";
import { joinByTime } from "@openchart/timeseries";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  workspaceDatasetDetail,
  type CellDefinition,
  type WorkspaceDatasetResource,
} from "@openchart/app/features/chart/api/queries";
import {
  ChartSeries,
  type ChartSeriesProps,
} from "@openchart/app/features/chart/components/chart-series";
import { SeriesLegend } from "@openchart/app/features/chart/components/series-legend";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useDataset } from "@openchart/app/hooks/use-dataset";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import { mainTimeline } from "@openchart/app/lib/chart/data";
import { offersRetry } from "@openchart/app/lib/feed/transport";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { workspaceFileQueryOptions } from "@openchart/app/lib/workspace/workspace";
import { defaultIndicatorOutputSeriesOptions } from "@openchart/app/lib/chart/indicator-output-style";
import {
  defaultSeriesPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";

const valueFields = { x: "time", value: "value" };

const format = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : "—";

/**
 * One Workspace Dataset on one cell: a single read shared by every bound
 * column. Each chart bar shows the latest observation known by its close, so
 * monthly data on daily bars draws as steps and finer data keeps each bar's
 * last row. Columns that are not numbers draw nothing. A missing Dataset keeps
 * its bindings and shows why in the legend.
 * @example <DatasetSource datasetId={id} cell={cell} targets={targets} localStore={store} disabled={false} onRemove={remove} />
 */
export function DatasetSource({
  datasetId,
  cell,
  targets,
  localStore,
  disabled,
  readOnly,
  onRemove,
}: {
  datasetId: string;
  cell: CellDefinition;
  targets: ReadonlyMap<string, HTMLDivElement>;
  localStore: ChartPreferencesStore;
  disabled: boolean;
  /** Legends show values only. */
  readOnly?: boolean;
  onRemove: (seriesId: string) => void;
}) {
  const chart = useChart();
  const { transport } = useChartGrid();
  const resource = useQuery(workspaceDatasetDetail(transport, datasetId));
  const dataset = useDataset(transport, resource.data ?? undefined);
  const prefs = useStore(localStore);
  const mainData = useStore(
    chart.store,
    (state) => v2.ChartStateModel.mainSeries(state)?.data,
  );
  const name = resource.data?.name ?? "Dataset";
  const bindings = useMemo(
    () =>
      cell.panes.flatMap((pane, index) =>
        pane.series.flatMap((series) =>
          series.source.kind === "dataset" &&
          series.source.datasetId === datasetId
            ? [
                {
                  id: series.id,
                  output: series.source.output,
                  pane: index,
                  paneId: pane.id,
                  mainPane: index === 0,
                },
              ]
            : [],
        ),
      ),
    [cell, datasetId],
  );
  const series = useMemo((): ChartSeriesProps[] => {
    const frame = dataset.data;
    if (!frame || !mainData?.length) return [];
    // ponytail: rejoins the whole file on each bar update; window it if files grow large.
    const rows = [
      ...joinByTime(mainTimeline(chart.store.getState()), frame, {
        fill: "last",
      }),
    ];
    return bindings.map((binding, index) => {
      let held: number | null = null;
      const data = rows.map((row) => {
        const value = row[binding.output];
        if (typeof value === "number" && Number.isFinite(value)) held = value;
        return Object.freeze({ time: row.time / 1000, value: held });
      });
      const defaults = defaultIndicatorOutputSeriesOptions({
        definitionName: name,
        outputName: binding.output,
        outputIndex: index,
        seriesType: "Line",
      });
      const options = {
        ...defaultSeriesPreferences,
        type: "Line",
        title: binding.output,
        color: String(defaults.color),
        lineWidth: 1.5,
        ...prefs.series[binding.id],
      };
      const axisId = options.ownAxis
        ? `${datasetId}:axis`
        : binding.mainPane
          ? "right"
          : `pane:${binding.paneId}`;
      const color = String(options.color);
      return {
        id: binding.id,
        type: String(options.type),
        source: "computed",
        pane: binding.pane,
        axisId,
        fieldMap: valueFields,
        options: {
          ...options,
          lineColor: color,
          topLineColor: color,
          bottomLineColor: color,
          topColor: Color.withAlpha(color, 0.24),
          bottomColor: Color.withAlpha(color, 0.03),
        },
        axisOptions: prefs.axes[axisId] ?? {},
        data,
      };
    });
  }, [dataset.data, mainData, chart, bindings, name, prefs, datasetId]);
  const failure = resource.error ?? dataset.error;
  // A failed Resource read can always be retried; Feed failures say so themselves.
  const retryable = dataset.error
    ? offersRetry(dataset.error)
    : !!resource.error;
  useErrorToast(failure, {
    id: `dataset:${chart.id}:${datasetId}`,
    title: `Couldn’t load ${name}`,
    retry: retryable
      ? () => void (resource.error ? resource.refetch() : dataset.refetch())
      : undefined,
  });
  // Bindings to a deleted Dataset stay saved; the chart skips them.
  if (resource.data === null) return null;
  return (
    <>
      {series.map((props) => (
        <ChartSeries key={props.id} {...props} />
      ))}
      {bindings.map((binding) => {
        const pane = cell.panes[binding.pane];
        const target = pane && targets.get(pane.id);
        return target
          ? createPortal(
              <SeriesLegend
                seriesIds={[binding.id]}
                sourceId={datasetId}
                order={pane.series.findIndex(
                  (value) => value.id === binding.id,
                )}
                localStore={localStore}
                disabled={disabled}
                readOnly={readOnly}
                describe={([value]) => ({
                  title: `${name} · ${binding.output}`,
                  content: <span>{format(value?.row?.value)}</span>,
                })}
                status={
                  dataset.isPending && resource.data ? (
                    <span role="status" className="text-muted-foreground">
                      Loading…
                    </span>
                  ) : failure && !retryable ? (
                    <span className="text-muted-foreground">
                      {failure.message}
                    </span>
                  ) : null
                }
                extraActions={
                  resource.data && !readOnly ? (
                    <CollectAction
                      dataset={resource.data}
                      transport={transport}
                      disabled={disabled}
                    />
                  ) : null
                }
                onRemove={() => onRemove(binding.id)}
              />,
              target,
              binding.id,
            )
          : null;
      })}
    </>
  );
}

/**
 * Runs the Dataset's collection now. A script whose content differs from the
 * approved hash opens a review of that content first; approving it records
 * exactly the text shown, then collects. Datasets without a collection show nothing.
 */
function CollectAction({
  dataset,
  transport,
  disabled,
}: {
  dataset: WorkspaceDatasetResource;
  transport: AppTransport;
  disabled: boolean;
}) {
  const script =
    dataset.collection?.kind === "script" ? dataset.collection : undefined;
  const file = useQuery({
    ...workspaceFileQueryOptions(
      transport,
      dataset.source.workspaceId,
      script?.path ?? "",
    ),
    enabled: !!script,
  });
  const [reviewing, setReviewing] = useState(false);
  const collect = useMutation({
    meta: { errorTitle: `Couldn’t collect ${dataset.name}` },
    mutationFn: async (approve?: string) => {
      if (approve)
        await transport.rpc.resources.workspace_dataset.approveCollection.mutate(
          {
            id: dataset.id,
            expectedRevision: dataset.revision,
            hash: approve,
          },
        );
      return transport.rpc.collection.collect.mutate({ id: dataset.id });
    },
    onSuccess: () => setReviewing(false),
  });
  if (!dataset.collection) return null;
  const hash = file.data?.entry.hash;
  const approved = !script || hash === dataset.approvedScriptHash;
  const label = `Collect ${dataset.name}`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled || collect.isPending || (!!script && !hash)}
            onClick={() =>
              approved ? collect.mutate(undefined) : setReviewing(true)
            }
          >
            <RefreshCw />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {script ? (
        <Dialog open={reviewing} onOpenChange={setReviewing}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Review {script.path}</DialogTitle>
              <DialogDescription>
                This script runs on this computer with uv to refresh{" "}
                {dataset.name}. It changed since it was last approved, so
                scheduled collections wait for your approval.
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
              {file.data
                ? new TextDecoder().decode(
                    Uint8Array.from(atob(file.data.base64), (char) =>
                      char.charCodeAt(0),
                    ),
                  )
                : null}
            </pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewing(false)}>
                Cancel
              </Button>
              <Button
                disabled={!hash || collect.isPending}
                onClick={() => collect.mutate(hash)}
              >
                Approve and collect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
