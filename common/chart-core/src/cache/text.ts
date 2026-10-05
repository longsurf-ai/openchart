// Purpose: Cached text dimension measurement (width + height) using canvas 2D context with LRU eviction
// Module:  @openchart/chart-core / cache

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
export namespace TextCache {
  type Entry = {
    width: number;
    height: number;
    accessed: number;
  };

  type State = {
    cache: Map<string, Entry>;
    max: number;
  };

  export function create(max = 1000): State {
    return { cache: new Map(), max };
  }

  function key(font: string, text: string): string {
    return `${font}|${text}`;
  }

  export function measure(
    state: State,
    ctx: CanvasRenderingContext2D,
    font: string,
    text: string,
  ): { width: number; height: number } {
    const k = key(font, text);
    const cached = state.cache.get(k);

    if (cached) {
      cached.accessed = Date.now();
      return { width: cached.width, height: cached.height };
    }

    ctx.font = font;
    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const height =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

    if (state.cache.size >= state.max) {
      evict(state);
    }

    state.cache.set(k, { width, height, accessed: Date.now() });
    return { width, height };
  }

  export function width(
    state: State,
    ctx: CanvasRenderingContext2D,
    font: string,
    text: string,
  ): number {
    return measure(state, ctx, font, text).width;
  }

  function evict(state: State): void {
    const target = Math.floor(state.max * 0.75);
    const entries = Array.from(state.cache.entries()).sort(
      (a, b) => a[1].accessed - b[1].accessed,
    );

    const toRemove = state.cache.size - target;
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) state.cache.delete(entry[0]);
    }
  }

  export function clear(state: State): void {
    state.cache.clear();
  }

  export function stats(state: State): { size: number; max: number } {
    return { size: state.cache.size, max: state.max };
  }
}
