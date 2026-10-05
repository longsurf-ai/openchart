// Purpose: DataView — windowed read-only view over series data with index-based accessors
// Module:  @openchart/chart-core / data

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
export type SeriesType = string;

export namespace DataView {
  export interface Config {
    from: number;
    to: number;
    buffer?: number;
  }

  export interface View<T> {
    readonly from: number;
    readonly to: number;
    readonly length: number;
    readonly total: number;

    item(index: number): T | undefined;
    x(index: number): number | undefined;
    time(index: number): unknown;

    forEach(fn: (item: T, index: number, x: number) => void): void;
    map<R>(fn: (item: T, index: number, x: number) => R): R[];
  }

  export function create<T = Record<string, unknown>>(
    _type: SeriesType,
    data: unknown[],
    config: Config,
    xFn: (index: number) => number,
  ): View<T> {
    const buffer = config.buffer ?? 0;
    const from = Math.max(0, config.from - buffer);
    const to = Math.min(data.length, config.to + buffer);

    return {
      from,
      to,
      length: Math.max(0, to - from),
      total: data.length,

      item(i: number): T | undefined {
        if (i < from || i >= to) return undefined;
        return data[i] as T | undefined;
      },

      x(i: number): number | undefined {
        if (i < from || i >= to) return undefined;
        return xFn(i);
      },

      time(i: number): unknown {
        if (i < from || i >= to) return undefined;
        return (data[i] as { time?: unknown } | undefined)?.time;
      },

      forEach(fn: (item: T, index: number, x: number) => void): void {
        for (let i = from; i < to; i++) {
          const d = data[i] as T | undefined;
          if (d) fn(d, i, xFn(i));
        }
      },

      map<R>(fn: (item: T, index: number, x: number) => R): R[] {
        const result: R[] = [];
        for (let i = from; i < to; i++) {
          const d = data[i] as T | undefined;
          if (d) result.push(fn(d, i, xFn(i)));
        }
        return result;
      },
    };
  }
}
