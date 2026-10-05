// Purpose: Shared v2 helpers for percentage/indexed y-axis mode transforms.
// Module:  @openchart/chart-core / v2

import { Series } from "@openchart/chart-core/series";
import { Data } from "@openchart/chart-core/data/schema";
import { ScaleMode } from "@openchart/chart-core/scale/mode";
import type { YAxisConfig } from "@openchart/chart-core/scale/config";
import {
  readNumber,
  resolveField,
} from "@openchart/chart-core/v2/series/fields";

type Axis = YAxisConfig.Axis;

export type RawVisibleExtent = {
  from: number;
  to: number;
  /** min of (low ?? close ?? value) over points where both hi and lo are finite. */
  minLo: number;
  /** max of (high ?? close ?? value) over points where both hi and lo are finite. */
  maxHi: number;
  /** false when no point in the range had both a finite hi and lo. */
  valid: boolean;
};

function finiteField(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const raw = record[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

// Cache of the raw (untransformed) visible high/low extent per series, keyed on
// the data array and the visible [from,to). The raw extent is independent of the
// comparison anchor, so during an anchor drag (data + viewport fixed) this is a
// pure cache hit, collapsing the per-frame extent work from O(series × visible
// points) to O(series). Comparison/percentage/indexed transforms are monotonic
// in the raw value for a fixed per-series baseline, so the transformed extent is
// just the transform applied to {minLo, maxHi}. A small bounded per-data map
// keeps both the renderer and the anchor overlay (which may request slightly
// different ranges) hitting without thrashing.
const rawVisibleExtentCache = new WeakMap<
  readonly unknown[],
  Map<string, RawVisibleExtent>
>();
const RAW_EXTENT_RANGES_PER_SERIES = 4;

export function rawVisibleExtent(
  series: Series.State,
  from: number,
  to: number,
): RawVisibleExtent {
  const data = series.data;
  const clampedFrom = Math.max(0, Math.floor(from));
  const clampedTo = Math.min(
    data.length,
    Math.ceil(Math.max(clampedFrom + 1, to)),
  );
  const key = `${clampedFrom}-${clampedTo}|${series.type}|${JSON.stringify(series.fieldMap ?? {})}`;
  let perData = rawVisibleExtentCache.get(data);
  if (perData) {
    const hit = perData.get(key);
    if (hit) return hit;
  } else {
    perData = new Map();
    rawVisibleExtentCache.set(data, perData);
  }

  const highField = resolveField(
    series,
    "high",
    series.fieldMap?.value ?? "high",
  );
  const lowField = resolveField(series, "low", series.fieldMap?.value ?? "low");
  const closeField = resolveField(
    series,
    "close",
    series.fieldMap?.value ?? "close",
  );
  const valueField = resolveField(series, "value", "value");
  let minLo = Number.POSITIVE_INFINITY;
  let maxHi = Number.NEGATIVE_INFINITY;
  for (let i = clampedFrom; i < clampedTo; i++) {
    const point = data[i] as Record<string, unknown> | undefined;
    if (!point) continue;
    const hi =
      finiteField(point, highField) ??
      finiteField(point, closeField) ??
      finiteField(point, valueField);
    const lo =
      finiteField(point, lowField) ??
      finiteField(point, closeField) ??
      finiteField(point, valueField);
    if (hi === undefined || lo === undefined) continue;
    if (hi > maxHi) maxHi = hi;
    if (lo < minLo) minLo = lo;
  }
  const result: RawVisibleExtent = {
    from: clampedFrom,
    to: clampedTo,
    minLo,
    maxHi,
    valid: Number.isFinite(minLo) && Number.isFinite(maxHi),
  };
  // Evict the oldest range if we exceed the bound (insertion-ordered Map).
  if (perData.size >= RAW_EXTENT_RANGES_PER_SERIES) {
    const oldest = perData.keys().next().value;
    if (oldest !== undefined) perData.delete(oldest);
  }
  perData.set(key, result);
  return result;
}

export function readComparableValue(series: Series.State, point: unknown) {
  if (!point || typeof point !== "object") return undefined;
  const record = point as Record<string, unknown>;
  const close =
    readNumber(record, series, "close", series.fieldMap?.value ?? "close") ??
    readNumber(record, series, "value", "value");
  return close !== undefined && Number.isFinite(close) && close !== 0
    ? close
    : undefined;
}

// Hot-loop variant of readComparableValue: the caller resolves the close/value
// field names ONCE (via resolveField) and reuses them across every point, so a
// tight scan over thousands of points never re-merges the field map per read.
// Semantics must match readComparableValue exactly: prefer close, fall back to
// value, and reject non-finite or zero.
export function comparableFrom(
  record: Record<string, unknown>,
  closeField: string,
  valueField: string,
): number | undefined {
  const closeRaw = record[closeField];
  let value =
    typeof closeRaw === "number" && Number.isFinite(closeRaw)
      ? closeRaw
      : undefined;
  if (value === undefined) {
    const valueRaw = record[valueField];
    value =
      typeof valueRaw === "number" && Number.isFinite(valueRaw)
        ? valueRaw
        : undefined;
  }
  // Matches readComparableValue: a finite close of exactly 0 resolves to
  // undefined WITHOUT trying the value field (the `??` only chains on a
  // non-numeric close), and a zero result is rejected.
  return value !== undefined && value !== 0 ? value : undefined;
}

// Binary-search the rightmost index whose time is <= anchor over the NON-HOLE
// points (which are ascending by time). Returns -1 when no point is at or before
// `anchor`. O(log N) on dense data, replacing the previous O(N) scan in the
// comparison hit-test (every crosshair move) and mode-transforms (every
// anchor-drag frame).
//
// @agent invariant: comparison aux series are aligned to the main timeline by
// `alignSeriesToAxisTimeline`, which leaves UNMATCHED/sparse slots as `undefined`
// HOLES (leading holes before a later-IPO ticker's first bar; interspersed holes
// for lower-frequency aux). A plain binary search would mis-partition on a hole,
// so when the probe lands on a hole we step to the nearest defined point within
// the current window (forward preferred) and branch on that. Only the non-hole
// points need be sorted; the holes may sit anywhere.
export function lastIndexAtOrBefore(
  data: readonly unknown[],
  timeField: string,
  anchor: number,
): number {
  let lo = 0;
  let hi = data.length - 1;
  let bound = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let idx = -1;
    let time: number | undefined;
    for (let f = mid; f <= hi; f++) {
      const t = Data.readTime(
        (data[f] as Record<string, unknown> | undefined)?.[timeField],
      );
      if (t !== undefined) {
        idx = f;
        time = t;
        break;
      }
    }
    if (idx === -1) {
      for (let b = mid - 1; b >= lo; b--) {
        const t = Data.readTime(
          (data[b] as Record<string, unknown> | undefined)?.[timeField],
        );
        if (t !== undefined) {
          idx = b;
          time = t;
          break;
        }
      }
    }
    if (idx === -1 || time === undefined) break; // window is all holes
    if (time <= anchor) {
      bound = idx;
      lo = idx + 1;
    } else {
      hi = idx - 1;
    }
  }
  return bound;
}

function anchoredBaseline(
  series: Series.State,
  axis: Axis | undefined,
): number | undefined {
  const anchor = Data.readTime(axis?.modeAnchor?.time);
  if (anchor === undefined) return undefined;
  // Resolve field names ONCE. The previous per-point readComparableValue path
  // rebuilt a merged field map (SeriesRegistry.get + spread) on every point.
  const timeField = resolveField(series, "time", "time") ?? "time";
  const closeField = resolveField(
    series,
    "close",
    series.fieldMap?.value ?? "close",
  );
  const valueField = resolveField(series, "value", "value");
  const data = series.data;

  // Highest-time valid value at or before the anchor (matches the previous
  // linear scan's `nearestValue`).
  const bound = lastIndexAtOrBefore(data, timeField, anchor);
  for (let i = bound; i >= 0; i--) {
    const record = data[i] as Record<string, unknown> | undefined;
    if (!record) continue;
    const value = comparableFrom(record, closeField, valueField);
    if (value !== undefined) return value;
  }
  // Fallback: first valid value (only when nothing valid is at/before anchor).
  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown> | undefined;
    if (!record) continue;
    const value = comparableFrom(record, closeField, valueField);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function modeTransformValue(
  axis: Axis | undefined,
  value: number,
  baseline: number,
): number {
  if (!Number.isFinite(value)) return value;
  if (!axis) return value;
  if (axis.mode === "percentage") return ScaleMode.toPercent(value, baseline);
  if (axis.mode === "indexed") return ScaleMode.toIndexed(value, baseline);
  return value;
}

export function centerAnchorValueInExtent(
  extent: { min: number; max: number },
  value: number,
): { min: number; max: number } {
  if (
    !Number.isFinite(extent.min) ||
    !Number.isFinite(extent.max) ||
    !Number.isFinite(value)
  ) {
    return extent;
  }
  const min = Math.min(extent.min, value);
  const max = Math.max(extent.max, value);
  const radius = Math.max(Math.abs(value - min), Math.abs(max - value), 1);
  return { min: value - radius, max: value + radius };
}

export function modeBaseline(
  series: Series.State,
  range: { from: number; to: number },
  axis?: Axis,
): number | undefined {
  const anchored = anchoredBaseline(series, axis);
  if (anchored !== undefined) return anchored;

  const from = Math.max(0, range.from);
  const to = Math.min(series.data.length, Math.max(from + 1, range.to));
  for (let i = from; i < to; i++) {
    const close = readComparableValue(series, series.data[i]);
    if (close !== undefined) return close;
  }
  return undefined;
}

export function modeTransformFields(series: Series.State): string[] {
  const fields = [
    resolveField(series, "open", series.fieldMap?.value ?? "open"),
    resolveField(series, "high", series.fieldMap?.value ?? "high"),
    resolveField(series, "low", series.fieldMap?.value ?? "low"),
    resolveField(series, "close", series.fieldMap?.value ?? "close"),
    resolveField(series, "value", "value"),
  ];
  const out: string[] = [];
  for (const field of fields) {
    if (!field) continue;
    if (out.includes(field)) continue;
    out.push(field);
  }
  return out;
}

export function transformPointForMode(
  point: Record<string, unknown>,
  axis: Axis | undefined,
  baseline: number | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  if (!axis || (axis.mode !== "percentage" && axis.mode !== "indexed"))
    return point;
  if (!baseline || !Number.isFinite(baseline)) return point;
  if (fields.length === 0) return point;
  const next = { ...point };
  for (const key of fields) {
    const value = point[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    next[key] = modeTransformValue(axis, value, baseline);
  }
  return next;
}
