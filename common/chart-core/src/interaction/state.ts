// Purpose: Drag session state — captures initial extents/offsets at drag start to avoid cumulative drift
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Action } from "./action";

/**
 * Drag state captures initial values at drag start for consistent updates.
 *
 * Key insight: Action.drag computes total delta from start (not incremental),
 * so we must store initial values and apply total delta each frame:
 *   newValue = initialValue + f(totalDelta)
 *
 * This avoids cumulative drift from applying deltas to already-moved values.
 */
export namespace Drag {
  /**
   * @property region - Where the drag originated (canvas, yscale, xscale, series)
   * @property start - Initial pointer position when drag began
   * @property current - Current pointer position (updated each frame)
   * @property mods - Modifier keys held during drag (shift, ctrl, etc)
   * @property extent - Initial Y extent for single-scale drags (yscale region)
   * @property offset - Initial X offset (xAxis rightOffset) for canvas drags
   * @property extents - Initial Y extents per scale for multi-scale drags (shift+canvas)
   */
  export const State = z.object({
    region: Action.Region,
    start: Action.Point,
    current: Action.Point,
    mods: Action.Modifiers,
    extent: z.object({ min: z.number(), max: z.number() }).optional(),
    offset: z.number().optional(),
    domain: z
      .object({
        min: z.number(),
        max: z.number(),
        minSpan: z.number().positive(),
      })
      .optional(),
    extents: z
      .record(z.string(), z.object({ min: z.number(), max: z.number() }))
      .optional(),
  });
  export type State = z.infer<typeof State>;

  type Extras = {
    extent?: { min: number; max: number };
    offset?: number;
    domain?: { min: number; max: number; minSpan: number };
    extents?: Record<string, { min: number; max: number }>;
  };

  export function begin(
    region: Action.Region,
    point: Action.Point,
    mods: Action.Modifiers,
    extras?: Extras,
  ): State {
    return {
      region,
      start: point,
      current: point,
      mods,
      extent: extras?.extent,
      offset: extras?.offset,
      domain: extras?.domain,
      extents: extras?.extents,
    };
  }

  export function update(state: State, point: Action.Point): State {
    return { ...state, current: point };
  }
}
