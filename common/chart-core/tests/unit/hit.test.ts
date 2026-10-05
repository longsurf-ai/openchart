import { describe, it, expect } from "vitest";
import { HitTest } from "@openchart/chart-core/hit";

describe("HitTest", () => {
  describe("point", () => {
    it("detects hit when within threshold", () => {
      const result = HitTest.point(10, 10, 12, 12);
      expect(result.hit).toBe(true);
      expect(result.distance).toBeCloseTo(2.83, 1);
    });

    it("detects miss when outside threshold", () => {
      const result = HitTest.point(0, 0, 100, 100);
      expect(result.hit).toBe(false);
    });

    it("respects custom threshold", () => {
      const result = HitTest.point(0, 0, 3, 4, 10);
      expect(result.hit).toBe(true);
      expect(result.distance).toBe(5);
    });

    it("handles exact hit", () => {
      const result = HitTest.point(50, 50, 50, 50);
      expect(result.hit).toBe(true);
      expect(result.distance).toBe(0);
    });
  });

  describe("line", () => {
    it("detects hit on horizontal line", () => {
      const result = HitTest.line(50, 10, 0, 10, 100, 10);
      expect(result.hit).toBe(true);
      expect(result.distance).toBe(0);
    });

    it("detects hit on vertical line", () => {
      const result = HitTest.line(10, 50, 10, 0, 10, 100);
      expect(result.hit).toBe(true);
      expect(result.distance).toBe(0);
    });

    it("detects miss on line", () => {
      const result = HitTest.line(50, 50, 0, 0, 100, 0);
      expect(result.hit).toBe(false);
    });

    it("respects custom threshold", () => {
      const result = HitTest.line(50, 15, 0, 10, 100, 10, 10);
      expect(result.hit).toBe(true);
    });

    it("handles diagonal lines", () => {
      const result = HitTest.line(50, 50, 0, 0, 100, 100);
      expect(result.hit).toBe(true);
      expect(result.distance).toBeCloseTo(0, 1);
    });

    it("returns t parameter", () => {
      const result = HitTest.line(50, 0, 0, 0, 100, 0);
      expect(result.t).toBeCloseTo(0.5, 2);
    });
  });

  describe("rect", () => {
    it("detects hit inside rectangle", () => {
      const result = HitTest.rect(50, 50, 0, 0, 100, 100);
      expect(result).toBe(true);
    });

    it("detects hit on edge", () => {
      const result = HitTest.rect(0, 50, 0, 0, 100, 100);
      expect(result).toBe(true);
    });

    it("detects miss outside rectangle", () => {
      const result = HitTest.rect(150, 150, 0, 0, 100, 100);
      expect(result).toBe(false);
    });

    it("handles zero-width rectangle", () => {
      const result = HitTest.rect(50, 50, 50, 0, 0, 100);
      expect(result).toBe(true);
    });
  });

  describe("horizontal", () => {
    it("detects hit on horizontal line", () => {
      const result = HitTest.horizontal(50, 100, 100, 0, 100);
      expect(result).toBe(true);
    });

    it("detects miss outside x range", () => {
      const result = HitTest.horizontal(150, 100, 100, 0, 100);
      expect(result).toBe(false);
    });

    it("respects threshold", () => {
      const result = HitTest.horizontal(50, 105, 100, 0, 100, 10);
      expect(result).toBe(true);
    });
  });

  describe("vertical", () => {
    it("detects hit on vertical line", () => {
      const result = HitTest.vertical(100, 50, 100, 0, 100);
      expect(result).toBe(true);
    });

    it("detects miss outside y range", () => {
      const result = HitTest.vertical(100, 150, 100, 0, 100);
      expect(result).toBe(false);
    });
  });

  describe("test", () => {
    it("returns null for empty sources", () => {
      const result = HitTest.test(50, 50, []);
      expect(result).toBeNull();
    });

    it("returns first hit from sorted sources", () => {
      const sources: HitTest.Source[] = [
        {
          id: "a",
          zOrder: 0,
          test: () => null,
        },
        {
          id: "b",
          zOrder: 1,
          test: () => ({ type: "primitive", id: "b", distance: 5, zOrder: 1 }),
        },
      ];
      const result = HitTest.test(50, 50, sources);
      expect(result?.id).toBe("b");
      expect(result?.type).toBe("primitive");
    });

    it("skips sources that do not hit", () => {
      const sources: HitTest.Source[] = [
        { id: "a", zOrder: 0, test: () => null },
      ];
      const result = HitTest.test(50, 50, sources);
      expect(result).toBeNull();
    });

    it("respects z-order", () => {
      const sources: HitTest.Source[] = [
        {
          id: "bottom",
          zOrder: 0,
          test: () => ({
            type: "series",
            id: "bottom",
            distance: 0,
            zOrder: 0,
          }),
        },
        {
          id: "top",
          zOrder: 10,
          test: () => ({
            type: "primitive",
            id: "top",
            distance: 0,
            zOrder: 10,
          }),
        },
      ];
      const result = HitTest.test(50, 50, sources);
      expect(result?.id).toBe("top");
    });
  });

  describe("all", () => {
    it("returns all hits", () => {
      const sources: HitTest.Source[] = [
        {
          id: "a",
          zOrder: 0,
          test: () => ({ type: "series", id: "a", distance: 0, zOrder: 0 }),
        },
        {
          id: "b",
          zOrder: 1,
          test: () => ({ type: "primitive", id: "b", distance: 0, zOrder: 1 }),
        },
      ];
      const results = HitTest.all(50, 50, sources);
      expect(results).toHaveLength(2);
    });

    it("sorts by z-order descending", () => {
      const sources: HitTest.Source[] = [
        {
          id: "a",
          zOrder: 0,
          test: () => ({ type: "series", id: "a", distance: 0, zOrder: 0 }),
        },
        {
          id: "b",
          zOrder: 10,
          test: () => ({ type: "primitive", id: "b", distance: 0, zOrder: 10 }),
        },
      ];
      const results = HitTest.all(50, 50, sources);
      expect(results[0]?.id).toBe("b");
      expect(results[1]?.id).toBe("a");
    });
  });

  describe("series helper", () => {
    it("creates series source", () => {
      const source = HitTest.series("test-series", 5, () => ({
        index: 10,
        value: 100,
        distance: 3,
      }));

      expect(source.id).toBe("test-series");
      expect(source.zOrder).toBe(5);

      const result = source.test(50, 50);
      expect(result?.type).toBe("series");
      expect(result?.index).toBe(10);
      expect(result?.value).toBe(100);
    });
  });

  describe("primitive helper", () => {
    it("creates primitive source", () => {
      const source = HitTest.primitive("test-primitive", 8, () => ({
        distance: 2,
        data: { custom: true },
      }));

      expect(source.id).toBe("test-primitive");
      expect(source.zOrder).toBe(8);

      const result = source.test(50, 50);
      expect(result?.type).toBe("primitive");
      expect(result?.data).toEqual({ custom: true });
    });
  });
});
