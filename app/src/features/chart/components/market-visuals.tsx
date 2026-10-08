// Purpose: Project one market frame into React-owned chart series.
import { memo, useLayoutEffect, useMemo } from "react";
import { useStore } from "zustand";
import { v2 } from "@openchart/chart-core";
import { Color } from "@openchart/chart-core/util";
import type { BarColumn, TradingDay } from "@openchart/market";
import { joinByTime, type DataFrame } from "@openchart/timeseries";
import { useChart } from "@openchart/app/hooks/use-chart";
import type { MarketSeriesInput } from "@openchart/app/hooks/use-market-series-source";
import {
  mainTimeline,
  tagSessions,
  toRows,
} from "@openchart/app/lib/chart/data";
import {
  defaultSeriesPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import { chartTokenColor } from "@openchart/app/lib/chart/theme";
import { ChartSeries } from "./chart-series";

/** The bindings drawn as series; a volume profile runs its own Tea source. */
type Binding = MarketSeriesInput["bindings"][number] & {
  output: "price" | "volume";
};
/** The one place a binding's output becomes market Bar columns. Price bars also read open/high/low. */
const fields: Record<Binding["output"], { x: "time"; value: BarColumn }> = {
  price: { x: "time", value: "close" },
  volume: { x: "time", value: "volume" },
};

/** Market-specific options use the same chart series lifecycle as Tea outputs.
 * @example <MarketVisuals input={input} symbol={symbol} frame={bars.frame} localStore={preferences} />
 */
export const MarketVisuals = memo(function MarketVisuals({
  input,
  symbol,
  frame,
  days,
  localStore,
}: {
  input: MarketSeriesInput;
  symbol: string;
  frame: DataFrame | undefined;
  /** Calendar days whose sessions tag bars for the renderer's session shading. */
  days?: readonly TradingDay[];
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  const preferences = useStore(localStore);
  const bindings = input.bindings.filter(
    (binding): binding is Binding => binding.output !== "volumeProfile",
  );
  const main = bindings.some((binding) => binding.main);
  const mainData = useStore(chart.store, (state) => {
    const series = v2.ChartStateModel.mainSeries(state);
    return !main &&
      series &&
      !bindings.some((binding) => binding.id === series.id)
      ? series.data
      : undefined;
  });
  useStore(chart.store, (state) => state.config.chart.layout.background);
  const bars = useMemo(() => {
    if (!frame) return [];
    const timeline = mainData ? mainTimeline(chart.store.getState()) : [];
    return toRows(timeline.length ? joinByTime(timeline, frame) : frame);
  }, [chart, frame, mainData]);
  const rows = useMemo(
    () => (days ? tagSessions(bars, days) : bars),
    [bars, days],
  );
  const element = chart.renderer.canvas?.parentElement;
  const colors = {
    up: element ? chartTokenColor(element, "--up") : "#26a69a",
    down: element ? chartTokenColor(element, "--down") : "#ef5350",
    comparison: element
      ? chartTokenColor(
          element,
          `--chart-${((Math.max(1, input.colorIndex ?? 1) - 1) % 5) + 1}`,
        )
      : "#6366f1",
  };
  // The Resource says what a binding draws; preferences only style it.
  const optionsFor = (binding: Binding) => ({
    ...defaultSeriesPreferences,
    type: binding.main ? ("Candlestick" as const) : ("Line" as const),
    ...(binding.output === "volume" ? { valueLineVisible: false } : {}),
    ...preferences.series[binding.id],
  });
  const overlaysPrice = (pane: number) =>
    bindings.some(
      (binding) =>
        binding.pane === pane &&
        binding.output === "price" &&
        optionsFor(binding).visible,
    );
  useLayoutEffect(() => {
    chart.mutate((state) => {
      if (preferences.paneHeights.length === state.panes.length) {
        state.panes.forEach((pane, index) => {
          pane.height = preferences.paneHeights[index]!;
        });
        v2.ChartStateModel.normalizePaneHeights(state);
      }
      if (!preferences.comparison && state.comparison?.enabled)
        v2.ChartStateUtils.disableComparisonMode(state);
      if (
        preferences.comparison &&
        v2.ChartStateModel.mainSeries(state)?.data.length
      )
        v2.ChartStateUtils.enableComparisonMode(state, {
          anchorTime:
            preferences.comparisonAnchor === null
              ? undefined
              : preferences.comparisonAnchor / 1000,
          resetMainBaseline: true,
        });
    }, "full");
    const state = chart.store.getState();
    const axis = state.comparison?.enabled
      ? v2.ChartStateUtils.getYAxis(state, state.comparison.axisId)
      : undefined;
    if (
      main &&
      preferences.comparisonAnchor === null &&
      axis?.modeAnchor?.time !== undefined
    )
      localStore.setState({ comparisonAnchor: axis.modeAnchor.time * 1000 });
  }, [chart, preferences, localStore, main, rows]);
  return (
    <>
      {bindings.map((binding) => {
        const prefs = optionsFor(binding);
        const histogram = binding.output === "volume";
        const color =
          prefs.color ?? (binding.main ? colors.up : colors.comparison);
        const options = {
          ...prefs,
          title: histogram ? undefined : symbol,
          color,
          lineColor: color,
          topColor: Color.withAlpha(color, 0.25),
          bottomColor: Color.withAlpha(color, 0),
          topLineColor: color,
          bottomLineColor: prefs.color ?? colors.down,
          upColor: prefs.upColor ?? color,
          downColor: prefs.downColor ?? prefs.color ?? colors.down,
          wickUpColor: prefs.wickUpColor ?? prefs.upColor ?? color,
          wickDownColor:
            prefs.wickDownColor ??
            prefs.downColor ??
            prefs.color ??
            colors.down,
          borderUpColor: prefs.borderUpColor ?? prefs.upColor ?? color,
          borderDownColor:
            prefs.borderDownColor ??
            prefs.downColor ??
            prefs.color ??
            colors.down,
        };
        const axisId =
          histogram || prefs.ownAxis
            ? `${binding.id}:axis`
            : binding.pane === 0
              ? "right"
              : `pane:${binding.paneId ?? binding.pane}`;
        return (
          <ChartSeries
            source="provider"
            key={binding.id}
            id={binding.id}
            type={histogram ? "Histogram" : prefs.type}
            pane={binding.pane}
            axisId={axisId}
            main={binding.main}
            fieldMap={fields[binding.output]}
            options={options}
            axisOptions={{
              ...(histogram
                ? {
                    visible: false,
                    fixed: false,
                    lockZero: true,
                    margins: {
                      top: overlaysPrice(binding.pane) ? 0.75 : 0.05,
                      bottom: 0,
                    },
                  }
                : {
                    mode: preferences.axisMode,
                    autoScale: preferences.autoScale,
                    side: preferences.axisSide,
                  }),
              ...preferences.axes[axisId],
            }}
            data={
              histogram
                ? rows.map((row) =>
                    Object.freeze({
                      ...row,
                      color: Color.withAlpha(
                        prefs.color ??
                          (Number(row.close) >= Number(row.open)
                            ? colors.up
                            : colors.down),
                        overlaysPrice(binding.pane) ? 0.55 : 1,
                      ),
                    }),
                  )
                : rows
            }
          />
        );
      })}
    </>
  );
});
