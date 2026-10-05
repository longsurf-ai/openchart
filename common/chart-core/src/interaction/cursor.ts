// Purpose: Magnet-crosshair Y snap logic — finds closest attach point on a series at a given index
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Chart } from "@openchart/chart-core/chart/state";
import { CoordSys } from "@openchart/chart-core/coord";
import { Series } from "@openchart/chart-core/series";

type Entry = {
  state: Chart.State;
  coord?: import("@openchart/chart-core/coord").CoordSys.State;
};

export namespace Cursor {
  /**
   * Extract attach point values from a data point based on series type.
   * - Candlestick: open, close
   * - Bar: high, low
   * - Line, Area, Histogram, Baseline: value
   */
  function getAttachPoints(
    series: Series.State,
    point: Record<string, unknown>,
  ): number[] {
    const values: number[] = [];
    const field = (role: string, fallback: string) =>
      series.fieldMap?.[role] ?? fallback;

    if (series.type === "Candlestick") {
      const open = point[field("open", "open")];
      const close = point[field("close", "close")];
      if (typeof open === "number") values.push(open);
      if (typeof close === "number") values.push(close);
    } else if (series.type === "Bar") {
      const high = point[field("high", "high")];
      const low = point[field("low", "low")];
      if (typeof high === "number") values.push(high);
      if (typeof low === "number") values.push(low);
    } else {
      const value = point[field("value", "value")];
      if (typeof value === "number") values.push(value);
    }

    return values;
  }

  /**
   * Compute the Y pixel position for magnet crosshair mode.
   * Snaps to the closest attachable value of the target series (or first series) at the given index.
   * Uses the cached coordinate system from the last paint.
   */
  export function magnetY(
    entry: Entry,
    index: number,
    cursorY: number,
    targetSeries?: Series.State,
  ): number | undefined {
    const coord = entry.coord;
    if (!coord) return undefined;

    const series = Chart.seriesInOrder(entry.state);
    if (series.length === 0) return undefined;

    const s = targetSeries ?? series[0]!;
    const point = s.data[index] as Record<string, unknown> | undefined;
    if (!point) return undefined;

    const values = getAttachPoints(s, point);
    if (values.length === 0) return undefined;

    const scaleId = Series.getYAxisId(s);
    const yScale = coord.scales.y[scaleId];
    if (!yScale) return undefined;

    const toPixel = (v: number) => Math.round(CoordSys.toPixel(v, yScale));

    let closest = values[0]!;
    let minDist = Math.abs(toPixel(closest) - cursorY);

    for (let i = 1; i < values.length; i++) {
      const dist = Math.abs(toPixel(values[i]!) - cursorY);
      if (dist < minDist) {
        minDist = dist;
        closest = values[i]!;
      }
    }

    return toPixel(closest);
  }
}
