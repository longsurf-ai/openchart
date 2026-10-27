// Purpose: Convert chart viewport demand into a requested computation window.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { debounceTime, filter } from "rxjs";
import { resolutionMs, type BarsSeries } from "@openchart/feed";
import { v2 } from "@openchart/chart-core";
import {
  initialBarsRequest,
  indexToTime,
  mainTimeline,
  timeToIndex,
  viewportNeedsReload,
} from "@openchart/app/lib/chart/data";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
/** A chart requested window, independent of Tea compilation and result handling.
 * Saved historical viewports replace distant windows and extend nearby ones.
 * Live demand follows the bars that fit the renderer, so retained historical
 * data cannot widen a return to latest. This hook owns no data subscription;
 * its renderer observation is released on unmount and fetch failures belong
 * to the consumer of the returned window.
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
        const state = chart.store.getState();
        const saved = preferences.getState().viewport;
        if (saved !== null) {
          const timeline = mainTimeline(state);
          if (!timeline.length) return;
          const step =
            resolutionMs[(JSON.parse(identity) as BarsSeries).resolution];
          const range = v2.ChartStateUtils.getVisibleRange(state);
          // Resizing exposes more bars to the left of the saved right anchor.
          // A retained frame for another target must not widen the request.
          // Native ordinal bounds round to bars, including across trading gaps.
          if (
            range.from > timeToIndex(timeline, saved.from, step) + 1 ||
            Math.abs(range.to - timeToIndex(timeline, saved.to, step)) > 1
          )
            return;
          const start = Math.floor(indexToTime(timeline, range.from, step));
          const end = Math.ceil(indexToTime(timeline, range.to, step));
          if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
            return;
          setWindow((previous) => {
            const active = previous.identity === identity ? previous : initial;
            if (
              start >= active.from &&
              (active.to === "now" || end < active.to)
            )
              return previous;
            return {
              ...active,
              from: Math.min(active.from, start - 120 * step),
              to: active.to === "now" ? "now" : Math.max(active.to, end + step),
              countBack: Math.max(
                active.countBack,
                Math.ceil(range.to - range.from) + 240,
              ),
            };
          });
          return;
        }
        // Latest demand comes from the bars that fit, not timestamps in a
        // retained historical frame while the main source returns to live.
        const wanted = initialBarsRequest(
          JSON.parse(identity) as BarsSeries,
          {
            viewport: null,
            barSpacing: v2.XScale.getAxis(state.config.xAxis).spacing
              .barSpacing,
          },
          state.config.chart.dimensions.width,
        );
        setWindow((previous) => {
          const active = previous.identity === identity ? previous : initial;
          if (active.to === "now" && active.countBack >= wanted.countBack)
            return previous;
          return {
            ...active,
            from:
              active.to === "now"
                ? Math.min(active.from, wanted.from)
                : wanted.from,
            to: "now",
            countBack:
              active.to === "now"
                ? Math.max(active.countBack, wanted.countBack)
                : wanted.countBack,
          };
        });
      });
    return () => subscription.unsubscribe();
  }, [chart, identity, initial, preferences]);

  const viewport = useStore(preferences, (state) => state.viewport);
  useEffect(() => {
    if (viewport === null && activeWindow.to === "now") return;
    if (viewport === null || viewportNeedsReload(activeWindow, viewport)) {
      setWindow({
        ...initial,
        ...initialBarsRequest(
          series,
          preferences.getState(),
          chart.store.getState().config.chart.dimensions.width,
        ),
      });
      return;
    }
    const step = resolutionMs[series.resolution];
    if (
      viewport.from < activeWindow.from ||
      (activeWindow.to !== "now" && viewport.to >= activeWindow.to)
    )
      setWindow({
        ...activeWindow,
        from: Math.min(
          activeWindow.from,
          Math.floor(viewport.from - 120 * step),
        ),
        to:
          activeWindow.to === "now"
            ? "now"
            : Math.max(activeWindow.to, Math.ceil(viewport.to + step)),
        countBack: Math.max(
          activeWindow.countBack,
          Math.ceil((viewport.to - viewport.from) / step) + 240,
        ),
      });
  }, [viewport, activeWindow, initial, chart, series, preferences]);
  return { from, to, countBack };
}
