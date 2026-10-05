// Purpose: Run an actual library study against a bounded cache of real historical bars.
import { useEffect, useId, useLayoutEffect, useMemo } from "react";
import { useStore } from "zustand";
import { v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import { BarColumns } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { defineDataFrame, type DataFrame } from "@openchart/timeseries";
import { Button } from "@openchart/app/components/ui/button";
import type { IndicatorExample } from "@openchart/app/features/chart/api/indicator-examples";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import type { MarketSeriesInput } from "@openchart/app/hooks/use-market-series-source";
import { useTea } from "@openchart/app/hooks/use-tea";
import { ChartCore } from "@openchart/app/lib/chart/core";
import {
  createChartPreferences,
  updateSeriesStyles,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import { cn } from "@openchart/app/utils/cn";
import { ChartPanes } from "./chart-panes";
import { MarketVisuals } from "./market-visuals";
import { TeaVisuals } from "./tea-visuals";

type Props = {
  source: Tea.WorkspaceSources;
  example: IndicatorExample;
  parameters?: Tea.ParameterOverrides;
  /** Exclusive end of a curated historical scenario; the cached asset remains unchanged. */
  endTime?: number;
  /** Enable pan, zoom and retry in the detail view; cards stay a single click target. */
  interactive?: boolean;
  /**
   * Hears the parameter values the run bound, with defaults that follow the
   * chart resolved for the example, or undefined until it reports them.
   */
  onResolved?: (parameters: Tea.ParameterOverrides | undefined) => void;
  className?: string;
};
const defaultParameters: Tea.ParameterOverrides = {};
const PriceFrame = defineDataFrame(BarColumns);

function PreviewSources({
  source,
  example,
  frame,
  parameters,
  interactive,
  onResolved,
  preferences,
}: Required<Pick<Props, "source" | "example" | "parameters" | "interactive">> &
  Pick<Props, "onResolved"> & {
    preferences: ChartPreferencesStore;
    frame: DataFrame;
  }) {
  const chart = useChart();
  const { series } = example;
  const input = useMemo<MarketSeriesInput>(
    () => ({
      id: "preview-market",
      series,
      bindings: [
        {
          id: "preview-price",
          pane: 0,
          paneId: "pane-main",
          main: true,
          output: "price",
        },
      ],
    }),
    [series],
  );
  // The run reads only the example's captured bars: its weeks and months
  // serve request.security lines, and nothing comes from Feed.
  const samples = useMemo(
    () =>
      example.history.map(({ series, rows }): Tea.Samples => ({
        _tag: "Samples",
        ...series,
        schema: Tea.barsSchema,
        rows,
      })),
    [example.history],
  );
  const execution = useTea(
    {
      source,
      parameters,
      inputs: {
        bars: {
          _tag: "Samples",
          ...series,
          schema: Tea.barsSchema,
          rows: example.rows,
        },
      },
      map: Tea.barsInputs(series).map,
      requests: {},
      from: example.from,
      to: example.to,
      // Count only the displayed rows; the preceding cached bars are warmup.
      countBack: frame.numRows,
      warmupBars: Tea.standardWarmupBars,
    },
    { samples },
  );
  const resolved = execution.config?.parameters;
  useEffect(() => onResolved?.(resolved), [onResolved, resolved]);
  const layout = useMemo(() => {
    const main = { id: "pane-main", series: [{ id: "preview-price" }] };
    if (!execution.compiled) return { panes: [main], bindings: [] };
    try {
      const overlay = execution.compiled.declaration?.overlay === true;
      const bindings = Tea.indicatorOutputs(execution.compiled).map(
        ({ name }, index) => ({
          id: `preview-output-${index}`,
          output: name,
          pane: overlay ? 0 : 1,
          paneId: overlay ? "pane-main" : "preview-study",
          mainPane: overlay,
        }),
      );
      return {
        bindings,
        panes: overlay
          ? [{ ...main, series: [...main.series, ...bindings] }]
          : [main, { id: "preview-study", series: bindings }],
      };
    } catch (error) {
      return {
        panes: [main],
        bindings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [execution.compiled]);
  useLayoutEffect(() => {
    updateSeriesStyles(
      preferences,
      ["preview-price", ...layout.bindings.map(({ id }) => id)],
      {
        lastValueVisible: interactive ? undefined : false,
        valueLineVisible: interactive ? undefined : false,
      },
    );
  }, [preferences, interactive, layout.bindings]);
  const plotWidth = useStore(
    chart.store,
    (state) => Chart.computeLayout(state.config).areaWidth,
  );
  const futureBars = useStore(chart.store, (state) =>
    Math.max(
      0,
      ...v2.ChartStateModel.resolvedSeriesEntries(state).map(([, series]) =>
        Number(series.options.xOffset ?? 0),
      ),
    ),
  );
  useLayoutEffect(() => {
    chart.mutate((state) => {
      const visibleBars = Math.max(2, Math.floor(plotWidth / 4) + 1);
      v2.ChartStateUtils.setVisibleRange(
        state,
        Math.max(0, frame.numRows + futureBars - visibleBars),
        frame.numRows + futureBars,
      );
    }, "full");
  }, [chart, frame, plotWidth, futureBars]);
  const title = execution.compiled?.declaration?.title ?? "Study";
  useLayoutEffect(() => {
    chart.mutate((state) => {
      state.config.interaction.enabled = interactive;
    }, "full");
    chart.renderer.canvas.tabIndex = interactive ? 0 : -1;
    chart.renderer.canvas.setAttribute("aria-label", `${title} preview`);
  }, [chart, interactive, title]);

  const error = execution.error ?? layout.error;
  const retry = execution.retry;
  // Browsing several cards must not produce one toast per failed preview.
  // The detail reports the operational error and exposes the normal retry action.
  useErrorToast(interactive ? error : undefined, {
    id: `indicator-preview:${chart.id}`,
    title: "Couldn’t load study preview",
    retry,
  });
  const emptyStudy = execution.status === "ready" && !execution.data.numRows;
  const message = error
    ? "Preview unavailable"
    : emptyStudy
      ? "No study values in this range"
      : execution.status === "loading"
        ? "Loading chart…"
        : undefined;
  const ready = Boolean(frame.numRows && execution.data?.numRows);
  return (
    <>
      <ChartPanes panes={layout.panes} />
      <MarketVisuals
        input={input}
        symbol=""
        frame={frame}
        localStore={preferences}
      />
      <TeaVisuals
        sourceId={chart.id}
        compiled={execution.compiled}
        frame={execution.data}
        bindings={layout.bindings}
        preferences={preferences}
      />
      {message ? (
        <div
          role="status"
          className={cn(
            "absolute flex items-center justify-center gap-2 bg-background/95 px-3 py-2 text-center text-xs text-muted-foreground",
            ready ? "left-2 top-2 rounded-md border" : "inset-0",
          )}
        >
          <span>{message}</span>
          {error && interactive ? (
            <Button variant="link" size="xs" onClick={retry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Preview({
  source,
  example,
  parameters = defaultParameters,
  endTime = example.to,
  interactive = false,
  onResolved,
  className,
}: Props) {
  const id = `indicator-preview-${useId()}`;
  const preferences = useMemo(() => createChartPreferences(id, null), [id]);
  const scenario = useMemo(
    () => ({ ...example, to: Math.min(example.to, endTime) }),
    [example, endTime],
  );
  const frame = useMemo(
    () =>
      PriceFrame.create({
        labels: { symbol: scenario.series.listing.symbol },
        rows: scenario.rows.filter(
          ({ time }) => time >= scenario.from && time < scenario.to,
        ),
      }),
    [scenario],
  );
  return (
    <figure
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-col overflow-hidden",
        className,
      )}
    >
      {frame.numRows ? (
        <ChartCore id={id} className="min-h-0 w-full min-w-0 flex-1">
          <PreviewSources
            source={source}
            example={scenario}
            frame={frame}
            parameters={parameters}
            interactive={interactive}
            onResolved={onResolved}
            preferences={preferences}
          />
        </ChartCore>
      ) : (
        <div
          role="status"
          className="flex flex-1 items-center justify-center p-3 text-xs text-muted-foreground"
        >
          No preview data available
        </div>
      )}
    </figure>
  );
}

/** A real chart over supplied historical data. Pan/zoom only moves the viewport;
 * no Feed source mounts and Tea cannot fall back to provider requests.
 * @example <IndicatorPreview source={source} example={example} className="h-64" interactive />
 */
export function IndicatorPreview(props: Props) {
  return (
    <Preview
      key={JSON.stringify([props.source, props.example.id])}
      {...props}
    />
  );
}
