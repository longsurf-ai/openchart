// Purpose: Zod schemas and types for control panel state (symbol, resolution, range, series type, layout) and visibility options
// Module:  @openchart/chart-core / control

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { BarCadence } from "@openchart/chart-core/market/resolution";
import { GridLayout } from "@openchart/chart-core/view/layout";

export namespace ControlPanelConfig {
  export const Resolution = BarCadence;
  export type Resolution = z.infer<typeof Resolution>;

  export const Range = z.enum(["1d", "5d", "1m", "6m", "1y", "5y", "max"]);
  export type Range = z.infer<typeof Range>;

  export const SeriesType = z.enum([
    "Line",
    "Bar",
    "Histogram",
    "Area",
    "Candlestick",
    "Liveline",
  ]);
  export type SeriesType = z.infer<typeof SeriesType>;

  export const State = z.object({
    symbol: z.string().default(""),
    resolution: Resolution.default("1h"),
    range: Range.default("1d"),
    seriesType: SeriesType.default("Candlestick"),
    layout: GridLayout.Preset.default("1x1"),
    focusedCellId: z.string().nullable().default(null),
  });
  export type State = z.infer<typeof State>;

  export const Options = z.object({
    showLogo: z.boolean().default(true),
    showSymbol: z.boolean().default(true),
    showResolution: z.boolean().default(true),
    showRange: z.boolean().default(true),
    showSeriesType: z.boolean().default(true),
    showLayout: z.boolean().default(true),
  });
  export type Options = z.infer<typeof Options>;
}
