// Purpose: Theme-owned glow effect for selected data ranges, with bucketed palette cycling
// Module:  @openchart/chart-core / render

import { Render } from "./items";
import { Color } from "@openchart/chart-core/util";

export type SelectionGlowInput =
  | {
      colors?: readonly string[];
      enabled?: boolean;
      fromIndex?: number;
      toIndex?: number;
      speed?: number;
    }
  | undefined;

export type SelectionGlowState = {
  from: number;
  to: number;
  speed: number;
  now: number;
  span: number;
  timePos: number;
  bucketCount: number;
  colors: readonly string[];
  bucketColors: Array<string | undefined>;
};

const MAX_GLOW_BUCKETS = 96;
const GLOW_TIME_FACTOR = 0.00032;
const DEFAULT_GLOW_COLORS = [
  "var(--glow-selection-1, 198 94% 66%)",
  "var(--glow-selection-2, 158 76% 58%)",
  "var(--glow-selection-3, 34 92% 62%)",
] as const;

export function bucketCountForSpan(span: number): number {
  if (!Number.isFinite(span) || span <= 1) return 1;
  return Math.min(MAX_GLOW_BUCKETS, Math.floor(span));
}

export function normalizeSelectionGlow(
  selection: SelectionGlowInput,
  now: number = Date.now(),
): SelectionGlowState | null {
  if (!selection || selection.enabled !== true) return null;
  if (
    !Number.isFinite(selection.fromIndex) ||
    !Number.isFinite(selection.toIndex)
  )
    return null;

  const from = Math.max(0, Math.floor(selection.fromIndex!));
  const to = Math.max(from, Math.floor(selection.toIndex!));
  const speed =
    Number.isFinite(selection.speed) && selection.speed! > 0
      ? selection.speed!
      : 1;
  const span = Math.max(1, to - from + 1);
  const timePos = (((now * GLOW_TIME_FACTOR * speed) % 1) + 1) % 1;
  const bucketCount = bucketCountForSpan(span);
  const inputColors = Array.isArray(selection.colors)
    ? selection.colors.filter(
        (color): color is string =>
          typeof color === "string" && color.trim().length > 0,
      )
    : [];
  const colors = inputColors.length > 0 ? inputColors : DEFAULT_GLOW_COLORS;

  return {
    from,
    to,
    speed,
    now,
    span,
    timePos,
    bucketCount,
    colors,
    bucketColors: new Array(bucketCount),
  };
}

export function isSelected(
  glow: SelectionGlowState | null,
  index: number,
): boolean {
  return !!glow && index >= glow.from && index <= glow.to;
}

export function bucketForIndex(
  glow: SelectionGlowState,
  index: number,
): number {
  if (glow.bucketCount <= 1 || glow.span <= 1) return 0;

  if (glow.bucketCount >= glow.span) {
    return Math.max(0, Math.min(glow.bucketCount - 1, index - glow.from));
  }

  const offset = Math.max(0, Math.min(glow.span - 1, index - glow.from));
  const ratio = offset / (glow.span - 1);
  return Math.max(
    0,
    Math.min(glow.bucketCount - 1, Math.floor(ratio * (glow.bucketCount - 1))),
  );
}

export function bucketColor(glow: SelectionGlowState, bucket: number): string {
  const clamped = Math.max(0, Math.min(glow.bucketCount - 1, bucket));
  const cached = glow.bucketColors[clamped];
  if (cached) return cached;

  const indexPos = glow.bucketCount <= 1 ? 0 : clamped / (glow.bucketCount - 1);
  const palettePosition = (((indexPos + glow.timePos) % 1) + 1) % 1;
  const paletteIndex =
    glow.colors.length <= 1
      ? 0
      : Math.min(
          glow.colors.length - 1,
          Math.floor(palettePosition * glow.colors.length),
        );
  const color = Color.withAlpha(glow.colors[paletteIndex]!, 0.98);
  glow.bucketColors[clamped] = color;
  return color;
}

export function glowColor(glow: SelectionGlowState, index: number): string {
  return bucketColor(glow, bucketForIndex(glow, index));
}

function lowerBoundByIndex<T extends { index: number }>(
  items: readonly (T | undefined)[],
  from: number,
  to: number,
  target: number,
): number {
  let lo = from;
  let hi = to;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const candidate = items[mid];
    const midIndex = candidate ? candidate.index : mid;
    if (midIndex < target) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

export function selectedWindowByIndex<T extends { index: number }>(
  items: readonly (T | undefined)[],
  range: Render.Range,
  glow: SelectionGlowState,
): Render.Range | null {
  if (range.to <= range.from) return null;

  const from = Math.max(
    range.from,
    lowerBoundByIndex(items, range.from, range.to, glow.from),
  );
  const to = Math.min(
    range.to,
    lowerBoundByIndex(items, range.from, range.to, glow.to + 1),
  );

  if (to <= from) return null;
  return { from, to };
}

export function selectedSegmentWindowByIndex<T extends { index: number }>(
  items: readonly (T | undefined)[],
  range: Render.Range,
  glow: SelectionGlowState,
): Render.Range | null {
  if (range.to - range.from < 2) return null;

  const selected = selectedWindowByIndex(items, range, glow);
  if (!selected) return null;

  const from = Math.max(range.from, selected.from - 1);
  const to = Math.min(range.to - 1, selected.to);
  if (to <= from) return null;

  return { from, to };
}
