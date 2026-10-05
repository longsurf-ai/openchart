// Purpose: Tests for Effect translate/zoom functions, including cumulative-drift regression
// Module:  @openchart/chart-core / interaction

import { describe, it, expect } from "vitest";
import { Effect } from "./effect";

describe("Effect", () => {
  describe("translateY", () => {
    it("translates extent by pixel delta relative to height", () => {
      const extent = { min: 100, max: 200 };
      const result = Effect.translateY(extent, 50, 500, false);

      // dy=50, height=500 -> shift = 50/500 = 0.1 of range
      // range = 200-100 = 100, delta = 0.1 * 100 = 10
      expect(result.extent).toEqual({ min: 110, max: 210 });
    });

    it("uses initial extent for consistent translation", () => {
      const initial = { min: 100, max: 200 };

      // Simulate multiple frames with increasing total delta
      // Frame 1: total dy = 25
      const r1 = Effect.translateY(initial, 25, 500, false);
      expect(r1.extent).toEqual({ min: 105, max: 205 });

      // Frame 2: total dy = 50 (using same initial extent)
      const r2 = Effect.translateY(initial, 50, 500, false);
      expect(r2.extent).toEqual({ min: 110, max: 210 });

      // Frame 3: total dy = 75
      const r3 = Effect.translateY(initial, 75, 500, false);
      expect(r3.extent).toEqual({ min: 115, max: 215 });
    });

    it("demonstrates bug when using current extent", () => {
      // This test documents the bug that was fixed:
      // Using current extent with total delta causes cumulative movement
      let current = { min: 100, max: 200 };

      // Frame 1: dy=25 -> move 5 units
      const r1 = Effect.translateY(current, 25, 500, false);
      current = r1.extent!;

      // Frame 2: dy=50 (total), but applied to already-moved extent
      // BUG: This would move another 10 units instead of 5 more
      const r2 = Effect.translateY(current, 50, 500, false);

      // With the bug: min would be 115 instead of 110
      expect(r2.extent!.min).toBe(115); // Bug behavior
      // Correct behavior uses initial extent: min should be 110
    });

    it("does nothing for locked scales", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.translateY(extent, 50, 500, true);

      expect(result.extent).toBeUndefined();
    });

    it("handles negative delta (drag up)", () => {
      const extent = { min: 100, max: 200 };
      const result = Effect.translateY(extent, -50, 500, false);

      expect(result.extent).toEqual({ min: 90, max: 190 });
    });
  });

  describe("translateX", () => {
    it("uses initial offset with total delta", () => {
      const initial = 100;

      // Frame 1: total dx = 10
      const r1 = Effect.translateX(initial, 10);
      expect(r1.offset).toBe(90);

      // Frame 2: total dx = 20 (using same initial)
      const r2 = Effect.translateX(initial, 20);
      expect(r2.offset).toBe(80);

      // Frame 3: total dx = 30
      const r3 = Effect.translateX(initial, 30);
      expect(r3.offset).toBe(70);
    });
  });
});
