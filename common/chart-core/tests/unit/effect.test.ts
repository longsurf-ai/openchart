import { describe, it, expect } from "vitest";
import { Effect } from "@openchart/chart-core/interaction/effect";

describe("Effect", () => {
  describe("translateX", () => {
    it("computes new offset from drag", () => {
      const result = Effect.translateX(100, 50);
      expect(result.offset).toBe(50);
    });

    it("handles negative delta", () => {
      const result = Effect.translateX(100, -50);
      expect(result.offset).toBe(150);
    });
  });

  describe("zoomX", () => {
    it("zooms out with positive delta", () => {
      const result = Effect.zoomX(10, 0, 800, 1, 400, 0.5, 50);
      expect(result.spacing).toBeLessThan(10);
    });

    it("zooms in with negative delta", () => {
      const result = Effect.zoomX(10, 0, 800, -1, 400, 0.5, 50);
      expect(result.spacing).toBeGreaterThan(10);
    });

    it("clamps to minimum", () => {
      const result = Effect.zoomX(1, 0, 800, 1, 400, 0.5, 50);
      expect(result.spacing).toBeGreaterThanOrEqual(0.5);
    });

    it("clamps to maximum", () => {
      const result = Effect.zoomX(45, 0, 800, -1, 400, 0.5, 50);
      expect(result.spacing).toBeLessThanOrEqual(50);
    });

    it("returns new offset", () => {
      const result = Effect.zoomX(10, 0, 800, 1, 400, 0.5, 50);
      expect(result.offset).toBeDefined();
      expect(typeof result.offset).toBe("number");
    });
  });

  describe("resetX", () => {
    it("returns default spacing and offset", () => {
      const result = Effect.resetX();
      expect(result.spacing).toBe(6);
      expect(result.offset).toBe(0);
    });
  });

  describe("translateY", () => {
    it("shifts extent when not locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.translateY(extent, 40, 400, false);
      expect(result.extent).toBeDefined();
      expect(result.extent!.min).toBeGreaterThan(0);
      expect(result.extent!.max).toBeGreaterThan(100);
    });

    it("returns empty when locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.translateY(extent, 40, 400, true);
      expect(result.extent).toBeUndefined();
    });
  });

  describe("zoomY", () => {
    it("expands extent with factor > 1 when not locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.zoomY(extent, 1.5, false);
      expect(result.extent!.max - result.extent!.min).toBe(150);
    });

    it("shrinks extent with factor < 1 when not locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.zoomY(extent, 0.5, false);
      expect(result.extent!.max - result.extent!.min).toBe(50);
    });

    it("locks min to 0 when locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.zoomY(extent, 1.5, true);
      expect(result.extent!.min).toBe(0);
    });

    it("clamps factor to min 0.2 when locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.zoomY(extent, 0.1, true);
      expect(result.extent!.max).toBe(20);
    });

    it("clamps factor to max 5.0 when locked", () => {
      const extent = { min: 0, max: 100 };
      const result = Effect.zoomY(extent, 10, true);
      expect(result.extent!.max).toBe(500);
    });

    it("keeps center stable when not locked", () => {
      const extent = { min: 50, max: 150 };
      const result = Effect.zoomY(extent, 2, false);
      const mid = (result.extent!.min + result.extent!.max) / 2;
      expect(mid).toBe(100);
    });
  });

  describe("resetY", () => {
    it("returns undefined extent and default margins", () => {
      const result = Effect.resetY();
      expect(result.extent).toBeUndefined();
      expect(result.margins).toEqual({ top: 0.1, bottom: 0.1 });
    });
  });
});
