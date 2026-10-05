// Purpose: Cached label formatting for prices and times with LRU eviction to avoid redundant string formatting
// Module:  @openchart/chart-core / cache

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
export namespace LabelCache {
  type Entry = {
    label: string;
    accessed: number;
  };

  type State = {
    prices: Map<string, Entry>;
    times: Map<string, Entry>;
    max: number;
  };

  // Create a new cache with optional max size per type
  export function create(max = 500): State {
    return {
      prices: new Map(),
      times: new Map(),
      max,
    };
  }

  // Format price with caching
  export function price(
    state: State,
    value: number,
    precision: number,
    formatter?: (v: number) => string,
  ): string {
    const key = `${value}|${precision}`;
    const cached = state.prices.get(key);

    if (cached) {
      cached.accessed = Date.now();
      return cached.label;
    }

    const label = formatter ? formatter(value) : value.toFixed(precision);

    if (state.prices.size >= state.max) {
      evict(state.prices, state.max);
    }

    state.prices.set(key, { label, accessed: Date.now() });
    return label;
  }

  // Format time with caching
  export function time(
    state: State,
    value: number,
    format: "date" | "time" | "datetime" = "date",
  ): string {
    const key = `${value}|${format}`;
    const cached = state.times.get(key);

    if (cached) {
      cached.accessed = Date.now();
      return cached.label;
    }

    const label = formatTime(value, format);

    if (state.times.size >= state.max) {
      evict(state.times, state.max);
    }

    state.times.set(key, { label, accessed: Date.now() });
    return label;
  }

  // Format time value to string
  function formatTime(
    value: number,
    format: "date" | "time" | "datetime",
  ): string {
    // Unix timestamp
    const date = new Date(value * 1000);
    if (format === "time") {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (format === "datetime") {
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  // Evict least recently used entries
  function evict(cache: Map<string, Entry>, max: number): void {
    const target = Math.floor(max * 0.75);
    const entries = Array.from(cache.entries()).sort(
      (a, b) => a[1].accessed - b[1].accessed,
    );

    const toRemove = cache.size - target;
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) cache.delete(entry[0]);
    }
  }

  // Clear all entries
  export function clear(state: State): void {
    state.prices.clear();
    state.times.clear();
  }

  // Get cache stats
  export function stats(state: State): {
    prices: number;
    times: number;
    max: number;
  } {
    return {
      prices: state.prices.size,
      times: state.times.size,
      max: state.max,
    };
  }
}
