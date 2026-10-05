// Purpose: Follow the bars on screen as a time range, for work over what is visible.
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { debounceTime, filter } from "rxjs";
import { v2 } from "@openchart/chart-core";
import { resolutionMs, type BarsSeries } from "@openchart/feed";
import { indexToTime, mainTimeline } from "@openchart/app/lib/chart/data";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";

/**
 * The bars on screen as `[start, end)` in epoch milliseconds: from the first
 * visible bar's open to one bar after the last visible bar. Pans and zooms
 * update it after 300 ms without further movement, like the computation
 * window; new bars update it at once. Undefined until the chart has bars.
 * @example const range = useVisibleTimeRange(chart, series);
 */
export function useVisibleTimeRange(chart: ChartRuntime, series: BarsSeries) {
  const step = resolutionMs[series.resolution];
  const bars = useStore(
    chart.store,
    (state) => v2.ChartStateModel.mainSeries(state)?.data.length ?? 0,
  );
  const [range, setRange] = useState<{ start: number; end: number }>();
  useEffect(() => {
    const show = (from: number, to: number) => {
      const timeline = mainTimeline(chart.store.getState());
      if (!timeline.length) return;
      const first = Math.max(0, Math.ceil(from));
      const last = Math.min(timeline.length - 1, Math.floor(to));
      if (first > last) return;
      const start = indexToTime(timeline, first, step);
      const end = indexToTime(timeline, last, step) + step;
      setRange((previous) =>
        previous?.start === start && previous.end === end
          ? previous
          : { start, end },
      );
    };
    const visible = v2.ChartStateUtils.getVisibleRange(chart.store.getState());
    show(visible.from, visible.to);
    const subscription = chart.output$
      .pipe(
        filter((event) => event.type === "range"),
        debounceTime(300),
      )
      .subscribe((event) => {
        if (event.type === "range") show(event.from, event.to);
      });
    return () => subscription.unsubscribe();
  }, [chart, step, bars]);
  return range;
}
