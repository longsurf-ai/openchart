// Purpose: Horizontal time scale — converts data indices to x-coordinates, computes visible ranges and bar widths
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { type Nominal, nominal } from "@openchart/chart-core/util/nominal";
import { Data } from "@openchart/chart-core/data";

export namespace TimeScale {
  // Branded types
  export type Coord = Nominal<number, "TimeCoord">;
  export type Logical = Nominal<number, "Logical">;

  export function coord(n: number): Coord {
    return nominal<number, "TimeCoord">(n);
  }

  export function logical(n: number): Logical {
    return nominal<number, "Logical">(n);
  }

  export const State = z.object({
    width: z.number(),
    barSpacing: z.number().default(6),
    rightOffset: z.number().default(0),
    minBarSpacing: z.number().default(0.5),
    maxBarSpacing: z.number().default(50),
    fixLeftEdge: z.boolean().default(false),
    fixRightEdge: z.boolean().default(false),
    visible: z.boolean().default(true),
  });
  export type State = z.infer<typeof State>;

  // Visible range
  export const Range = z.object({
    from: z.number(),
    to: z.number(),
  });
  export type Range = z.infer<typeof Range>;

  export function indexToX(state: State, idx: number, total: number): Coord {
    const rightEdge = state.width - state.rightOffset;
    const x = rightEdge - (total - 1 - idx) * state.barSpacing;
    return coord(Math.round(x));
  }

  export function xToIndex(state: State, x: number, total: number): Logical {
    const rightEdge = state.width - state.rightOffset;
    const idx = total - 1 - (rightEdge - x) / state.barSpacing;
    return logical(Math.round(idx));
  }

  /** Result of visibleRange with both raw and clamped ranges */
  export type VisibleRangeResult = {
    /** Raw range (can go negative or past data bounds) - use for events */
    range: Range;
    /** Valid range clamped to data bounds - use for painting */
    valid: Range;
  };

  export function visibleRange(
    state: State,
    total: number,
  ): VisibleRangeResult {
    if (total === 0)
      return { range: { from: 0, to: 0 }, valid: { from: 0, to: 0 } };

    // Calculate which indices are actually visible on screen
    // Based on indexToX formula: x = (width - rightOffset) - (total - 1 - idx) * barSpacing
    // Solving for idx at x=0 and x=width:
    const idxAtRightEdge = total - 1 + state.rightOffset / state.barSpacing;
    const idxAtLeftEdge =
      total - 1 - (state.width - state.rightOffset) / state.barSpacing;

    // Raw range (can be negative or exceed bounds)
    // Arithmetic at an exact bar boundary can land a few ulps below it.
    const stableFloor = (value: number) =>
      Math.floor(
        value + Number.EPSILON * Math.max(1, total, Math.abs(value)) * 8,
      );
    const rawFrom = stableFloor(idxAtLeftEdge);
    const rawTo = stableFloor(idxAtRightEdge) + 1;

    // Valid range clamped to data bounds
    const firstVisible = Math.min(total, Math.max(0, rawFrom));
    const visibleEnd = Math.max(firstVisible, Math.min(total, rawTo));

    return {
      range: { from: rawFrom, to: rawTo },
      valid: { from: firstVisible, to: visibleEnd },
    };
  }

  export function barWidth(state: State): number {
    return Math.max(1, Math.floor(state.barSpacing * 0.8));
  }

  export function format(time: Data.Time): string {
    return new Date(time * 1000).toLocaleDateString();
  }
}
