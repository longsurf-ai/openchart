// Purpose: Tests for CoordSys transform functions and coordinate system utilities
// Module:  @openchart/chart-core / coord

import { describe, it, expect } from "vitest";
import { CoordSys } from "./def";

describe("CoordSys", () => {
  describe("linear", () => {
    it("maps value at extent min to range min", () => {
      const result = CoordSys.linear(0, [0, 100], [0, 500]);
      expect(result).toBe(0);
    });

    it("maps value at extent max to range max", () => {
      const result = CoordSys.linear(100, [0, 100], [0, 500]);
      expect(result).toBe(500);
    });

    it("maps midpoint correctly", () => {
      const result = CoordSys.linear(50, [0, 100], [0, 500]);
      expect(result).toBe(250);
    });

    it("handles inverted range for Y axis", () => {
      const result = CoordSys.linear(100, [0, 100], [500, 0]);
      expect(result).toBe(0);
    });

    it("handles zero extent range", () => {
      const result = CoordSys.linear(50, [50, 50], [0, 500]);
      expect(result).toBe(250);
    });

    it("handles negative values", () => {
      const result = CoordSys.linear(-50, [-100, 100], [0, 200]);
      expect(result).toBe(50);
    });
  });

  describe("log", () => {
    it("maps value at extent min to range min", () => {
      const result = CoordSys.log(1, [1, 100], [0, 500]);
      expect(result).toBeCloseTo(0);
    });

    it("maps value at extent max to range max", () => {
      const result = CoordSys.log(100, [1, 100], [0, 500]);
      expect(result).toBeCloseTo(500);
    });

    it("maps geometric midpoint to linear midpoint", () => {
      const result = CoordSys.log(10, [1, 100], [0, 500]);
      expect(result).toBeCloseTo(250);
    });

    it("handles inverted range for Y axis", () => {
      const result = CoordSys.log(100, [1, 100], [500, 0]);
      expect(result).toBeCloseTo(0);
    });
  });

  describe("inverse", () => {
    it("maps pixel at range min to extent min", () => {
      const result = CoordSys.inverse(0, [0, 100], [0, 500]);
      expect(result).toBe(0);
    });

    it("maps pixel at range max to extent max", () => {
      const result = CoordSys.inverse(500, [0, 100], [0, 500]);
      expect(result).toBe(100);
    });

    it("maps midpoint correctly", () => {
      const result = CoordSys.inverse(250, [0, 100], [0, 500]);
      expect(result).toBe(50);
    });

    it("handles inverted range for Y axis", () => {
      const result = CoordSys.inverse(0, [0, 100], [500, 0]);
      expect(result).toBe(100);
    });

    it("handles zero range", () => {
      const result = CoordSys.inverse(250, [0, 100], [250, 250]);
      expect(result).toBe(50);
    });
  });

  describe("toPixel", () => {
    it("uses linear mode by default", () => {
      const scale: CoordSys.Scale = {
        extent: [0, 100],
        range: [0, 500],
        mode: "linear",
      };
      expect(CoordSys.toPixel(50, scale)).toBe(250);
    });

    it("uses log mode when specified", () => {
      const scale: CoordSys.Scale = {
        extent: [1, 100],
        range: [0, 500],
        mode: "log",
      };
      expect(CoordSys.toPixel(10, scale)).toBeCloseTo(250);
    });
  });

  describe("toValue", () => {
    it("uses linear mode by default", () => {
      const scale: CoordSys.Scale = {
        extent: [0, 100],
        range: [0, 500],
        mode: "linear",
      };
      expect(CoordSys.toValue(250, scale)).toBe(50);
    });

    it("uses log mode when specified", () => {
      const scale: CoordSys.Scale = {
        extent: [1, 100],
        range: [0, 500],
        mode: "log",
      };
      expect(CoordSys.toValue(250, scale)).toBeCloseTo(10);
    });
  });

  describe("dataToPoint", () => {
    const state: CoordSys.State = {
      type: "cartesian2d",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      scales: {
        x: { extent: [0, 100], range: [0, 800], mode: "linear" },
        y: {
          right: { extent: [0, 100], range: [600, 0], mode: "linear" },
          left: { extent: [0, 1000000], range: [600, 0], mode: "linear" },
        },
      },
      defaultYScale: "right",
    };

    it("converts data to pixel coordinates using default scale", () => {
      const [x, y] = CoordSys.dataToPoint(state, [50, 50]);
      expect(x).toBe(400);
      expect(y).toBe(300);
    });

    it("uses specified Y scale", () => {
      const [x, y] = CoordSys.dataToPoint(state, [50, 500000], { y: "left" });
      expect(x).toBe(400);
      expect(y).toBe(300);
    });

    it("handles edge values", () => {
      const [x, y] = CoordSys.dataToPoint(state, [0, 0]);
      expect(x).toBe(0);
      expect(y).toBe(600);
    });

    it("handles max values", () => {
      const [x, y] = CoordSys.dataToPoint(state, [100, 100]);
      expect(x).toBe(800);
      expect(y).toBe(0);
    });
  });

  describe("pointToData", () => {
    const state: CoordSys.State = {
      type: "cartesian2d",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      scales: {
        x: { extent: [0, 100], range: [0, 800], mode: "linear" },
        y: {
          right: { extent: [0, 100], range: [600, 0], mode: "linear" },
        },
      },
      defaultYScale: "right",
    };

    it("converts pixel to data coordinates", () => {
      const [x, y] = CoordSys.pointToData(state, [400, 300]);
      expect(x).toBe(50);
      expect(y).toBe(50);
    });

    it("handles edge pixels", () => {
      const [x, y] = CoordSys.pointToData(state, [0, 600]);
      expect(x).toBe(0);
      expect(y).toBe(0);
    });

    it("handles max pixels", () => {
      const [x, y] = CoordSys.pointToData(state, [800, 0]);
      expect(x).toBe(100);
      expect(y).toBe(100);
    });
  });

  describe("contains", () => {
    const state: CoordSys.State = {
      type: "cartesian2d",
      bounds: { x: 50, y: 50, width: 700, height: 500 },
      scales: {
        x: { extent: [0, 100], range: [50, 750], mode: "linear" },
        y: { right: { extent: [0, 100], range: [550, 50], mode: "linear" } },
      },
      defaultYScale: "right",
    };

    it("returns true for point inside bounds", () => {
      expect(CoordSys.contains(state, [400, 300])).toBe(true);
    });

    it("returns true for point on boundary", () => {
      expect(CoordSys.contains(state, [50, 50])).toBe(true);
      expect(CoordSys.contains(state, [750, 550])).toBe(true);
    });

    it("returns false for point outside bounds", () => {
      expect(CoordSys.contains(state, [0, 0])).toBe(false);
      expect(CoordSys.contains(state, [800, 600])).toBe(false);
    });

    it("returns false for point just outside", () => {
      expect(CoordSys.contains(state, [49, 300])).toBe(false);
      expect(CoordSys.contains(state, [751, 300])).toBe(false);
    });
  });
});
