import { describe, it, expect } from "vitest";
import {
  LineSeries,
  CandlestickSeries,
} from "@openchart/chart-core/series/builtin";

describe("Paint", () => {
  describe("visibleValueExtent", () => {
    it("computes extent for visible range only (LineSeries)", () => {
      const data = [
        { value: 0 },
        { value: 100 },
        { value: 105 },
        { value: 110 },
        { value: 1000 },
      ];

      // View indices 1 to 4 -> [100, 105, 110]
      // Returns raw min/max (no padding - scaleMargins handles visual padding)
      const extent = LineSeries.visibleExtent(data, 1, 4);
      expect(extent).toEqual({ min: 100, max: 110 });
    });

    it("ignores outliers outside visible range (LineSeries)", () => {
      const data = Array.from({ length: 10000 }, (_, i) => ({ value: i }));
      // View 5000-5010
      const extent = LineSeries.visibleExtent(data, 5000, 5010);
      // Returns raw min/max for visible range
      expect(extent).toEqual({ min: 5000, max: 5009 });
    });

    it("computes extent from high/low for CandlestickSeries", () => {
      const data = [
        { high: 200, low: 100, open: 150, close: 150 }, // 0
        { high: 110, low: 90, open: 100, close: 100 }, // 1: Visible
        { high: 120, low: 80, open: 100, close: 100 }, // 2: Visible
        { high: 300, low: 50, open: 100, close: 100 }, // 3: Hidden
      ];

      // View indices 1 to 3 -> Items 1 and 2
      // Item 1: high 110, low 90
      // Item 2: high 120, low 80
      // Returns raw min/max (no padding - scaleMargins handles visual padding)
      const extent = CandlestickSeries.visibleExtent(data, 1, 3);
      expect(extent).toEqual({ min: 80, max: 120 });
    });
  });
});
