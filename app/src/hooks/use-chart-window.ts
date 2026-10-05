// Purpose: Convert chart viewport demand into a requested computation window.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { debounceTime, filter } from "rxjs";
import { resolutionMs, type BarsSeries } from "@openchart/feed";
import {
  initialBarsRequest,
  indexToTime,
  mainTimeline,
} from "@openchart/app/lib/chart/data";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
/** A chart requested window, independent of Tea compilation and result handling.
 * @example const window = useChartWindow(chart, series, preferences);
 */
export function useChartWindow(
  chart: ChartRuntime,
  series: BarsSeries,
  preferences: ChartPreferencesStore,
) {
  const identity = JSON.stringify(series);
  const initial = useMemo(
    () => ({
      identity,
      ...initialBarsRequest(
        JSON.parse(identity) as BarsSeries,
        preferences.getState(),
        chart.store.getState().config.chart.dimensions.width,
      ),
    }),
    [identity, preferences, chart],
  );
  const [window, setWindow] = useState(initial);
  const activeWindow = window.identity === identity ? window : initial;
  const from = activeWindow.from,
    to = activeWindow.to,
    countBack = activeWindow.countBack;
  useEffect(() => {
    const subscription = chart.output$
      .pipe(
        filter((event) => event.type === "range"),
        debounceTime(300),
      )
      .subscribe((event) => {
        if (event.type !== "range") return;
        const timeline = mainTimeline(chart.store.getState());
        if (!timeline.length) return;
        const series = JSON.parse(identity) as BarsSeries;
        const step = resolutionMs[series.resolution];
        const start = Math.floor(indexToTime(timeline, event.from, step));
        const end = Math.ceil(indexToTime(timeline, event.to, step));
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
          return;
        const latest = preferences.getState().viewport === null;
        setWindow((previous) => {
          const active = previous.identity === identity ? previous : initial;
          if (
            start >= active.from &&
            (active.to === "now" || (!latest && end < active.to))
          )
            return previous;
          return {
            ...active,
            from: Math.min(active.from, start - 120 * step),
            to: latest
              ? "now"
              : active.to === "now"
                ? "now"
                : Math.max(active.to, end + step),
            countBack: Math.max(
              active.countBack,
              Math.ceil((end - start) / step) + 240,
            ),
          };
        });
      });
    return () => subscription.unsubscribe();
  }, [chart, identity, initial, preferences]);

  const latest = useStore(preferences, (state) => state.viewport === null);
  useEffect(() => {
    if (!latest || activeWindow.to === "now") return;
    setWindow({
      ...initial,
      ...initialBarsRequest(
        series,
        preferences.getState(),
        chart.store.getState().config.chart.dimensions.width,
      ),
    });
  }, [latest, activeWindow.to, initial, chart, series, preferences]);
  return { from, to, countBack };
}
