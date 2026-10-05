// Purpose: Series type definitions, Zod option schemas, and the Def interface for pluggable series
// Module:  @openchart/chart-core / series

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Render } from "@openchart/chart-core/render";
import { CoordSys } from "@openchart/chart-core/coord";
import { HitTest } from "@openchart/chart-core/hit";
import { DataView } from "@openchart/chart-core/data";

export namespace Series {
  export const BuiltinType = z.enum([
    "Line",
    "Area",
    "Histogram",
    "Bar",
    "Candlestick",
    "Baseline",
    "Liveline",
  ]);
  export type BuiltinType = z.infer<typeof BuiltinType>;
  // Backward-compatible alias for v1 callsites.
  export const Type = BuiltinType;
  export type Type = BuiltinType;

  export const SelectionGlow = z.object({
    colors: z.array(z.string()).optional(),
    enabled: z.boolean().default(false),
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative(),
    speed: z.number().positive().default(1),
  });
  export type SelectionGlow = z.infer<typeof SelectionGlow>;

  export const Options = z.object({
    /** Draw at an ordinal bar offset without changing the source timestamps. */
    xOffset: z.number().int().default(0),
    visible: z.boolean().default(true),
    title: z.string().default(""),
    yAxis: z.enum(["left", "right"]).default("right"),
    lastValueVisible: z.boolean().default(true),
    lastValueTagColor: z.string().optional(),
    lastValueTextColor: z.string().optional(),
    valueLineVisible: z.boolean().default(true),
    valueLineMode: z.enum(["off", "partial", "extended"]).optional(),
    valueLineColor: z.string().optional(),
    valueLineStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    selectionGlow: SelectionGlow.optional(),
    valueFormat: z
      .object({
        type: z.enum(["price", "volume", "percent", "custom"]).default("price"),
        precision: z.number().default(2),
        minMove: z.number().default(0.01),
      })
      .default({ type: "price", precision: 2, minMove: 0.01 }),
  });
  export type Options = z.infer<typeof Options>;

  export const LineOptions = Options.extend({
    color: z.string().default("#2196F3"),
    lineWidth: z.number().default(1.5),
    lineStyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
    lineType: z.enum(["linear", "step", "circles", "cross"]).default("linear"),
    crosshairMarkerVisible: z.boolean().default(true),
    crosshairMarkerRadius: z.number().default(4),
    fadeGradient: z.boolean().default(false),
    fadeMinAlpha: z.number().default(0.15),
  });
  export type LineOptions = z.infer<typeof LineOptions>;

  export const AreaOptions = Options.extend({
    // Omitted means pane-floor shading; an explicit base anchors the fill.
    base: z.number().optional(),
    lineColor: z.string().default("#2196F3"),
    topColor: z.string().default("rgba(33, 150, 243, 0.3)"),
    bottomColor: z.string().default("rgba(33, 150, 243, 0)"),
    lineWidth: z.number().default(1.5),
  });
  export type AreaOptions = z.infer<typeof AreaOptions>;

  export const HistogramOptions = Options.extend({
    color: z.string().default("#26a69a"),
    base: z.number().default(0),
    positiveColor: z.string().optional(),
    positiveFadedColor: z.string().optional(),
    negativeColor: z.string().optional(),
    negativeFadedColor: z.string().optional(),
  });
  export type HistogramOptions = z.infer<typeof HistogramOptions>;

  export const BarOptions = Options.extend({
    upColor: z.string().default("#26a69a"),
    downColor: z.string().default("#ef5350"),
    volumeUpColor: z.string().default("#26a69a"),
    volumeDownColor: z.string().default("#ef5350"),
    thinBars: z.boolean().default(true),
  });
  export type BarOptions = z.infer<typeof BarOptions>;

  export const CandlestickOptions = Options.extend({
    upColor: z.string().default("#26a69a"),
    downColor: z.string().default("#ef5350"),
    volumeUpColor: z.string().default("#26a69a"),
    volumeDownColor: z.string().default("#ef5350"),
    borderVisible: z.boolean().default(true),
    borderColor: z.string().default("#378658"),
    borderUpColor: z.string().default("#26a69a"),
    borderDownColor: z.string().default("#ef5350"),
    wickVisible: z.boolean().default(true),
    wickColor: z.string().default("#737375"),
    wickUpColor: z.string().default("#26a69a"),
    wickDownColor: z.string().default("#ef5350"),
  });
  export type CandlestickOptions = z.infer<typeof CandlestickOptions>;

  export const BaselineOptions = Options.extend({
    baseValue: z
      .union([
        z.object({ type: z.literal("price"), price: z.number() }),
        z.object({ type: z.literal("percent"), percent: z.number() }),
      ])
      .default({ type: "percent", percent: 0 }),
    topFillColor1: z.string().default("rgba(38, 166, 154, 0.28)"),
    topFillColor2: z.string().default("rgba(38, 166, 154, 0)"),
    topLineColor: z.string().default("rgba(38, 166, 154, 1)"),
    bottomFillColor1: z.string().default("rgba(239, 83, 80, 0)"),
    bottomFillColor2: z.string().default("rgba(239, 83, 80, 0.28)"),
    bottomLineColor: z.string().default("rgba(239, 83, 80, 1)"),
    lineWidth: z.number().default(1.5),
  });
  export type BaselineOptions = z.infer<typeof BaselineOptions>;

  export const LivelineOptions = Options.extend({
    color: z.string().default("#2196F3"),
    lineWidth: z.number().default(1.5),
    lineStyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
    crosshairMarkerVisible: z.boolean().default(true),
    crosshairMarkerRadius: z.number().default(4),
    fadeGradient: z.boolean().default(true),
    fadeMinAlpha: z.number().default(0.08),
  });
  export type LivelineOptions = z.infer<typeof LivelineOptions>;

  export const OptionsMap = {
    Line: LineOptions,
    Area: AreaOptions,
    Histogram: HistogramOptions,
    Bar: BarOptions,
    Candlestick: CandlestickOptions,
    Baseline: BaselineOptions,
    Liveline: LivelineOptions,
  } as const;

  export const FieldMap = z.record(z.string(), z.string());
  export type FieldMap = z.infer<typeof FieldMap>;

  export const State = z.object({
    id: z.string(),
    type: z.string(),
    options: z.record(z.string(), z.unknown()),
    data: z.array(z.unknown()),
    yAxisId: z.string().default("right"),
    xAxisId: z.string().default("main"),
    fieldMap: FieldMap.optional(),
    // Legacy v1 alias.
    axisId: z.string().optional(),
    parentId: z.string().optional(),
  });
  export type BuiltinOptions =
    | LineOptions
    | AreaOptions
    | HistogramOptions
    | BarOptions
    | CandlestickOptions
    | BaselineOptions
    | LivelineOptions;

  export type State = Omit<z.infer<typeof State>, "options"> & {
    options: BuiltinOptions | Record<string, unknown>;
    primitives?: unknown; // Managed by PrimitiveWrapper.SeriesState
  };

  export function getYAxisId(state: Pick<State, "yAxisId" | "axisId">): string {
    return state.yAxisId ?? state.axisId ?? "right";
  }

  export function getXAxisId(state: Pick<State, "xAxisId">): string {
    return state.xAxisId ?? "main";
  }

  export type DimensionMap = Record<string, string | string[]>;

  export interface Extent {
    min: number;
    max: number;
  }

  export interface Def<T extends string = string> {
    type: T;
    defaultOptions: Record<string, unknown>;
    coordSys: string;
    fieldRoles?: FieldMap;
    dimensions(options: Record<string, unknown>): DimensionMap;
    extent(
      data: unknown[],
      dim: string,
      field: string,
      fieldMap?: FieldMap,
    ): Extent | null;
    visibleExtent(
      data: unknown[],
      from: number,
      to: number,
      fieldMap?: FieldMap,
    ): Extent | null;
    transform(
      view: DataView.View<unknown>,
      coord: CoordSys.State,
      barWidth: number,
      options: Record<string, unknown>,
      fieldMap?: FieldMap,
    ): unknown[];
    render(
      ctx: CanvasRenderingContext2D,
      items: unknown[],
      range: Render.Range,
      options: Record<string, unknown>,
    ): void;
    hitTest?(
      x: number,
      y: number,
      items: unknown[],
      range: Render.Range,
      options: Record<string, unknown>,
    ): HitTest.Result | null;
  }

  export function define<T extends string>(def: Def<T>): Def<T> {
    return def;
  }
}

export const RuntimeVolumeSeriesOptions = {
  title: "Volume",
  valueLineVisible: false,
} as const satisfies Partial<Series.HistogramOptions>;

export const RuntimeVolumeYAxisOptions = {
  id: "volume",
  side: "right",
  visible: false,
  fixed: false,
  mode: "normal",
  autoScale: true,
  lockZero: true,
  margins: { top: 0.75, bottom: 0 },
} as const;
