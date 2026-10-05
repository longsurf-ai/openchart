// Purpose: Binary-search utilities for clipping render items to the visible viewport range
// Module:  @openchart/chart-core / render

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Render } from "./items";

/**
 * Visible range utilities for clipping render items to visible viewport.
 * Uses binary search for O(log n) performance with large datasets.
 */
export namespace Visible {
  // Binary search: find first index where item.index >= target
  function lower(items: Render.Base[], target: number): number {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const item = items[mid];
      if (!item) break;
      if (item.index < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Binary search: find first index where item.index > target
  function upper(items: Render.Base[], target: number): number {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const item = items[mid];
      if (!item) break;
      if (item.index <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Compute visible range of items using binary search.
   * Returns { from, to } indices into the items array (not data indices).
   *
   * @param items - Array of render items with index property
   * @param range - Visible data index range { from, to }
   * @param extend - If true, include one item before/after for line continuity
   */
  export function clip(
    items: Render.Base[],
    range: Render.Range,
    extend = false,
  ): Render.Range {
    if (items.length === 0) return { from: 0, to: 0 };

    const from = lower(items, range.from);
    const to = upper(items, range.to);

    if (!extend) return { from, to };

    // Extend range for line series continuity
    const extFrom = from > 0 ? from - 1 : from;
    const extTo = to < items.length ? to + 1 : to;
    return { from: extFrom, to: extTo };
  }

  /**
   * Check if a data index is within visible range.
   */
  export function contains(range: Render.Range, index: number): boolean {
    return index >= range.from && index < range.to;
  }

  /**
   * Compute the overlap between two ranges.
   */
  export function overlap(
    a: Render.Range,
    b: Render.Range,
  ): Render.Range | null {
    const from = Math.max(a.from, b.from);
    const to = Math.min(a.to, b.to);
    if (from >= to) return null;
    return { from, to };
  }
}
