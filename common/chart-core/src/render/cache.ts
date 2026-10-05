// Purpose: Version-stamped cache that stores transformed render items per series and invalidates on data or coordinate changes
// Module:  @openchart/chart-core / render

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Render } from "./items";

/**
 * Render cache stores transformed render items per series.
 * Items are only recomputed when data or coordinates change.
 */
export namespace RenderCache {
  export type Entry = {
    items: unknown[];
    version: number;
    range: Render.Range;
  };

  export type State = {
    entries: Map<string, Entry>;
    version: number;
  };

  export function create(): State {
    return { entries: new Map(), version: 0 };
  }

  // Get cached items for a series, or null if stale
  export function get(state: State, id: string, version: number): Entry | null {
    const entry = state.entries.get(id);
    if (!entry) return null;
    if (entry.version !== version) return null;
    return entry;
  }

  // Store items for a series
  export function set(
    state: State,
    id: string,
    items: unknown[],
    range: Render.Range,
  ): void {
    state.entries.set(id, { items, version: state.version, range });
  }

  // Invalidate a specific series
  export function invalidate(state: State, id: string): void {
    state.entries.delete(id);
  }

  // Bump version (invalidates all entries on next get)
  export function bump(state: State): number {
    state.version++;
    return state.version;
  }

  // Clear all cached entries
  export function clear(state: State): void {
    state.entries.clear();
    state.version++;
  }
}
