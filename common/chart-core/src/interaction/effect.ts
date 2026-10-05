// Purpose: Pure functions that compute X/Y state updates (translate, zoom, reset) from interaction deltas
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace Effect {
  export const XUpdate = z.object({
    spacing: z.number().optional(),
    offset: z.number().optional(),
  });
  export type XUpdate = z.infer<typeof XUpdate>;

  export const YUpdate = z.object({
    extent: z.object({ min: z.number(), max: z.number() }).optional(),
    margins: z.object({ top: z.number(), bottom: z.number() }).optional(),
  });
  export type YUpdate = z.infer<typeof YUpdate>;

  export function translateX(offset: number, dx: number): XUpdate {
    return { offset: offset - dx };
  }

  export function zoomX(
    spacing: number,
    offset: number,
    width: number,
    dy: number,
    x: number,
    min: number,
    max: number,
  ): XUpdate {
    const factor = dy > 0 ? 0.9 : 1.1;
    const next = Math.max(min, Math.min(max, spacing * factor));
    const dist = width - offset - x;
    const bars = dist / spacing;
    return { spacing: next, offset: width - x - bars * next };
  }

  export function resetX(): XUpdate {
    return { spacing: 6, offset: 0 };
  }

  export function translateY(
    extent: { min: number; max: number },
    dy: number,
    height: number,
    locked: boolean,
  ): YUpdate {
    if (locked) return {};
    const range = extent.max - extent.min;
    const delta = (dy / height) * range;
    return { extent: { min: extent.min + delta, max: extent.max + delta } };
  }

  export function zoomY(
    extent: { min: number; max: number },
    factor: number,
    locked: boolean,
  ): YUpdate {
    if (locked) {
      const clamped = Math.max(0.2, Math.min(5.0, factor));
      return { extent: { min: 0, max: extent.max * clamped } };
    }
    const range = extent.max - extent.min;
    const clamped = Math.max(0.01, factor);
    const next = range * clamped;
    const mid = (extent.min + extent.max) / 2;
    return { extent: { min: mid - next / 2, max: mid + next / 2 } };
  }

  export function resetY(): YUpdate {
    return { extent: undefined, margins: { top: 0.1, bottom: 0.1 } };
  }
}
