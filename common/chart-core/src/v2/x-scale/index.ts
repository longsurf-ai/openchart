// Purpose: Manage x-axis configuration (ordinal and linear modes) with CRUD helpers, coordinate transforms, and domain derivation
// Module:  @openchart/chart-core / v2 / x-scale

import { TimeScale } from "@openchart/chart-core/scale";
import type { ChartConfig } from "@openchart/chart-core/config";
import { Series } from "@openchart/chart-core/series";
import type { XAxisConfig } from "@openchart/chart-core/scale/config";
import { resolveField } from "@openchart/chart-core/v2/series/fields";

type XAxis = XAxisConfig.Axis;
type XConfig = ChartConfig.Full["xAxis"];

export type VisibleRange = { from: number; to: number };
export type LinearDomain = { min: number; max: number; minSpan: number };

const DEFAULT_X_AXIS: XAxis = {
  id: "main",
  mode: "ordinal",
  visible: true,
  field: "time",
  spacing: {
    barSpacing: 6,
    minBarSpacing: 0.5,
    maxBarSpacing: 50,
    rightOffset: 0,
  },
};

function cloneAxis(axis: XAxis): XAxis {
  return {
    ...axis,
    spacing: { ...axis.spacing },
    domain: axis.domain ? { ...axis.domain } : undefined,
  };
}

export function getAxis(config: XConfig, axisId?: string): XAxis {
  const id = axisId ?? config.activeId;
  const axes =
    Array.isArray(config.axes) && config.axes.length > 0
      ? (config.axes as XAxis[])
      : [cloneAxis(DEFAULT_X_AXIS)];
  return axes.find((axis) => axis.id === id) ?? axes[0]!;
}

export function updateAxis(
  config: XConfig,
  axisId: string,
  updater: (axis: XAxis) => XAxis,
): XAxis {
  const index = config.axes.findIndex((axis) => axis.id === axisId);
  if (index < 0) {
    const created = updater({ ...cloneAxis(DEFAULT_X_AXIS), id: axisId });
    config.axes.push(created);
    if (!config.activeId) config.activeId = axisId;
    return created;
  }
  const next = updater(config.axes[index]!);
  config.axes[index] = next;
  return next;
}

export function addAxis(
  config: XConfig,
  axis: Partial<XAxis> & { id: string },
): XAxis {
  const existing = config.axes.find((candidate) => candidate.id === axis.id);
  if (existing) return existing;

  const next: XAxis = {
    ...cloneAxis(DEFAULT_X_AXIS),
    ...axis,
    spacing: {
      ...DEFAULT_X_AXIS.spacing,
      ...(axis.spacing ?? {}),
    },
  };
  config.axes.push(next);
  return next;
}

export function removeAxis(config: XConfig, axisId: string): void {
  if (config.axes.length <= 1) return;
  config.axes = config.axes.filter((axis) => axis.id !== axisId);
  if (config.axes.length === 0) {
    config.axes = [cloneAxis(DEFAULT_X_AXIS)];
  }
  if (
    config.activeId === axisId ||
    !config.axes.find((axis) => axis.id === config.activeId)
  ) {
    config.activeId = config.axes[0]!.id;
  }
}

export function setActiveAxis(config: XConfig, axisId: string): string {
  if (!config.axes.find((axis) => axis.id === axisId)) {
    addAxis(config, { id: axisId });
  }
  config.activeId = axisId;
  return axisId;
}

export function setAxisSpacing(
  config: XConfig,
  axisId: string,
  spacing: Partial<XAxisConfig.Spacing>,
): XAxis {
  return updateAxis(config, axisId, (axis) => ({
    ...axis,
    spacing: {
      ...axis.spacing,
      ...spacing,
    },
  }));
}

export function setAxisDomain(
  config: XConfig,
  axisId: string,
  domain?: LinearDomain,
): XAxis {
  return updateAxis(config, axisId, (axis) => ({
    ...axis,
    domain: domain ? { ...domain } : undefined,
  }));
}

export function axisSeries(
  series: Series.State[],
  axisId: string,
): Series.State[] {
  return series.filter((s) => Series.getXAxisId(s) === axisId);
}

export function axisDataLength(series: Series.State[], axisId: string): number {
  const list = axisSeries(series, axisId);
  if (list.length === 0) return 0;
  return Math.max(...list.map((item) => item.data.length));
}

export function buildOrdinalScale(
  config: ChartConfig.Full,
  axis: XAxis,
  width: number,
): TimeScale.State {
  return TimeScale.State.parse({
    visible: config.xAxis.visible && axis.visible,
    barSpacing: axis.spacing.barSpacing,
    minBarSpacing: axis.spacing.minBarSpacing,
    maxBarSpacing: axis.spacing.maxBarSpacing,
    rightOffset: axis.spacing.rightOffset,
    fixLeftEdge: config.xAxis.edges.fixLeftEdge,
    fixRightEdge: config.xAxis.edges.fixRightEdge,
    borderVisible: config.xAxis.style.borderVisible,
    borderColor: config.xAxis.style.borderColor,
    ticksVisible: config.xAxis.style.ticksVisible,
    timeVisible: config.xAxis.timeDisplay.timeVisible,
    secondsVisible: config.xAxis.timeDisplay.secondsVisible,
    width,
  });
}

export function ordinalVisibleRange(
  config: ChartConfig.Full,
  axis: XAxis,
  width: number,
  total: number,
): TimeScale.VisibleRangeResult {
  const scale = buildOrdinalScale(config, axis, width);
  return TimeScale.visibleRange(scale, total);
}

export function ordinalIndexToX(
  config: ChartConfig.Full,
  axis: XAxis,
  width: number,
  total: number,
  index: number,
): number {
  const scale = buildOrdinalScale(config, axis, width);
  return Number(TimeScale.indexToX(scale, index, total));
}

export function ordinalXToIndex(
  config: ChartConfig.Full,
  axis: XAxis,
  width: number,
  total: number,
  x: number,
): number {
  const scale = buildOrdinalScale(config, axis, width);
  return Number(TimeScale.xToIndex(scale, x, total));
}

export function linearSeriesValues(
  series: Series.State,
  axis: XAxis,
): number[] {
  const xField = resolveField(series, "x", axis.field || "time");
  const values: number[] = new Array(series.data.length);
  for (let i = 0; i < series.data.length; i++) {
    const value = (series.data[i] as Record<string, unknown> | undefined)?.[
      xField
    ];
    values[i] =
      typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
  }
  return values;
}

export function deriveLinearDomain(
  axis: XAxis,
  seriesList: Series.State[],
): LinearDomain {
  const minSpan = Math.max(axis.domain?.minSpan ?? 1e-6, 1e-6);
  if (
    axis.domain &&
    Number.isFinite(axis.domain.min) &&
    Number.isFinite(axis.domain.max)
  ) {
    const rawSpan = axis.domain.max - axis.domain.min;
    if (rawSpan >= minSpan) {
      return { min: axis.domain.min, max: axis.domain.max, minSpan };
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const series of seriesList) {
    const values = linearSeriesValues(series, axis);
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  if (min === Infinity || max === -Infinity) return { min: 0, max: 1, minSpan };
  if (max - min < minSpan) return { min, max: min + minSpan, minSpan };
  return { min, max, minSpan };
}

export function linearValueToX(
  value: number,
  domain: LinearDomain,
  width: number,
): number {
  const span = Math.max(domain.max - domain.min, domain.minSpan);
  return ((value - domain.min) / span) * width;
}

export function linearXToValue(
  x: number,
  domain: LinearDomain,
  width: number,
): number {
  if (width <= 0) return domain.min;
  const ratio = x / width;
  return domain.min + ratio * (domain.max - domain.min);
}

export function linearVisibleRange(
  values: number[],
  domain: LinearDomain,
): VisibleRange {
  if (values.length === 0) return { from: 0, to: 0 };
  let from = -1;
  let to = -1;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    if (value < domain.min || value > domain.max) continue;
    if (from < 0) from = i;
    to = i;
  }
  if (from < 0 || to < 0) return { from: 0, to: 0 };
  return { from, to: to + 1 };
}

export function linearNearestIndex(
  values: number[],
  targetValue: number,
): number {
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    const delta = Math.abs(value - targetValue);
    if (delta < best) {
      best = delta;
      nearest = i;
    }
  }
  return nearest;
}

export function linearBarWidth(
  values: number[],
  domain: LinearDomain,
  width: number,
  fallback: number,
): number {
  if (values.length < 2) return Math.max(1, fallback);
  const px: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const curr = values[i]!;
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    px.push(
      Math.abs(
        linearValueToX(curr, domain, width) -
          linearValueToX(prev, domain, width),
      ),
    );
  }
  if (px.length === 0) return Math.max(1, fallback);
  const avg = px.reduce((sum, value) => sum + value, 0) / px.length;
  return Math.max(1, Math.floor(avg * 0.8));
}
