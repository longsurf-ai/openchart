// Purpose: Route crosshairs between mounted charts using time rather than another chart's index.
import { Chart, v2 } from "@openchart/chart-core";
import { useEffect } from "react";

import {
  indexToTime,
  mainTimeline,
  timeToIndex,
} from "@openchart/app/lib/chart/data";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";

/** Link configuration is supplied by the Resource owner. */
export interface CrosshairLink {
  readonly fromCellId: string;
  readonly toCellId: string;
  readonly syncCrosshair: boolean;
}
/** Subscribe only to output events, never every chart's state. @example useChartLinks(charts, links); */
export function useChartLinks(
  charts: ReadonlyMap<string, ChartRuntime>,
  links: readonly CrosshairLink[],
) {
  useEffect(() => {
    const subscriptions = [...charts.values()].map((source) =>
      source.output$.subscribe((event) => {
        if (event.type !== "crosshair") return;
        const sourceTimes = mainTimeline(source.store.getState());
        const sourceStep =
          sourceTimes.length > 1
            ? sourceTimes[sourceTimes.length - 1]! -
              sourceTimes[sourceTimes.length - 2]!
            : 86400000;
        const time =
          event.index === undefined
            ? undefined
            : indexToTime(sourceTimes, event.index, sourceStep);
        for (const link of links) {
          if (!link.syncCrosshair || link.fromCellId !== source.id) continue;
          const target = charts.get(link.toCellId);
          if (!target) continue;
          const times = mainTimeline(target.store.getState());
          if (!times.length) continue;
          target.mutate((state) => {
            if (time === undefined || !Number.isFinite(time)) {
              v2.ChartStateUtils.hideCrosshair(state);
              return;
            }
            const step =
              times.length > 1
                ? times[times.length - 1]! - times[times.length - 2]!
                : 86400000;
            const index = Math.round(timeToIndex(times, time, step));
            const range = v2.ChartStateUtils.getVisibleRange(state);
            if (!range || index < range.from || index > range.to) {
              v2.ChartStateUtils.hideCrosshair(state);
              return;
            }
            const axis = v2.XScale.getAxis(state.config.xAxis);
            const layout = Chart.computeLayout(state.config);
            const x =
              layout.areaX +
              v2.XScale.ordinalIndexToX(
                state.config,
                axis,
                layout.areaWidth,
                times.length,
                index,
              );
            v2.ChartStateUtils.setCrosshair(
              state,
              x,
              undefined,
              index,
              time / 1000,
            );
          });
        }
      }),
    );
    return () =>
      subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [charts, links]);
}
