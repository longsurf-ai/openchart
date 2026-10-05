// Purpose: Persist only chart display choices, separately from data and renderer state.
import { YAxisConfig } from "@openchart/chart-core/scale/config";
import { Series } from "@openchart/chart-core";
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";

/** Selectable price presentations. Volume is a Resource output, never a stored style. */
export const PriceType = z.enum([
  "Candlestick",
  "Bar",
  "Line",
  "Area",
  "Baseline",
  "Liveline",
]);
/** Style fields without defaults: persisted records contain only explicit choices. */
const SeriesStyle = z.object({
  type: PriceType,
  color: z.string().optional(),
  upColor: Series.CandlestickOptions.shape.upColor.unwrap().optional(),
  downColor: Series.CandlestickOptions.shape.downColor.unwrap().optional(),
  wickUpColor: Series.CandlestickOptions.shape.wickUpColor.unwrap().optional(),
  wickDownColor: Series.CandlestickOptions.shape.wickDownColor
    .unwrap()
    .optional(),
  borderUpColor: Series.CandlestickOptions.shape.borderUpColor
    .unwrap()
    .optional(),
  borderDownColor: Series.CandlestickOptions.shape.borderDownColor
    .unwrap()
    .optional(),
  wickVisible: Series.CandlestickOptions.shape.wickVisible.removeDefault(),
  borderVisible: Series.CandlestickOptions.shape.borderVisible.removeDefault(),
  visible: z.boolean(),
  lineWidth: z.number().min(0.5).max(10),
  lineStyle: z.enum(["solid", "dashed", "dotted"]),
  lastValueVisible: z.boolean(),
  valueLineVisible: z.boolean(),
  ownAxis: z.boolean(),
  /** Vertical profile part colors by part title, such as "Up volume": CSS colors. */
  partColors: z.record(z.string(), z.string().min(1)).optional(),
});
/** Complete defaults for market presentation and UI fallback; never persisted implicitly. */
export const SeriesPreferences = SeriesStyle.extend({
  type: SeriesStyle.shape.type.default("Candlestick"),
  wickVisible: SeriesStyle.shape.wickVisible.default(true),
  borderVisible: SeriesStyle.shape.borderVisible.default(true),
  visible: SeriesStyle.shape.visible.default(true),
  lineWidth: SeriesStyle.shape.lineWidth.default(1.5),
  lineStyle: SeriesStyle.shape.lineStyle.default("solid"),
  lastValueVisible: SeriesStyle.shape.lastValueVisible.default(true),
  valueLineVisible: SeriesStyle.shape.valueLineVisible.default(true),
  ownAxis: SeriesStyle.shape.ownAxis.default(false),
});
/** Display state is local; the server owns selected inputs and their identities. */
export const ChartPreferences = z.object({
  viewport: z
    .object({ from: z.number(), to: z.number() })
    .refine((v) => v.to > v.from)
    .nullable()
    .default(null),
  barSpacing: z.number().min(0.5).max(50).default(6),
  rightOffset: z.number().nonnegative().default(0),
  series: z.record(z.string(), SeriesStyle.partial()).default({}),
  axisMode: z
    .enum(["normal", "logarithmic", "percentage", "indexed"])
    .default("normal"),
  axisSide: z.enum(["left", "right"]).default("right"),
  autoScale: z.boolean().default(true),
  axes: z
    .record(
      z.string(),
      YAxisConfig.Axis.pick({
        mode: true,
        side: true,
        autoScale: true,
        invertScale: true,
      }).partial(),
    )
    .default({}),
  comparison: z.boolean().default(false),
  comparisonAnchor: z.number().nullable().default(null),
  paneHeights: z.array(z.number().positive()).default([]),
});
export type ChartPreferences = z.infer<typeof ChartPreferences>;
export type SeriesPreferences = z.infer<typeof SeriesPreferences>;
/** Shared defaults are immutable and do not create a new selector result. */
export const defaultSeriesPreferences = Object.freeze(
  SeriesPreferences.parse({}),
);

/**
 * Create one persisted local store per chart identity. Invalid old preferences reset to defaults.
 * An initial viewport instead creates an unsaved store, so embeds never move the chart's saved view.
 * @example const localStore = createChartPreferences(cell.id);
 */
export function createChartPreferences(
  id: string,
  initialViewport?: ChartPreferences["viewport"],
): StoreApi<ChartPreferences> {
  if (initialViewport !== undefined)
    return createStore<ChartPreferences>()(() =>
      ChartPreferences.parse({ viewport: initialViewport }),
    );
  return createStore<ChartPreferences>()(
    persist(() => ChartPreferences.parse({}), {
      name: `local:chart:${id}`,
      version: 1,
      merge: (saved, current) => {
        const parsed = ChartPreferences.safeParse(saved);
        return parsed.success ? parsed.data : current;
      },
    }),
  );
}
/** Per-instance preferences; never a module singleton. */
export type ChartPreferencesStore = ReturnType<typeof createChartPreferences>;

/** Save just the changed fields; undefined removes an override so its source default applies again.
 * @example updateSeriesStyles(preferences, [seriesId], { color: "#ff0000" });
 */
export function updateSeriesStyles(
  store: ChartPreferencesStore,
  ids: readonly string[],
  change: Partial<SeriesPreferences>,
) {
  store.setState((state) => ({
    series: {
      ...state.series,
      ...Object.fromEntries(
        ids.map((id) => [
          id,
          Object.fromEntries(
            Object.entries({ ...state.series[id], ...change }).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        ]),
      ),
    },
  }));
}
