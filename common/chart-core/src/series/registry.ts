// Purpose: Global registry mapping series type names to their Def objects
// Module:  @openchart/chart-core / series

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Series } from "./def";
import {
  LineSeries,
  AreaSeries,
  HistogramSeries,
  BarSeries,
  CandlestickSeries,
  BaselineSeries,
  LivelineSeries,
} from "./builtin";

export namespace SeriesRegistry {
  const registry = new Map<string, Series.Def<string>>();

  // Register built-in series
  registry.set("Line", LineSeries);
  registry.set("Area", AreaSeries);
  registry.set("Histogram", HistogramSeries);
  registry.set("Bar", BarSeries);
  registry.set("Candlestick", CandlestickSeries);
  registry.set("Baseline", BaselineSeries);
  registry.set("Liveline", LivelineSeries);

  export function get<T extends string>(type: T): Series.Def<T> | undefined {
    return registry.get(type) as Series.Def<T> | undefined;
  }

  export function register<T extends string>(def: Series.Def<T>): void {
    registry.set(def.type, def);
  }

  export function types(): string[] {
    return Array.from(registry.keys());
  }
}
