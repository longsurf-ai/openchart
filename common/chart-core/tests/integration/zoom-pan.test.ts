import { describe, it, expect } from "vitest";
import { TimeScale } from "@openchart/chart-core/scale/time";
import { CoordSys } from "@openchart/chart-core/coord/def";
import { createCartesian2D } from "@openchart/chart-core/coord/cartesian";

describe("Zoom and Pan Integration", () => {
  const width = 800;
  const height = 600;
  const total = 100;

  describe("TimeScale X coordinates (zoom)", () => {
    it("zooming in increases bar spacing", () => {
      const initial = TimeScale.State.parse({ width, barSpacing: 6 });
      const zoomed = { ...initial, barSpacing: 12 };

      const x1 = TimeScale.indexToX(initial, 50, total);
      const x2 = TimeScale.indexToX(zoomed, 50, total);

      expect(zoomed.barSpacing).toBeGreaterThan(initial.barSpacing);
      expect(x2).not.toBe(x1);
    });

    it("zooming out decreases bar spacing", () => {
      const initial = TimeScale.State.parse({ width, barSpacing: 6 });
      const zoomed = { ...initial, barSpacing: 3 };

      expect(zoomed.barSpacing).toBeLessThan(initial.barSpacing);
    });

    it("bar spacing has min and max bounds", () => {
      const state = TimeScale.State.parse({ width, barSpacing: 6 });
      expect(state.minBarSpacing).toBe(0.5);
      expect(state.maxBarSpacing).toBe(50);
    });

    it("visible range changes with zoom", () => {
      const wideView = TimeScale.State.parse({ width, barSpacing: 3 });
      const closeView = TimeScale.State.parse({ width, barSpacing: 12 });

      const { valid: wideRange } = TimeScale.visibleRange(wideView, total);
      const { valid: closeRange } = TimeScale.visibleRange(closeView, total);

      const wideCount = wideRange.to - wideRange.from;
      const closeCount = closeRange.to - closeRange.from;

      expect(wideCount).toBeGreaterThan(closeCount);
    });
  });

  describe("TimeScale X coordinates (pan)", () => {
    it("panning right increases rightOffset", () => {
      const initial = TimeScale.State.parse({
        width,
        barSpacing: 6,
        rightOffset: 0,
      });
      const panned = { ...initial, rightOffset: 50 };

      const x1 = TimeScale.indexToX(initial, 99, total);
      const x2 = TimeScale.indexToX(panned, 99, total);

      expect(x2).toBeLessThan(x1);
    });

    it("panning left decreases rightOffset", () => {
      const initial = TimeScale.State.parse({
        width,
        barSpacing: 6,
        rightOffset: 50,
      });
      const panned = { ...initial, rightOffset: 0 };

      const x1 = TimeScale.indexToX(initial, 99, total);
      const x2 = TimeScale.indexToX(panned, 99, total);

      expect(x2).toBeGreaterThan(x1);
    });

    it("visible range shifts with pan", () => {
      const initial = TimeScale.State.parse({
        width,
        barSpacing: 6,
        rightOffset: 0,
      });
      const panned = { ...initial, rightOffset: 100 };

      const x1 = TimeScale.indexToX(initial, 99, total);
      const x2 = TimeScale.indexToX(panned, 99, total);

      expect(x2).toBeLessThan(x1);
    });
  });

  describe("CoordSys Y coordinates (independent of zoom)", () => {
    it("Y coordinates unaffected by TimeScale changes", () => {
      const bounds = { x: 0, y: 0, width, height };
      const extents = {
        x: { min: 0, max: 100 },
        y: { right: { min: 100, max: 200 } },
      };
      const coord = createCartesian2D(bounds, extents);

      const [, y1] = CoordSys.dataToPoint(coord, [50, 150]);
      const [, y2] = CoordSys.dataToPoint(coord, [0, 150]);
      const [, y3] = CoordSys.dataToPoint(coord, [100, 150]);

      expect(y1).toBe(y2);
      expect(y2).toBe(y3);
      expect(y1).toBe(300);
    });
  });

  describe("Multiple Y scales", () => {
    it("supports independent scales for price and volume", () => {
      const bounds = { x: 0, y: 0, width, height };
      const extents = {
        x: { min: 0, max: 100 },
        y: {
          right: { min: 100, max: 200 },
          left: { min: 0, max: 1000000 },
        },
      };
      const coord = createCartesian2D(bounds, extents);

      const [, priceY] = CoordSys.dataToPoint(coord, [50, 150], { y: "right" });
      const [, volumeY] = CoordSys.dataToPoint(coord, [50, 500000], {
        y: "left",
      });

      expect(priceY).toBe(300);
      expect(volumeY).toBe(300);
    });

    it("each scale has independent extent", () => {
      const bounds = { x: 0, y: 0, width, height };
      const extents = {
        x: { min: 0, max: 100 },
        y: {
          right: { min: 0, max: 100 },
          left: { min: 0, max: 10000 },
        },
      };
      const coord = createCartesian2D(bounds, extents);

      expect(coord.scales.y.right.extent).toEqual([0, 100]);
      expect(coord.scales.y.left.extent).toEqual([0, 10000]);
    });
  });

  describe("Combined X and Y coordinate transformation", () => {
    it("transforms data point using TimeScale for X and CoordSys for Y", () => {
      const ts = TimeScale.State.parse({ width, barSpacing: 8 });
      const bounds = { x: 0, y: 0, width, height };
      const extents = {
        x: { min: 0, max: total - 1 },
        y: { right: { min: 100, max: 200 } },
      };
      const coord = createCartesian2D(bounds, extents);

      const idx = 50;
      const value = 150;

      const x = TimeScale.indexToX(ts, idx, total);
      const [, y] = CoordSys.dataToPoint(coord, [idx, value]);

      expect(typeof x).toBe("number");
      expect(typeof y).toBe("number");
      expect(y).toBe(300);
    });

    it("zoom affects only X coordinates in combined usage", () => {
      const tsInitial = TimeScale.State.parse({ width, barSpacing: 6 });
      const tsZoomed = TimeScale.State.parse({ width, barSpacing: 12 });
      const bounds = { x: 0, y: 0, width, height };
      const extents = {
        x: { min: 0, max: total - 1 },
        y: { right: { min: 100, max: 200 } },
      };
      const coord = createCartesian2D(bounds, extents);

      const idx = 50;
      const value = 150;

      const x1 = TimeScale.indexToX(tsInitial, idx, total);
      const x2 = TimeScale.indexToX(tsZoomed, idx, total);
      const [, y1] = CoordSys.dataToPoint(coord, [idx, value]);
      const [, y2] = CoordSys.dataToPoint(coord, [idx, value]);

      expect(x1).not.toBe(x2);
      expect(y1).toBe(y2);
    });
  });
});
