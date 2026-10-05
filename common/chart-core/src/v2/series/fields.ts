// Purpose: Resolve field-name mappings for series data points and read typed values by role
// Module:  @openchart/chart-core / v2 / series

import { Series, SeriesRegistry } from "@openchart/chart-core/series";

// Registry field roles are static per series type, so memoize the per-type
// defaults object instead of re-reading the registry and spreading on every
// call. The returned object is treated as read-only by getFieldMap (which
// spreads it), so a single shared instance per type is safe.
const registryDefaultsCache = new Map<string, Record<string, string>>();

function registryDefaults(type: string): Record<string, string> {
  let cached = registryDefaultsCache.get(type);
  if (cached === undefined) {
    const def = SeriesRegistry.get(type);
    cached = { ...(def?.fieldRoles ?? {}) };
    registryDefaultsCache.set(type, cached);
  }
  return cached;
}

// getFieldMap is on the hottest paint/hit-test loops (called per data point, per
// series, per frame). The merge is pure given (series.type, series.fieldMap), so
// cache the merged result keyed on the series object and invalidate only when
// its `fieldMap` reference changes. Within a frame the same series object is
// reused across thousands of points → cache hit; the returned map is read-only
// (only resolveField reads it), so sharing the instance is safe.
//
// @agent invariant: getFieldMap callers must never mutate the returned object.
const mergedFieldMapCache = new WeakMap<
  Series.State,
  {
    type: string;
    fieldMap: Series.FieldMap | undefined;
    merged: Record<string, string>;
  }
>();

export function getFieldMap(series: Series.State): Record<string, string> {
  // Invalidate when EITHER the type (drives registryDefaults) or the fieldMap
  // reference changes. A bare in-place `series.type = ...` (e.g. some series-type
  // transitions) that leaves `series.fieldMap` referentially unchanged would
  // otherwise serve the previous type's merged defaults.
  const cached = mergedFieldMapCache.get(series);
  if (
    cached !== undefined &&
    cached.type === series.type &&
    cached.fieldMap === series.fieldMap
  ) {
    return cached.merged;
  }
  const merged = {
    ...registryDefaults(series.type),
    ...(series.fieldMap ?? {}),
  };
  mergedFieldMapCache.set(series, {
    type: series.type,
    fieldMap: series.fieldMap,
    merged,
  });
  return merged;
}

export function resolveField(
  series: Series.State,
  role: string,
  fallback: string,
): string {
  return getFieldMap(series)[role] ?? fallback;
}

export function readField(
  point: unknown,
  series: Series.State,
  role: string,
  fallback: string,
): unknown {
  const field = resolveField(series, role, fallback);
  return (point as Record<string, unknown> | undefined)?.[field];
}

export function readNumber(
  point: unknown,
  series: Series.State,
  role: string,
  fallback: string,
): number | undefined {
  const value = readField(point, series, role, fallback);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function readString(
  point: unknown,
  series: Series.State,
  role: string,
  fallback: string,
): string | undefined {
  const value = readField(point, series, role, fallback);
  return typeof value === "string" ? value : undefined;
}
