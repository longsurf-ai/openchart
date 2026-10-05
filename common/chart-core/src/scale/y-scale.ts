// Purpose: Y-axis scale — maps data values to pixel coordinates and vice versa, with Zod-validated state
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { type Nominal, nominal } from "@openchart/chart-core/util/nominal";

export namespace YScale {
  export type Coord = Nominal<number, "Coord">;
  export type Value = Nominal<number, "Value">;
  export type Index = Nominal<number, "Index">;

  export function coord(n: number): Coord {
    return nominal<number, "Coord">(n);
  }

  export function value(n: number): Value {
    return nominal<number, "Value">(n);
  }

  export function index(n: number): Index {
    return nominal<number, "Index">(n);
  }

  export const State = z.object({
    min: z.number(),
    max: z.number(),
    height: z.number(),
    margin: z
      .object({
        top: z.number().default(0.1),
        bottom: z.number().default(0.1),
      })
      .default({ top: 0.1, bottom: 0.1 }),
    inverted: z.boolean().default(false),
    mode: z
      .enum(["normal", "logarithmic", "percentage", "indexed"])
      .default("normal"),
  });
  export type State = z.infer<typeof State>;

  export function toY(state: State, v: number): Coord {
    const range = state.max - state.min;
    if (range === 0) return coord(state.height / 2);

    const ratio = (v - state.min) / range;
    const y = state.inverted
      ? state.height * ratio
      : state.height * (1 - ratio);

    return coord(Math.round(y));
  }

  export function toValue(state: State, y: number): Value {
    const range = state.max - state.min;
    if (state.height === 0) return value(state.min);

    const ratio = state.inverted ? y / state.height : 1 - y / state.height;

    return value(state.min + ratio * range);
  }

  export function fromData(
    data: { high: number; low: number }[],
    height: number,
  ): State {
    if (data.length === 0) {
      return {
        min: 0,
        max: 100,
        height,
        margin: { top: 0.1, bottom: 0.1 },
        inverted: false,
        mode: "normal",
      };
    }

    let min = Infinity;
    let max = -Infinity;

    for (const d of data) {
      if (d.low < min) min = d.low;
      if (d.high > max) max = d.high;
    }

    const range = max - min;
    const margin = range * 0.1;

    return {
      min: min - margin,
      max: max + margin,
      height,
      margin: { top: 0.1, bottom: 0.1 },
      inverted: false,
      mode: "normal",
    };
  }

  export function fromValues(values: number[], height: number): State {
    if (values.length === 0) {
      return fromData([], height);
    }

    let min = Infinity;
    let max = -Infinity;

    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }

    return fromData([{ high: max, low: min }], height);
  }
}
