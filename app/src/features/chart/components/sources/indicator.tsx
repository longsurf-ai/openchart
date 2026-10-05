import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
// Purpose: Compose Tea execution, declarative visuals and shared legend controls.
import { useContext, useEffect, useMemo, type ComponentProps } from "react";
import { useStore } from "zustand";
import * as Tz from "@openchart/chart-core/tz/types";
import { barsSeries, type BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { createPortal } from "react-dom";
import {
  replaceEqualDeep,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Code2, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  chartCommand,
  indicatorList,
  type CellDefinition,
  type IndicatorResource,
} from "@openchart/app/features/chart/api/queries";
import {
  getMainPane,
  getMainSource,
} from "@openchart/app/features/chart/utils/resource";
import { IndicatorInputsForm } from "@openchart/app/features/chart/components/indicator-inputs-dialog";
import { SeriesLegend } from "@openchart/app/features/chart/components/series-legend";
import { TeaVisuals } from "@openchart/app/features/chart/components/tea-visuals";
import { resolutionsUpTo } from "@openchart/app/features/chart/utils/resolutions";
import { useBarsCapabilities } from "@openchart/app/hooks/use-bars";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useChartWindow } from "@openchart/app/hooks/use-chart-window";
import { useTea, useTeaSource } from "@openchart/app/hooks/use-tea";
import { mainBarTime } from "@openchart/app/lib/chart/data";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import type { AlertableOutputs } from "@openchart/app/features/chart/components/alert-button";

/** One attachment owns execution and one legend, with all output values inline.
 * @example <IndicatorSource {...props} />
 */
export function IndicatorSource({
  indicator,
  cell,
  targets,
  localStore,
  disabled,
  readOnly,
  alertable,
}: {
  indicator: IndicatorResource;
  cell: CellDefinition;
  targets: ReadonlyMap<string, HTMLDivElement>;
  localStore: ChartPreferencesStore;
  disabled: boolean;
  /** Legends show values only. */
  readOnly?: boolean;
  /** Receives this Indicator's alertable outputs while its compilation lives. */
  alertable: AlertableOutputs;
}) {
  const chart = useChart();
  const { chartId, transport } = useChartGrid();
  const openFile = useContext(WorkspaceFileNavigation);
  const client = useQueryClient();
  const remove = useMutation(chartCommand(transport, client, chartId));
  // Reload and settings edits change only this Indicator, one at a time.
  const edit = useMutation({
    scope: { id: `indicator:${indicator.id}` },
    mutationFn: (change: "reload" | IndicatorResource["parameterOverrides"]) =>
      change === "reload"
        ? transport.rpc.resources.indicator.reload.mutate({
            id: indicator.id,
            expectedRevision: indicator.revision,
          })
        : transport.rpc.resources.indicator.patch.mutate({
            id: indicator.id,
            expectedRevision: indicator.revision,
            operations: [
              { op: "replace", path: "/parameterOverrides", value: change },
            ],
          }),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: indicatorList(transport, chartId).queryKey,
      }),
  });
  const mainPane = getMainPane(cell);
  const series = useMemo(() => barsSeries(getMainSource(cell), cell), [cell]);
  const bindings = useMemo(
    () =>
      cell.panes.flatMap((pane, index) =>
        pane.series.flatMap((series) =>
          series.source.kind === "indicator" &&
          series.source.indicatorId === indicator.id
            ? [
                {
                  id: series.id,
                  output: series.source.output,
                  pane: index,
                  paneId: pane.id,
                  mainPane: pane.id === mainPane.id,
                },
              ]
            : [],
        ),
      ),
    [cell, indicator.id, mainPane.id],
  );
  const window = useChartWindow(chart, series, localStore);
  // The saved snapshot runs until Reload replaces it; settings re-observe it.
  const execution = useTea({
    source: { entry: indicator.source.path, sources: indicator.snapshot },
    parameters: indicator.parameterOverrides,
    ...Tea.barsInputs(series),
    requests: {},
    ...window,
    warmupBars: Tea.standardWarmupBars,
  });
  const { compiled } = execution;
  // The live file with its imports; a read failure leaves Reload unmarked.
  const live = useTeaSource(indicator.source);
  // replaceEqualDeep returns its first argument only when both are deeply equal.
  const changed =
    live.program !== undefined &&
    replaceEqualDeep(indicator.snapshot, live.program.sources) !==
      indicator.snapshot;
  // Alerts read the same numeric and plot outputs the server accepts.
  useEffect(() => {
    if (!compiled) return;
    try {
      alertable.set(
        indicator.id,
        new Set(
          Tea.indicatorSeriesOutputs(compiled).map((output) => output.name),
        ),
      );
    } catch {
      return; // TeaVisuals reports unsupported outputs.
    }
    return () => void alertable.delete(indicator.id);
  }, [alertable, compiled, indicator.id]);
  // Data the script reads beyond the chart's own bars: first the bars it runs
  // on, finer than the chart's for an auto script, then its requests' data.
  const reads = useMemo(() => {
    if (!execution.config) return { labels: [], finer: false };
    const own = Object.values(execution.config.inputs).flatMap((input) =>
      input._tag === "NodeRef" ? [] : [input],
    );
    const labels = [
      ...own,
      ...Tea.requestSeries(execution.config).map((request) => request.series),
    ].flatMap((read) =>
      read.provider !== series.provider ||
      read.listing.symbol !== series.listing.symbol
        ? [`${read.listing.symbol} ${read.resolution}`]
        : read.resolution === series.resolution
          ? []
          : [read.resolution],
    );
    return {
      labels: [...new Set(labels)],
      finer: own.some((input) => input.resolution !== series.resolution),
    };
  }, [execution.config, series]);
  // A run on finer bars covers the chart's window from where the provider
  // keeps those bars, so its rows can start after the chart's first bar ends,
  // at its second bar's open; the legend then says from when, in the chart's
  // time zone. Finer bars that only start inside the first bar, where the
  // market's data begins, cut nothing.
  const runStart = useMemo(
    () => (reads.finer ? execution.data?.get(0)?.time : undefined),
    [reads.finer, execution.data],
  );
  const firstBarEnd = useStore(chart.store, (state) => mainBarTime(state, 1));
  const timezone = useStore(chart.store, (state) => state.display);
  const from =
    runStart !== undefined &&
    firstBarEnd !== undefined &&
    runStart >= firstBarEnd
      ? new Date(runStart).toLocaleDateString(undefined, {
          timeZone: timezone === Tz.LOCAL ? undefined : timezone,
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : undefined;
  const title =
    compiled?.declaration?.title ??
    indicator.source.path.split("/").at(-1) ??
    indicator.source.path;
  const outputs = useMemo(() => {
    const names = compiled?.definition.outputs.fields.map(
      (field) => field.name,
    );
    return names
      ? [...bindings].sort(
          (a, b) => names.indexOf(a.output) - names.indexOf(b.output),
        )
      : bindings;
  }, [bindings, compiled]);
  const legendOutputs = useMemo(() => {
    if (!compiled) return outputs;
    const decorations = new Set(
      compiled.definition.outputs.fields.flatMap((field) => {
        const visual = Tea.describeTeaVisual(field);
        return visual &&
          visual.kind !== "series" &&
          visual.kind !== "horizontal-line" &&
          visual.kind !== "candles"
          ? [field.name]
          : [];
      }),
    );
    return outputs.filter(({ output }) => !decorations.has(output));
  }, [compiled, outputs]);
  // Outputs drawn as vertical profiles, whose part colors Style lists.
  const profileIds = useMemo(() => {
    const profiles = new Set(
      compiled?.definition.outputs.fields
        .filter(
          (field) => Tea.describeTeaVisual(field)?.kind === "vertical-profile",
        )
        .map((field) => field.name),
    );
    return outputs
      .filter(({ output }) => profiles.has(output))
      .map(({ id }) => id);
  }, [compiled, outputs]);
  // The legend sits with the Indicator's first legend output, else its first
  // output, such as a profile that has no values to show.
  const anchor = legendOutputs[0] ?? outputs[0];
  const legendPane = anchor?.paneId ?? mainPane.id;
  const target = targets.get(legendPane) ?? targets.get(mainPane.id);
  const busy = disabled || remove.isPending || edit.isPending;
  const actions = [
    {
      id: "reload",
      label: changed
        ? `Reload ${title} to apply its changed file`
        : `Reload ${title}`,
      Icon: RotateCw,
      marked: changed,
      disabled: busy,
      run: () => edit.mutate("reload"),
    },
    {
      id: "remove",
      label: `Remove ${title}`,
      Icon: Trash2,
      marked: false,
      disabled: busy,
      run: () =>
        remove.mutate((chart) =>
          transport.rpc.resources.macro.removeIndicator.mutate({
            chartId,
            expectedRevision: chart.revision,
            indicatorId: indicator.id,
          }),
        ),
    },
  ];
  useErrorToast(execution.error, {
    id: `indicator:${chart.id}:${indicator.id}`,
    title: `Couldn’t update ${title}`,
    retry: execution.retry,
  });
  useErrorToast(edit.error ?? remove.error, {
    id: `indicator-edit:${chart.id}:${indicator.id}`,
    title: `Couldn’t change ${title}`,
  });
  return (
    <>
      <TeaVisuals
        sourceId={indicator.id}
        compiled={compiled}
        frame={execution.data}
        bindings={outputs}
        preferences={localStore}
      />
      {target
        ? createPortal(
            <div
              data-indicator-source={indicator.id}
              className="max-w-full"
              style={{
                order: cell.panes
                  .find((pane) => pane.id === legendPane)
                  ?.series.findIndex((series) => series.id === anchor?.id),
              }}
            >
              <SeriesLegend
                seriesIds={legendOutputs.map((output) => output.id)}
                visibilityIds={outputs.map((output) => output.id)}
                profileIds={profileIds}
                showMarker={false}
                readOnly={readOnly}
                settingsInputs={
                  compiled ? (
                    <IndicatorSettingsForm
                      key={indicator.revision}
                      compiled={compiled}
                      series={series}
                      resolved={execution.config?.parameters}
                      overrides={indicator.parameterOverrides}
                      onSave={async (parameterOverrides) => {
                        await edit.mutateAsync(parameterOverrides);
                      }}
                    />
                  ) : null
                }
                sourceId={indicator.id}
                order={0}
                localStore={localStore}
                disabled={busy}
                describe={(values) => ({
                  title,
                  content:
                    values.length || reads.labels.length
                      ? [
                          reads.labels.length ? (
                            <span
                              key="reads"
                              data-indicator-reads
                              aria-label={`Also reads ${reads.labels.join(", ")} data`}
                              className="text-muted-foreground"
                            >
                              {reads.labels.join(" · ")}
                            </span>
                          ) : null,
                          from ? (
                            <span
                              key="from"
                              data-indicator-from
                              className="text-muted-foreground"
                            >
                              from {from}
                            </span>
                          ) : null,
                          ...values.map((value, index) => {
                            const label = String(
                              value.row?.title ||
                                legendOutputs[index]?.output ||
                                value.label,
                            );
                            const number =
                              typeof value.row?.value === "number" &&
                              Number.isFinite(value.row.value)
                                ? value.row.value.toLocaleString(undefined, {
                                    maximumFractionDigits: 4,
                                  })
                                : "—";
                            return (
                              <span
                                key={value.id}
                                data-indicator-output={value.id}
                                role="group"
                                aria-label={`${label}: ${number}`}
                                className="inline-flex items-center gap-1"
                              >
                                <span
                                  data-testid="indicator-output-color"
                                  aria-hidden="true"
                                  className="size-1.5 shrink-0 rounded-xs"
                                  style={{ background: value.color }}
                                />
                                <span>{number}</span>
                              </span>
                            );
                          }),
                        ]
                      : "—",
                })}
                extraActions={actions.map(
                  ({ id, label, Icon, marked, disabled, run }) => (
                    <Tooltip key={id}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="relative"
                          aria-label={label}
                          disabled={disabled}
                          onClick={run}
                        >
                          <Icon />
                          {marked ? (
                            <span
                              data-testid="indicator-file-changed"
                              aria-hidden="true"
                              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
                            />
                          ) : null}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ),
                )}
                // The live file opens; the chart keeps its snapshot until Reload.
                trailingActions={
                  openFile ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Open code"
                          onClick={() =>
                            openFile({
                              workspaceId: indicator.source.workspaceId,
                              path: indicator.source.path,
                            })
                          }
                        >
                          <Code2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open code</TooltipContent>
                    </Tooltip>
                  ) : null
                }
                status={
                  execution.status === "loading" ? (
                    <span role="status" className="text-muted-foreground">
                      {execution.data
                        ? "Updating indicator…"
                        : "Loading indicator…"}
                    </span>
                  ) : null
                }
              />
            </div>,
            target,
            indicator.id,
          )
        : null}
    </>
  );
}

type InputsProps = ComponentProps<typeof IndicatorInputsForm>;

// The Indicator's inputs, showing the values its run resolved for defaults
// that follow the chart. An auto script's form also offers its Timeframe.
function IndicatorSettingsForm({
  series,
  ...props
}: InputsProps & { series: BarsSeries }) {
  return props.compiled.declaration?.timeframe === "auto" ? (
    <AutoSettingsForm series={series} {...props} />
  ) : (
    <IndicatorInputsForm {...props} />
  );
}

// Timeframe offers the bars the chart's provider serves at its session and
// adjustment, up to the chart's own, by resolution name.
function AutoSettingsForm({
  series,
  ...props
}: InputsProps & { series: BarsSeries }) {
  const capabilities = useBarsCapabilities({
    provider: series.provider,
    listing: series.listing,
  });
  const timeframe = resolutionsUpTo(series, capabilities.data ?? []).map(
    (resolution) => ({ value: Tea.timeframeOf(resolution), name: resolution }),
  );
  return <IndicatorInputsForm {...props} choices={{ timeframe }} />;
}
