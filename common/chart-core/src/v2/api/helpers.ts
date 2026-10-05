// Purpose: Compute the visible min/max extent for a y-axis by scanning series data in the viewport
// Module:  @openchart/chart-core / v2 / api

import { Chart } from "@openchart/chart-core/chart/state";
import { Series, SeriesRegistry } from "@openchart/chart-core/series";
import { TimeScale } from "@openchart/chart-core/scale";
import type { YAxisConfig } from "@openchart/chart-core/scale/config";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";

type Axis = YAxisConfig.Axis;

function includeZero(extent: { min: number; max: number }): {
  min: number;
  max: number;
} {
  return {
    min: Math.min(0, extent.min),
    max: Math.max(0, extent.max),
  };
}

export function computeVisibleExtent(
  entry: { state: Chart.State },
  axisId: string,
): { min: number; max: number } {
  const axis = (entry.state.config.yAxis.axes as Axis[]).find(
    (item) => item.id === axisId,
  );
  if (axis?.visibleExtent) {
    const extent = { ...axis.visibleExtent };
    return axis.lockZero ? includeZero(extent) : extent;
  }

  const ts = Chart.buildAreaTimeScale(entry.state.config);
  const allSeries = ChartStateModel.resolvedSeriesValues(entry.state);
  const len = Math.max(1, ...allSeries.map((series) => series.data.length));
  const { valid: range } = TimeScale.visibleRange(ts, len);
  const axisSeries = allSeries.filter(
    (series) => Series.getYAxisId(series) === axisId,
  );

  let min = Infinity;
  let max = -Infinity;
  for (const series of axisSeries) {
    const def = SeriesRegistry.get(series.type);
    if (!def) continue;
    const ext = def.visibleExtent(
      series.data,
      range.from,
      range.to,
      series.fieldMap,
    );
    if (!ext) continue;
    if (ext.min < min) min = ext.min;
    if (ext.max > max) max = ext.max;
  }

  if (min === Infinity) return { min: 0, max: 100 };
  const extent = { min, max };
  const hasHistogram = axisSeries.some((series) => series.type === "Histogram");
  return axis?.lockZero || hasHistogram ? includeZero(extent) : extent;
}
