// Purpose: Built-in series implementations (Line, Area, Histogram, Bar, Candlestick, Baseline, Liveline)
// Module:  @openchart/chart-core / series

import { DataView } from "@openchart/chart-core/data";
import { Render, Draw } from "@openchart/chart-core/render";
import { Series } from "./def";
import { resolveHistogramBarColor } from "./histogram-color";
import { CoordSys } from "@openchart/chart-core/coord";
import { Constants, Color } from "@openchart/chart-core/util";

function resolveField(
  fieldMap: Series.FieldMap | undefined,
  role: string,
  fallback: string,
): string {
  return fieldMap?.[role] ?? fallback;
}

// Missing samples stay gaps through projection; Number(null) would invent zero.
function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

function timeExtent(data: unknown[]): Series.Extent | null {
  if (data.length === 0) return null;
  return { min: 0, max: data.length - 1 };
}

function numericFieldExtent(
  data: unknown[],
  field: string,
): Series.Extent | null {
  if (data.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    const v = (d as Record<string, unknown>)[field];
    if (typeof v !== "number") continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return null;
  return { min, max };
}

function valueExtent(data: unknown[], field: string): Series.Extent | null {
  if (data.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    const v = (d as Record<string, unknown>)[field];
    if (typeof v !== "number") continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return null;
  const range = max - min;
  const margin = range * Constants.EXTENT_PADDING;
  return { min: min - margin, max: max + margin };
}

function histogramValueExtent(
  data: unknown[],
  from: number,
  to: number,
  field: string,
): Series.Extent | null {
  const extent = visibleValueExtent(data, from, to, field);
  if (!extent) return null;
  return {
    min: Math.min(0, extent.min),
    max: Math.max(0, extent.max),
  };
}

// Visible extent for simple value-based series
function visibleValueExtent(
  data: unknown[],
  from: number,
  to: number,
  field: string = "value",
): Series.Extent | null {
  if (data.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  const start = Math.max(0, from);
  const end = Math.min(data.length, to);
  for (let i = start; i < end; i++) {
    const d = data[i] as Record<string, unknown>;
    if (!d) continue;
    const v = d[field];
    if (typeof v === "number") {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return null;
  return { min, max };
}

// Visible extent for OHLC series (only uses high/low)
function visibleOHLCExtent(
  data: unknown[],
  from: number,
  to: number,
  fieldMap?: Series.FieldMap,
): Series.Extent | null {
  if (data.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  const start = Math.max(0, from);
  const end = Math.min(data.length, to);
  const highField = resolveField(fieldMap, "high", "high");
  const lowField = resolveField(fieldMap, "low", "low");
  for (let i = start; i < end; i++) {
    const d = data[i] as Record<string, unknown>;
    if (!d) continue;
    const high = d[highField];
    const low = d[lowField];
    if (typeof high === "number" && high > max) max = high;
    if (typeof low === "number" && low < min) min = low;
  }
  if (min === Infinity) return null;
  return { min, max };
}

function toY(coord: CoordSys.State, value: number, scaleId: string): number {
  if (!Number.isFinite(value)) return NaN;
  const scale = coord.scales.y[scaleId] ?? coord.scales.y[coord.defaultYScale];
  if (!scale) return coord.bounds.y + coord.bounds.height / 2;
  return Math.round(CoordSys.toPixel(value, scale));
}

export const LineSeries = Series.define({
  type: "Line",
  defaultOptions: Series.LineOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: { x: "time", value: "value", color: "color" },

  dimensions() {
    return { x: "x", y: "value" };
  },

  extent(data, dim, field, fieldMap) {
    if (dim === "x" && field === "x") {
      const xField = resolveField(fieldMap, "x", "time");
      return numericFieldExtent(data, xField) ?? timeExtent(data);
    }
    if (dim === "y" && field === "value")
      return valueExtent(data, resolveField(fieldMap, "value", "value"));
    return null;
  },

  visibleExtent(data, from, to, fieldMap) {
    return visibleValueExtent(
      data,
      from,
      to,
      resolveField(fieldMap, "value", "value"),
    );
  },

  transform(view, coord, _barWidth, options, fieldMap) {
    const opts = options as Series.LineOptions;
    const scaleId = coord.defaultYScale;
    const valueField = resolveField(fieldMap, "value", "value");
    const colorField = resolveField(fieldMap, "color", "color");
    return (view as DataView.View<Record<string, unknown>>).map((d, i, x) => ({
      x,
      y: toY(coord, numeric(d[valueField]), scaleId),
      index: i,
      color:
        (typeof d[colorField] === "string" ? d[colorField] : undefined) ??
        opts.color,
    }));
  },

  render(ctx, items, range, options) {
    const opts = options as Series.LineOptions;
    const points = items as Render.Point[];
    if (opts.lineType === "circles" || opts.lineType === "cross") {
      ctx.save();
      for (let i = range.from; i < range.to; i++) {
        const point = points[i];
        if (!point || !Number.isFinite(point.y)) continue;
        const radius = Math.max(2, opts.lineWidth + 1);
        ctx.fillStyle = point.color;
        ctx.strokeStyle = point.color;
        ctx.lineWidth = opts.lineWidth;
        ctx.beginPath();
        if (opts.lineType === "circles") {
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.moveTo(point.x - radius, point.y);
          ctx.lineTo(point.x + radius, point.y);
          ctx.moveTo(point.x, point.y - radius);
          ctx.lineTo(point.x, point.y + radius);
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }
    const linePoints =
      opts.lineType === "step"
        ? points
            .slice(range.from, range.to)
            .flatMap((point, index, selected) =>
              index === 0
                ? [point]
                : [{ ...selected[index - 1]!, x: point.x }, point],
            )
        : points;
    const fade = opts.fadeGradient
      ? { enabled: true, minAlpha: opts.fadeMinAlpha ?? 0.15 }
      : undefined;
    Draw.line(
      ctx,
      linePoints,
      opts.lineType === "step" ? { from: 0, to: linePoints.length } : range,
      opts.lineWidth,
      opts.selectionGlow,
      fade,
      opts.lineStyle,
    );
  },
});

// Extended point type for area series (includes pane bottom for fill)
type AreaPoint = Render.Point & { paneBaseY: number };

export const AreaSeries = Series.define({
  type: "Area",
  defaultOptions: Series.AreaOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: { x: "time", value: "value", color: "lineColor" },

  dimensions() {
    return { x: "x", y: "value" };
  },

  extent(data, dim, field, fieldMap) {
    if (dim === "x" && field === "x") {
      const xField = resolveField(fieldMap, "x", "time");
      return numericFieldExtent(data, xField) ?? timeExtent(data);
    }
    if (dim === "y" && field === "value")
      return valueExtent(data, resolveField(fieldMap, "value", "value"));
    return null;
  },

  visibleExtent(data, from, to, fieldMap) {
    return histogramValueExtent(
      data,
      from,
      to,
      resolveField(fieldMap, "value", "value"),
    );
  },

  transform(view, coord, _barWidth, options, fieldMap) {
    const opts = options as Series.AreaOptions;
    const scaleId = coord.defaultYScale;
    const valueField = resolveField(fieldMap, "value", "value");
    const colorField = resolveField(fieldMap, "color", "lineColor");
    const paneBaseY =
      opts.base === undefined
        ? coord.bounds.y + coord.bounds.height
        : toY(coord, opts.base, scaleId);
    return (view as DataView.View<Record<string, unknown>>).map((d, i, x) => ({
      x,
      y: toY(coord, numeric(d[valueField]), scaleId),
      index: i,
      color:
        (typeof d[colorField] === "string" ? d[colorField] : undefined) ??
        opts.lineColor,
      paneBaseY,
    }));
  },

  render(ctx, items, range, options) {
    const opts = options as Series.AreaOptions;
    const points = items as AreaPoint[];
    if (points.length === 0) return;
    const baseY = points[0]!.paneBaseY;
    // Per-point colors define each segment, including its fill. Preserve
    // missing samples: Draw.area splits paths at every non-finite point.
    if (points.some((point) => point.color !== opts.lineColor)) {
      for (let i = range.from; i < range.to - 1; i++) {
        const color = points[i]!.color;
        Draw.area(
          ctx,
          points,
          { from: i, to: i + 2 },
          baseY,
          Color.withAlpha(color, 0.25),
          Color.withAlpha(color, 0.05),
          color,
          opts.lineWidth,
          opts.selectionGlow,
        );
      }
      return;
    }
    Draw.area(
      ctx,
      points,
      range,
      baseY,
      opts.topColor,
      opts.bottomColor,
      opts.lineColor,
      opts.lineWidth,
      opts.selectionGlow,
    );
  },
});

export const HistogramSeries = Series.define({
  type: "Histogram",
  defaultOptions: Series.HistogramOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: { x: "time", value: "value", color: "color" },

  dimensions() {
    return { x: "x", y: "value" };
  },

  extent(data, dim, field, fieldMap) {
    if (dim === "x" && field === "x") {
      const xField = resolveField(fieldMap, "x", "time");
      return numericFieldExtent(data, xField) ?? timeExtent(data);
    }
    if (dim === "y" && field === "value") {
      return valueExtent(data, resolveField(fieldMap, "value", "value"));
    }
    return null;
  },

  visibleExtent(data, from, to, fieldMap) {
    return histogramValueExtent(
      data,
      from,
      to,
      resolveField(fieldMap, "value", "value"),
    );
  },

  transform(view, coord, barWidth, options, fieldMap) {
    const opts = options as Series.HistogramOptions;
    const scaleId = coord.defaultYScale;
    const baseY = toY(coord, opts.base, scaleId);
    const valueField = resolveField(fieldMap, "value", "value");
    const colorField = resolveField(fieldMap, "color", "color");
    let previousFiniteValue: number | undefined;
    return (view as DataView.View<Record<string, unknown>>).map((d, i, x) => {
      const value = numeric(d[valueField]);
      const previous = previousFiniteValue;
      if (Number.isFinite(value)) previousFiniteValue = value;
      const explicitColor =
        typeof d[colorField] === "string" ? d[colorField] : undefined;
      const color = resolveHistogramBarColor({
        options: opts,
        value,
        previousValue: previous,
        explicitColor,
      });
      return {
        x,
        y: toY(coord, value, scaleId),
        index: i,
        baseY,
        width: barWidth,
        color,
      };
    });
  },

  render(ctx, items, range, options) {
    const opts = options as Series.HistogramOptions;
    Draw.histogram(ctx, items as Render.Histogram[], range, opts.selectionGlow);
  },
});

export const BarSeries = Series.define({
  type: "Bar",
  defaultOptions: Series.BarOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: {
    x: "time",
    open: "open",
    high: "high",
    low: "low",
    close: "close",
    color: "color",
  },

  dimensions() {
    return { x: "x", y: ["high", "low"] };
  },

  extent(data, dim, field, fieldMap) {
    if (dim === "x" && field === "x") {
      const xField = resolveField(fieldMap, "x", "time");
      return numericFieldExtent(data, xField) ?? timeExtent(data);
    }
    if (dim === "y" && (field === "high" || field === "low")) {
      return valueExtent(data, resolveField(fieldMap, field, field));
    }
    return null;
  },

  visibleExtent(data, from, to, fieldMap) {
    return visibleOHLCExtent(data, from, to, fieldMap);
  },

  transform(view, coord, barWidth, options, fieldMap) {
    const opts = options as Series.BarOptions;
    const scaleId = coord.defaultYScale;
    const openField = resolveField(fieldMap, "open", "open");
    const highField = resolveField(fieldMap, "high", "high");
    const lowField = resolveField(fieldMap, "low", "low");
    const closeField = resolveField(fieldMap, "close", "close");
    const colorField = resolveField(fieldMap, "color", "color");
    return (view as DataView.View<Record<string, unknown>>).map((d, i, x) => {
      const open = numeric(d[openField]);
      const high = numeric(d[highField]);
      const low = numeric(d[lowField]);
      const close = numeric(d[closeField]);
      const up = close >= open;
      return {
        x,
        index: i,
        width: barWidth,
        color:
          (typeof d[colorField] === "string" ? d[colorField] : undefined) ??
          (up ? opts.upColor : opts.downColor),
        openY: toY(coord, open, scaleId),
        highY: toY(coord, high, scaleId),
        lowY: toY(coord, low, scaleId),
        closeY: toY(coord, close, scaleId),
      };
    });
  },

  render(ctx, items, range, options) {
    const opts = options as Series.BarOptions;
    Draw.bars(ctx, items as Render.Bar[], range, opts.selectionGlow);
  },
});

export const CandlestickSeries = Series.define({
  type: "Candlestick",
  defaultOptions: Series.CandlestickOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: {
    x: "time",
    open: "open",
    high: "high",
    low: "low",
    close: "close",
    color: "color",
    borderColor: "borderColor",
    wickColor: "wickColor",
  },

  dimensions() {
    return { x: "x", y: ["high", "low"] };
  },

  extent(data, dim, field, fieldMap) {
    if (dim === "x" && field === "x") {
      const xField = resolveField(fieldMap, "x", "time");
      return numericFieldExtent(data, xField) ?? timeExtent(data);
    }
    if (dim === "y" && (field === "high" || field === "low")) {
      return valueExtent(data, resolveField(fieldMap, field, field));
    }
    return null;
  },

  visibleExtent(data, from, to, fieldMap) {
    return visibleOHLCExtent(data, from, to, fieldMap);
  },

  transform(view, coord, barWidth, options, fieldMap) {
    const opts = options as Series.CandlestickOptions;
    const scaleId = coord.defaultYScale;
    const openField = resolveField(fieldMap, "open", "open");
    const highField = resolveField(fieldMap, "high", "high");
    const lowField = resolveField(fieldMap, "low", "low");
    const closeField = resolveField(fieldMap, "close", "close");
    const colorField = resolveField(fieldMap, "color", "color");
    const borderColorField = resolveField(
      fieldMap,
      "borderColor",
      "borderColor",
    );
    const wickColorField = resolveField(fieldMap, "wickColor", "wickColor");
    return (view as DataView.View<Record<string, unknown>>).map((d, i, x) => {
      const open = numeric(d[openField]);
      const high = numeric(d[highField]);
      const low = numeric(d[lowField]);
      const close = numeric(d[closeField]);
      const up = close >= open;
      return {
        x,
        index: i,
        width: barWidth,
        color:
          (typeof d[colorField] === "string" ? d[colorField] : undefined) ??
          (up ? opts.upColor : opts.downColor),
        borderColor:
          (typeof d[borderColorField] === "string"
            ? d[borderColorField]
            : undefined) ?? (up ? opts.borderUpColor : opts.borderDownColor),
        wickColor:
          (typeof d[wickColorField] === "string"
            ? d[wickColorField]
            : undefined) ?? (up ? opts.wickUpColor : opts.wickDownColor),
        openY: toY(coord, open, scaleId),
        highY: toY(coord, high, scaleId),
        lowY: toY(coord, low, scaleId),
        closeY: toY(coord, close, scaleId),
      };
    });
  },

  render(ctx, items, range, options) {
    const opts = options as Series.CandlestickOptions;
    Draw.candlesticks(
      ctx,
      items as Render.Candlestick[],
      range,
      opts.selectionGlow,
    );
  },
});

export const LivelineSeries = Series.define({
  type: "Liveline",
  defaultOptions: Series.LivelineOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: LineSeries.fieldRoles,

  dimensions: LineSeries.dimensions,
  extent: LineSeries.extent,
  visibleExtent: LineSeries.visibleExtent,
  transform: LineSeries.transform,

  render(ctx, items, range, options) {
    const opts = options as Series.LivelineOptions;
    const points = items as Render.Point[];
    const fade = { enabled: true, minAlpha: opts.fadeMinAlpha ?? 0.08 };

    // Main line with fade gradient
    Draw.line(ctx, points, range, opts.lineWidth, opts.selectionGlow, fade);
  },
});

// Extended point type for baseline series (includes baselineY)
type BaselinePoint = Render.Point & { baselineY: number };

export const BaselineSeries = Series.define({
  type: "Baseline",
  defaultOptions: Series.BaselineOptions.parse({}),
  coordSys: "cartesian2d",
  fieldRoles: { x: "time", value: "value" },

  dimensions() {
    return { x: "x", y: "value" };
  },

  extent(data, dim, field, fieldMap) {
    if (dim === "x" && field === "x") {
      const xField = resolveField(fieldMap, "x", "time");
      return numericFieldExtent(data, xField) ?? timeExtent(data);
    }
    if (dim === "y" && field === "value")
      return valueExtent(data, resolveField(fieldMap, "value", "value"));
    return null;
  },

  visibleExtent(data, from, to, fieldMap) {
    return visibleValueExtent(
      data,
      from,
      to,
      resolveField(fieldMap, "value", "value"),
    );
  },

  transform(view, coord, _barWidth, options, fieldMap) {
    const opts = options as Series.BaselineOptions;
    const scaleId = coord.defaultYScale;
    const valueField = resolveField(fieldMap, "value", "value");
    const v = view as DataView.View<Record<string, unknown>>;
    let firstValue: number | undefined;
    v.forEach((point) => {
      const value = numeric(point[valueField]);
      if (firstValue === undefined && Number.isFinite(value))
        firstValue = value;
    });
    const baseValue =
      opts.baseValue.type === "price"
        ? opts.baseValue.price
        : (firstValue ?? 0) * (1 + opts.baseValue.percent / 100);
    const baselineY = toY(coord, baseValue, scaleId);
    const points: BaselinePoint[] = v.map((d, i, x) => ({
      x,
      y: toY(coord, numeric(d[valueField]), scaleId),
      index: i,
      color: opts.topLineColor,
      baselineY,
    }));
    return points;
  },

  render(ctx, items, range, options) {
    const opts = options as Series.BaselineOptions;
    const points = items as BaselinePoint[];
    const baselineY =
      points[0]?.baselineY ??
      (points.length > 0 ? Math.max(...points.map((p) => p.y)) : 0);
    Draw.baseline(
      ctx,
      points,
      range,
      baselineY,
      opts.topFillColor1,
      opts.topFillColor2,
      opts.topLineColor,
      opts.bottomFillColor1,
      opts.bottomFillColor2,
      opts.bottomLineColor,
      opts.lineWidth,
    );
  },
});
