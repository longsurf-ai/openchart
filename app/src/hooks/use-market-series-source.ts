// Purpose: Bind one cancellable Bars input to all of its chart presentations.
import { v2 } from "@openchart/chart-core";
import {
  resolutionMs,
  type BarsSeries,
  type Resolution,
} from "@openchart/feed";
import { mergeByTime, type DataFrame } from "@openchart/timeseries";
import { useLayoutEffect, useMemo, useState } from "react";
import { debounceTime, filter } from "rxjs";
import { useStore } from "zustand";

import {
  applyTimeViewport,
  indexToTime,
  initialBarsRequest,
  mainTimeline,
} from "@openchart/app/lib/chart/data";
import {
  type ChartPreferencesStore,
  type ChartPreferences,
} from "@openchart/app/lib/chart/preferences";
import type { ChartOutput, ChartRuntime } from "@openchart/app/lib/chart/store";

import { useBars } from "./use-bars";

/** One selected input can supply several independently styled display series. */
export interface MarketSeriesInput {
  readonly id: string;
  readonly colorIndex?: number;
  readonly series: BarsSeries;
  readonly bindings: readonly {
    id: string;
    pane: number;
    paneId?: string;
    main: boolean;
    /**
     * What this display draws from the shared bars: the price bar, its volume,
     * or the volume profile of the visible range.
     */
    output: "price" | "volume" | "volumeProfile";
    /** A volume profile's saved settings: the bars it counts and its rows. */
    profile?: { readonly resolution?: Resolution; readonly rows?: number };
  }[];
}

/** A single useBars owns the channel; bindings and styles only change its projections. @example const bars = useMarketSeriesSource(chart, input, localStore); */
export function useMarketSeriesSource(
  chart: ChartRuntime,
  input: MarketSeriesInput,
  localStore: ChartPreferencesStore,
) {
  const preferences = useStore(localStore);
  const identity = JSON.stringify(input.series);
  const initialWindow = useMemo(() => {
    const { from, to, countBack } = initialBarsRequest(
      input.series,
      localStore.getState(),
      chart.store.getState().config.chart.dimensions.width,
    );
    return { identity, from, to, countBack };
  }, [identity, input.series, localStore, chart]);
  const [window, setWindow] = useState(initialWindow);
  const activeWindow = window.identity === identity ? window : initialWindow;
  useLayoutEffect(() => {
    if (window.identity !== identity) setWindow(initialWindow);
  }, [window.identity, identity, initialWindow]);
  const request = useMemo(
    () => ({
      ...input.series,
      from: activeWindow.from,
      to: activeWindow.to,
      countBack: activeWindow.countBack,
    }),
    [input.series, activeWindow],
  );
  const bars = useBars(request);
  const { current, status } = bars;
  const [projectionError, setProjectionError] = useState<string>();
  const [materialized, setMaterialized] = useState<{
    view: typeof current;
    data: DataFrame;
    viewport: ChartPreferences["viewport"] | undefined;
  }>();
  const frame =
    materialized?.view === current ? materialized?.data : current?.data;
  const main = input.bindings.some((binding) => binding.main);
  const step = resolutionMs[input.series.resolution];
  useLayoutEffect(() => {
    setProjectionError(undefined);
    if (!current) return;
    let data = current.data;
    setMaterialized({
      view: current,
      data,
      viewport: localStore.getState().viewport,
    });
    const subscription = current.updates.subscribe({
      next: (update) => {
        try {
          const state = chart.store.getState();
          const timeline = mainTimeline(state);
          const range = v2.ChartStateUtils.getVisibleRange(state);
          const historical =
            main &&
            timeline.length &&
            v2.XScale.getAxis(state.config.xAxis).spacing.rightOffset < 0;
          const viewport = historical
            ? {
                from: indexToTime(timeline, range.from, step),
                to: indexToTime(timeline, range.to, step),
              }
            : undefined;
          data = mergeByTime(data, update);
          setMaterialized({ view: current, data, viewport });
        } catch (error) {
          setProjectionError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
      error: () => {}, // useBars exposes transport failures.
    });
    return () => subscription.unsubscribe();
  }, [current, chart, localStore, main, step]);
  // Child ChartSeries layout effects install data before this source restores the viewport.
  useLayoutEffect(() => {
    if (!main || !frame) return;
    const viewport =
      materialized && materialized.view === current
        ? materialized.viewport
        : localStore.getState().viewport;
    if (viewport === undefined) return;
    chart.mutate((state) => {
      if (viewport === null) {
        const saved = localStore.getState();
        v2.XScale.setAxisSpacing(
          state.config.xAxis,
          state.config.xAxis.activeId,
          {
            barSpacing: saved.barSpacing,
            rightOffset: saved.rightOffset,
          },
        );
      } else applyTimeViewport(state, viewport, step);
    });
  }, [chart, frame, materialized, current, localStore, main, step]);

  useLayoutEffect(() => {
    const subscription = chart.output$
      .pipe(
        filter(
          (event): event is Extract<ChartOutput, { type: "range" }> =>
            event.type === "range",
        ),
        debounceTime(300),
      )
      .subscribe((range) => {
        const timeline = mainTimeline(chart.store.getState());
        if (!timeline.length) return;
        const from = indexToTime(timeline, range.from, step),
          to = indexToTime(timeline, range.to, step);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
          return;
        if (main && !(request.to === "now" && current?.request.to !== "now")) {
          const spacing = v2.XScale.getAxis(
            chart.store.getState().config.xAxis,
          ).spacing;
          const viewport = spacing.rightOffset >= 0 ? null : { from, to };
          localStore.setState((previous) =>
            previous.barSpacing === spacing.barSpacing &&
            previous.rightOffset === Math.max(0, spacing.rightOffset) &&
            previous.viewport?.from === viewport?.from &&
            previous.viewport?.to === viewport?.to
              ? previous
              : {
                  viewport,
                  barSpacing: spacing.barSpacing,
                  rightOffset: Math.max(0, spacing.rightOffset),
                },
          );
        }
        if (status !== "ready" || !current?.data.numRows) return;
        const visible = Math.max(1, range.to - range.from),
          pad = Math.max(2, Math.floor(visible * 0.1));
        // History starts at the snapshot's first bar. Depending on the live frame
        // would cancel pending pans on every tick.
        if (
          current.hasMoreBefore &&
          from < current.data.get(0)!.time + pad * step
        )
          setWindow((previous) => ({
            ...previous,
            from: Math.min(previous.from, Math.floor(from - visible * step)),
            countBack:
              previous.countBack + Math.max(120, Math.ceil(visible * 1.25)),
          }));
        else if (request.to !== "now" && to >= request.to)
          setWindow((previous) => ({
            ...previous,
            to: to >= Date.now() - step ? "now" : Math.ceil(to + step),
          }));
      });
    return () => subscription.unsubscribe();
  }, [chart, current, status, request.to, localStore, main, step]);

  useLayoutEffect(() => {
    if (preferences.viewport !== null || activeWindow.to === "now") return;
    const { from, to, countBack } = initialBarsRequest(
      input.series,
      localStore.getState(),
      chart.store.getState().config.chart.dimensions.width,
    );
    setWindow({ identity, from, to, countBack });
  }, [
    preferences.viewport,
    activeWindow.to,
    input.series,
    localStore,
    chart,
    identity,
  ]);

  useLayoutEffect(() => {
    const anchor = preferences.comparisonAnchor;
    if (preferences.comparison && anchor !== null && anchor < activeWindow.from)
      setWindow((previous) => ({
        ...previous,
        from: Math.floor(anchor - step),
      }));
  }, [
    preferences.comparison,
    preferences.comparisonAnchor,
    activeWindow.from,
    step,
  ]);

  return { ...bars, frame, projectionError };
}
