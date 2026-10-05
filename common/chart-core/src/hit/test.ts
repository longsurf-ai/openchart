// Purpose: Geometry-based hit testing for chart elements (series, primitives, axes, panes)
// Module:  @openchart/chart-core / hit

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace HitTest {
  // Result of a hit test
  export const Result = z.object({
    type: z.enum(["series", "primitive", "axis", "pane"]),
    id: z.string(),
    index: z.number().optional(),
    value: z.number().optional(),
    distance: z.number().default(0),
    zOrder: z.number().default(0),
    data: z.unknown().optional(),
  });
  export type Result = z.infer<typeof Result>;

  // Source that can be hit tested
  export type Source = {
    id: string;
    zOrder: number;
    test: (x: number, y: number) => Result | null;
  };

  // Test all sources and return closest hit
  export function test(x: number, y: number, sources: Source[]): Result | null {
    if (sources.length === 0) return null;

    // Sort by z-order descending (top to bottom)
    const sorted = [...sources].sort((a, b) => b.zOrder - a.zOrder);

    for (const s of sorted) {
      const result = s.test(x, y);
      if (result) return result;
    }

    return null;
  }

  // Test all sources and return all hits
  export function all(x: number, y: number, sources: Source[]): Result[] {
    const results: Result[] = [];

    for (const s of sources) {
      const result = s.test(x, y);
      if (result) results.push(result);
    }

    return results.sort((a, b) => b.zOrder - a.zOrder);
  }

  // Test if point is within distance of target point
  export function point(
    x: number,
    y: number,
    tx: number,
    ty: number,
    threshold = 10,
  ): { hit: boolean; distance: number } {
    const dx = x - tx;
    const dy = y - ty;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return { hit: distance <= threshold, distance };
  }

  // Test if point is within a rectangle
  export function rect(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
  ): boolean {
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }

  // Test if point is near a line segment
  export function line(
    x: number,
    y: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    threshold = 5,
  ): { hit: boolean; distance: number; t: number } {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) {
      const d = Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
      return { hit: d <= threshold, distance: d, t: 0 };
    }

    // Project point onto line
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const distance = Math.sqrt((x - px) ** 2 + (y - py) ** 2);

    return { hit: distance <= threshold, distance, t };
  }

  // Test if point is near a horizontal line
  export function horizontal(
    x: number,
    y: number,
    lineY: number,
    x1: number,
    x2: number,
    threshold = 5,
  ): boolean {
    return x >= x1 && x <= x2 && Math.abs(y - lineY) <= threshold;
  }

  // Test if point is near a vertical line
  export function vertical(
    x: number,
    y: number,
    lineX: number,
    y1: number,
    y2: number,
    threshold = 5,
  ): boolean {
    return y >= y1 && y <= y2 && Math.abs(x - lineX) <= threshold;
  }

  // Create a hit test source for a series
  export function series(
    id: string,
    zOrder: number,
    tester: (
      x: number,
      y: number,
    ) => { index: number; value: number; distance: number } | null,
  ): Source {
    return {
      id,
      zOrder,
      test: (x, y) => {
        const hit = tester(x, y);
        if (!hit) return null;
        return {
          type: "series",
          id,
          index: hit.index,
          value: hit.value,
          distance: hit.distance,
          zOrder,
        };
      },
    };
  }

  // Create a hit test source for a primitive
  export function primitive(
    id: string,
    zOrder: number,
    tester: (
      x: number,
      y: number,
    ) => { distance: number; data?: unknown } | null,
  ): Source {
    return {
      id,
      zOrder,
      test: (x, y) => {
        const hit = tester(x, y);
        if (!hit) return null;
        return {
          type: "primitive",
          id,
          distance: hit.distance,
          zOrder,
          data: hit.data,
        };
      },
    };
  }
}
