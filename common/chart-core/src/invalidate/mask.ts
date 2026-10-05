// Purpose: Bitmask-style invalidation tracking that controls per-pane repaint granularity (none → cursor → light → full)
// Module:  @openchart/chart-core / invalidate

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace Invalidate {
  /**
   * Invalidation levels control how much work is done during repaint.
   * Higher levels include all work from lower levels.
   *
   * - `none`: Nothing changed. Skip repaint entirely.
   * - `cursor`: Only crosshair moved. Redraw overlay only, use cached series.
   * - `light`: Data updated (same extent) or style changed. Re-render series
   *            with cached geometry. Skip extent recalc and axis regeneration.
   * - `full`: Resize, zoom, scroll, or data extent changed. Recalculate extents,
   *           regenerate axis labels, re-transform visible data, full repaint.
   */
  export const Level = z.enum(["none", "cursor", "light", "full"]);
  export type Level = z.infer<typeof Level>;

  // Priority: full > light > cursor > none
  const priority: Record<Level, number> = {
    none: 0,
    cursor: 1,
    light: 2,
    full: 3,
  };

  // Per-pane invalidation tracking
  export type Mask = {
    chart: Level;
    panes: Record<number, Level>;
  };

  // Create empty mask
  export function create(): Mask {
    return { chart: "none", panes: {} };
  }

  // Mark chart-level invalidation
  export function chart(mask: Mask, level: Level): Mask {
    return {
      chart: higher(mask.chart, level),
      panes: mask.panes,
    };
  }

  // Mark specific pane invalidation
  export function pane(mask: Mask, index: number, level: Level): Mask {
    const current = mask.panes[index] ?? "none";
    return {
      chart: mask.chart,
      panes: { ...mask.panes, [index]: higher(current, level) },
    };
  }

  // Get pane level (inherits from chart if higher)
  export function get(mask: Mask, index: number): Level {
    const paneLevel = mask.panes[index] ?? "none";
    return higher(mask.chart, paneLevel);
  }

  // Merge two masks, taking highest level for each
  export function merge(a: Mask, b: Mask): Mask {
    const result: Mask = {
      chart: higher(a.chart, b.chart),
      panes: { ...a.panes },
    };

    for (const key of Object.keys(b.panes)) {
      const idx = Number(key);
      const current = result.panes[idx] ?? "none";
      result.panes[idx] = higher(current, b.panes[idx]!);
    }

    return result;
  }

  // Check if any invalidation needed
  export function dirty(mask: Mask): boolean {
    if (mask.chart !== "none") return true;
    return Object.values(mask.panes).some((l) => l !== "none");
  }

  // Reset mask to clean state
  export function reset(): Mask {
    return create();
  }

  // Compare two levels, return higher priority one
  function higher(a: Level, b: Level): Level {
    return priority[a] >= priority[b] ? a : b;
  }
}
