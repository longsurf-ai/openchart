// Purpose: Tests for scale module — ScaleMode, PriceAxis, TimeAxis, and TimeScale
// Module:  @openchart/chart-core / tests / unit

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ScaleMode,
  PriceAxis,
  TimeAxis,
  TimeScale,
} from "@openchart/chart-core/scale";

describe("ScaleMode", () => {
  describe("toPercent", () => {
    it("converts price to percentage", () => {
      expect(ScaleMode.toPercent(110, 100)).toBe(10);
      expect(ScaleMode.toPercent(90, 100)).toBe(-10);
      expect(ScaleMode.toPercent(100, 100)).toBe(0);
    });

    it("handles first value of 0", () => {
      expect(ScaleMode.toPercent(100, 0)).toBe(0);
    });
  });

  describe("fromPercent", () => {
    it("converts percentage to price", () => {
      expect(ScaleMode.fromPercent(10, 100)).toBeCloseTo(110, 10);
      expect(ScaleMode.fromPercent(-10, 100)).toBeCloseTo(90, 10);
      expect(ScaleMode.fromPercent(0, 100)).toBeCloseTo(100, 10);
    });
  });

  describe("toIndexed", () => {
    it("converts price to indexed value", () => {
      expect(ScaleMode.toIndexed(110, 100)).toBeCloseTo(110, 10);
      expect(ScaleMode.toIndexed(90, 100)).toBeCloseTo(90, 10);
    });

    it("handles first value of 0", () => {
      expect(ScaleMode.toIndexed(100, 0)).toBe(100);
    });
  });

  describe("fromIndexed", () => {
    it("converts indexed value to price", () => {
      expect(ScaleMode.fromIndexed(110, 100)).toBeCloseTo(110, 10);
      expect(ScaleMode.fromIndexed(90, 100)).toBeCloseTo(90, 10);
    });
  });

  describe("toCoordMode", () => {
    it("maps normal to linear", () => {
      expect(ScaleMode.toCoordMode("normal")).toBe("linear");
    });

    it("maps logarithmic to log", () => {
      expect(ScaleMode.toCoordMode("logarithmic")).toBe("log");
    });

    it("maps percentage to linear", () => {
      expect(ScaleMode.toCoordMode("percentage")).toBe("linear");
    });

    it("maps indexed to linear", () => {
      expect(ScaleMode.toCoordMode("indexed")).toBe("linear");
    });
  });

  describe("formatter", () => {
    it("formats percentage values with sign", () => {
      const fmt = ScaleMode.formatter("percentage");
      expect(fmt(5)).toBe("+5.00%");
      expect(fmt(-3)).toBe("-3.00%");
    });

    it("formats indexed values", () => {
      const fmt = ScaleMode.formatter("indexed");
      expect(fmt(100.5)).toBe("100.50");
    });

    it("respects precision", () => {
      const fmt = ScaleMode.formatter("percentage", 1);
      expect(fmt(5.567)).toBe("+5.6%");
    });
  });
});

describe("PriceAxis", () => {
  const mockCtx = {
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    font: "12px sans-serif",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "middle" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;

  describe("generateTicks", () => {
    it("generates tick marks", () => {
      const ticks = PriceAxis.generateTicks([100, 200], 400);
      expect(ticks.length).toBeGreaterThan(0);
    });

    it("tick values are within extent", () => {
      const ticks = PriceAxis.generateTicks([100, 200], 400);
      for (const tick of ticks) {
        expect(tick.value).toBeGreaterThanOrEqual(100);
        expect(tick.value).toBeLessThanOrEqual(200);
      }
    });

    it("respects tick count hint", () => {
      const fewTicks = PriceAxis.generateTicks([0, 100], 400, 3);
      const manyTicks = PriceAxis.generateTicks([0, 100], 400, 10);
      expect(manyTicks.length).toBeGreaterThanOrEqual(fewTicks.length);
    });

    it("generates labels with precision", () => {
      const ticks = PriceAxis.generateTicks([100.123, 100.456], 400, 5, 3);
      for (const tick of ticks) {
        // Labels should have some decimal places (depends on step)
        expect(tick.label).toMatch(/\d+\.\d+/);
      }
    });
  });

  describe("render", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders tick marks", () => {
      const ticks = [
        { value: 100, y: 300, label: "100.00" },
        { value: 150, y: 200, label: "150.00" },
        { value: 200, y: 100, label: "200.00" },
      ];

      PriceAxis.render(
        mockCtx,
        ticks,
        {
          side: "right",
          width: 60,
          visible: true,
          textColor: "#191919",
          font: "12px sans-serif",
          tickCount: 5,
          precision: 2,
        },
        { x: 0, y: 0, width: 800, height: 400 },
      );

      expect(mockCtx.fillText).toHaveBeenCalled();
    });

    it("skips labels that would cross pane boundaries", () => {
      const ticks = [
        { value: 8, y: 100, label: "8.00" },
        { value: 6, y: 130, label: "6.00" },
      ];

      PriceAxis.render(
        mockCtx,
        ticks,
        {
          side: "right",
          width: 60,
          visible: true,
          textColor: "#191919",
          font: "12px sans-serif",
          tickCount: 5,
          precision: 2,
        },
        { x: 740, y: 100, width: 60, height: 120 },
      );

      expect(mockCtx.fillText).not.toHaveBeenCalledWith("8.00", 752, 100);
      expect(mockCtx.fillText).toHaveBeenCalledWith("6.00", 752, 130);
    });

    it("aligns text based on side", () => {
      const ticks = [{ value: 100, y: 200, label: "100.00" }];

      PriceAxis.render(
        mockCtx,
        ticks,
        {
          side: "left",
          width: 60,
          visible: true,
          textColor: "#191919",
          font: "12px sans-serif",
          tickCount: 5,
          precision: 2,
        },
        { x: 0, y: 0, width: 800, height: 400 },
      );
      expect(mockCtx.textAlign).toBe("right");

      PriceAxis.render(
        mockCtx,
        ticks,
        {
          side: "right",
          width: 60,
          visible: true,
          textColor: "#191919",
          font: "12px sans-serif",
          tickCount: 5,
          precision: 2,
        },
        { x: 0, y: 0, width: 800, height: 400 },
      );
      expect(mockCtx.textAlign).toBe("left");
    });
  });

  describe("fromVisualRange", () => {
    it("generates ticks covering full visual height", () => {
      const scale = {
        extent: [100, 120] as [number, number],
        range: [0, 400] as [number, number],
        mode: "linear" as const,
      };
      const ticks = PriceAxis.fromVisualRange(scale, 400, 50);

      expect(ticks.length).toBeGreaterThan(0);
      const yPositions = ticks.map((t) => t.y);
      const minY = Math.min(...yPositions);
      const maxY = Math.max(...yPositions);
      expect(maxY - minY).toBeGreaterThan(200);
    });

    it("adapts tick count to target spacing", () => {
      const scale = {
        extent: [0, 100] as [number, number],
        range: [0, 400] as [number, number],
        mode: "linear" as const,
      };
      const denseTicks = PriceAxis.fromVisualRange(scale, 400, 30);
      const sparseTicks = PriceAxis.fromVisualRange(scale, 400, 100);

      expect(denseTicks.length).toBeGreaterThan(sparseTicks.length);
    });

    it("handles zero range", () => {
      const scale = {
        extent: [100, 100] as [number, number],
        range: [0, 400] as [number, number],
        mode: "linear" as const,
      };
      const ticks = PriceAxis.fromVisualRange(scale, 400, 50);

      expect(ticks.length).toBe(1);
      expect(ticks[0]?.value).toBe(100);
    });

    it("generates nice step values", () => {
      const scale = {
        extent: [0, 100] as [number, number],
        range: [0, 400] as [number, number],
        mode: "linear" as const,
      };
      const ticks = PriceAxis.fromVisualRange(scale, 400, 50);

      for (const tick of ticks) {
        const remainder = tick.value % 5;
        expect(remainder === 0 || remainder === 2.5).toBe(true);
      }
    });
  });
});

describe("TimeScale", () => {
  describe("visibleRange", () => {
    it("returns empty range for no data", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      const { range, valid } = TimeScale.visibleRange(state, 0);
      expect(range).toEqual({ from: 0, to: 0 });
      expect(valid).toEqual({ from: 0, to: 0 });
    });

    it("includes all data when fully visible", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // 50 bars * 10px spacing = 500px, fits in 800px width
      const { valid } = TimeScale.visibleRange(state, 50);
      expect(valid.from).toBe(0);
      expect(valid.to).toBe(50);
    });

    it("excludes data scrolled off left edge", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // 100 bars * 10px = 1000px total, but only 800px visible
      // Last bar at right edge (idx 99), first visible should be around idx 20
      const { valid } = TimeScale.visibleRange(state, 100);
      expect(valid.from).toBeGreaterThan(0);
      expect(valid.to).toBe(100);
    });

    it("shifts data left with positive rightOffset (empty space on right)", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 200,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // rightOffset=200 means 200px empty space on right (last bar at x=600)
      // Effective visible width is 800-200=600px, fitting 60 bars
      // idxAtLeftEdge = 99 - 600/10 = 39
      const { valid } = TimeScale.visibleRange(state, 100);
      expect(valid.from).toBe(39);
      expect(valid.to).toBe(100);
    });

    it("handles negative rightOffset (scrolled past end)", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: -100,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // Scrolled left so last data point is off-screen
      const { valid } = TimeScale.visibleRange(state, 50);
      // Should still clamp to valid indices
      expect(valid.from).toBeGreaterThanOrEqual(0);
      expect(valid.to).toBeLessThanOrEqual(50);
    });

    it.each([
      [-2000, { from: 0, to: 0 }],
      [2000, { from: 100, to: 100 }],
    ])(
      "returns an empty intersection outside data at offset %s",
      (rightOffset, valid) => {
        const state = TimeScale.State.parse({
          width: 800,
          barSpacing: 10,
          rightOffset,
        });
        const result = TimeScale.visibleRange(state, 100);
        expect(result.valid).toEqual(valid);
        expect(result.range.to - result.range.from).toBeGreaterThan(0);
        if (rightOffset < 0) expect(result.range.to).toBeLessThan(0);
        else expect(result.range.from).toBeGreaterThan(100);
      },
    );

    it("handles single data point", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      const { valid } = TimeScale.visibleRange(state, 1);
      expect(valid).toEqual({ from: 0, to: 1 });
    });

    it("calculates correct visible indices based on scroll position", () => {
      const state = {
        width: 400,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // 400px width / 10px spacing = 40 bars visible
      // With 100 total bars and rightOffset=0, last bar (99) is at right edge
      // idxAtLeftEdge = 99 - 400/10 = 59, so firstVisible = 59
      const { valid } = TimeScale.visibleRange(state, 100);
      expect(valid.from).toBe(59);
      expect(valid.to).toBe(100);
    });

    it("returns negative raw index when panned past data start", () => {
      const state3 = {
        width: 400,
        barSpacing: 10,
        rightOffset: -200,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // rightOffset=-200 means we've panned left, last bar is 200px past the right edge
      // idxAtLeftEdge = 49 - (400-(-200))/10 = 49 - 60 = -11
      const { range, valid } = TimeScale.visibleRange(state3, 50);

      // Raw range should go negative (we're looking at area before data)
      expect(range.from).toBeLessThan(0);
      // Valid range should be clamped to 0
      expect(valid.from).toBe(0);
    });

    it("raw range can exceed data bounds on the right", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 500,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      // With large rightOffset, we've panned right showing empty space
      // idxAtRightEdge = 49 + 500/10 = 99 (past the 50 items)
      const { range, valid } = TimeScale.visibleRange(state, 50);

      // Raw range.to should exceed data length
      expect(range.to).toBeGreaterThan(50);
      // Valid range should be clamped
      expect(valid.to).toBe(50);
    });

    it("valid range is always within data bounds", () => {
      // Test various scroll positions
      const testCases = [
        { rightOffset: -500, total: 50 }, // Panned far left
        { rightOffset: 0, total: 50 }, // Normal
        { rightOffset: 500, total: 50 }, // Panned far right
        { rightOffset: -1000, total: 100 }, // Way past data start
      ];

      for (const { rightOffset, total } of testCases) {
        const state = {
          width: 800,
          barSpacing: 10,
          rightOffset,
          minBarSpacing: 0.5,
          maxBarSpacing: 50,
          fixLeftEdge: false,
          fixRightEdge: false,
          visible: true,
        };
        const { valid } = TimeScale.visibleRange(state, total);

        expect(valid.from).toBeGreaterThanOrEqual(0);
        expect(valid.to).toBeLessThanOrEqual(total);
      }
    });
  });

  describe("indexToX", () => {
    it("places last index at right edge minus offset", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      const x = TimeScale.indexToX(state, 99, 100);
      expect(x).toBe(800);
    });

    it("respects rightOffset", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 100,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      const x = TimeScale.indexToX(state, 99, 100);
      expect(x).toBe(700);
    });
  });

  describe("xToIndex", () => {
    it("returns last index at right edge", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 0,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      const idx = TimeScale.xToIndex(state, 800, 100);
      expect(idx).toBe(99);
    });

    it("is inverse of indexToX", () => {
      const state = {
        width: 800,
        barSpacing: 10,
        rightOffset: 50,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        fixLeftEdge: false,
        fixRightEdge: false,
        visible: true,
      };
      const originalIdx = 75;
      const x = TimeScale.indexToX(state, originalIdx, 100);
      const recoveredIdx = TimeScale.xToIndex(state, x, 100);
      expect(recoveredIdx).toBe(originalIdx);
    });
  });
});

describe("TimeAxis", () => {
  const mockCtx = {
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    font: "12px sans-serif",
    textAlign: "center",
    textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;

  describe("inferBarInterval", () => {
    it("returns correct interval for 15-minute bars", () => {
      // 15-min = 900 seconds
      const base = 1700000000;
      const times = Array.from({ length: 100 }, (_, i) => base + i * 900);
      const result = TimeAxis.inferBarInterval(times, { from: 0, to: 100 });
      expect(result).toBe(900);
    });

    it("returns correct interval for 50-minute bars", () => {
      // 50-min = 3000 seconds
      const base = 1700000000;
      const times = Array.from({ length: 100 }, (_, i) => base + i * 3000);
      const result = TimeAxis.inferBarInterval(times, { from: 0, to: 100 });
      expect(result).toBe(3000);
    });

    it("ignores overnight gaps for market data", () => {
      // 15-min bars with overnight gap: 26 bars (6.5h session), then gap, then 26 more
      const base = 1700000000;
      const times: number[] = [];
      for (let i = 0; i < 26; i++) times.push(base + i * 900); // day 1
      for (let i = 0; i < 26; i++) times.push(base + 86400 + i * 900); // day 2 (next day)
      const result = TimeAxis.inferBarInterval(times, {
        from: 0,
        to: times.length,
      });
      expect(result).toBe(900); // should be 900, not the overnight gap
    });

    it("returns null for empty or single-element range", () => {
      expect(TimeAxis.inferBarInterval([], { from: 0, to: 0 })).toBeNull();
      expect(
        TimeAxis.inferBarInterval([1700000000], { from: 0, to: 1 }),
      ).toBeNull();
    });

    it("only scans first 50 bars", () => {
      const base = 1700000000;
      // First 50 bars at 900s intervals, then switch to 60s — should still return 900
      const times: number[] = [];
      for (let i = 0; i < 50; i++) times.push(base + i * 900);
      for (let i = 0; i < 50; i++) times.push(base + 50 * 900 + i * 60);
      const result = TimeAxis.inferBarInterval(times, { from: 0, to: 100 });
      expect(result).toBe(900);
    });
  });

  describe("barIntervalToUnit", () => {
    it("maps sub-minute to second", () => {
      expect(TimeAxis.barIntervalToUnit(30)).toBe("second");
      expect(TimeAxis.barIntervalToUnit(1)).toBe("second");
    });

    it("maps 1m to 50m to minute", () => {
      expect(TimeAxis.barIntervalToUnit(60)).toBe("minute");
      expect(TimeAxis.barIntervalToUnit(300)).toBe("minute"); // 5m
      expect(TimeAxis.barIntervalToUnit(900)).toBe("minute"); // 15m
      expect(TimeAxis.barIntervalToUnit(3000)).toBe("minute"); // 50m
    });

    it("maps 1h and 4h to hour", () => {
      expect(TimeAxis.barIntervalToUnit(3600)).toBe("hour");
      expect(TimeAxis.barIntervalToUnit(14400)).toBe("hour"); // 4h
    });

    it("maps daily to day", () => {
      expect(TimeAxis.barIntervalToUnit(86400)).toBe("day");
      expect(TimeAxis.barIntervalToUnit(23 * 3600)).toBe("day");
      expect(TimeAxis.barIntervalToUnit(25 * 3600)).toBe("day");
    });

    it("maps weekly to week", () => {
      expect(TimeAxis.barIntervalToUnit(604800)).toBe("week");
      expect(TimeAxis.barIntervalToUnit(167 * 3600)).toBe("week");
      expect(TimeAxis.barIntervalToUnit(169 * 3600)).toBe("week");
    });

    it("maps monthly to month (including February)", () => {
      expect(TimeAxis.barIntervalToUnit(2592000)).toBe("month"); // 30-day month
      expect(TimeAxis.barIntervalToUnit(2419200)).toBe("month"); // 28-day Feb
      expect(TimeAxis.barIntervalToUnit(2505600)).toBe("month"); // 29-day Feb
    });
  });

  describe("formatCrosshair", () => {
    it("shows date + time for minute unit", () => {
      // 2025-02-15 14:30:00 UTC
      const time = Date.UTC(2025, 1, 15, 14, 30, 0) / 1000;
      expect(TimeAxis.formatCrosshair(time, "minute", "UTC")).toBe(
        "2025-02-15 14:30",
      );
    });

    it("shows date + time + seconds for second unit", () => {
      const time = Date.UTC(2025, 1, 15, 14, 30, 45) / 1000;
      expect(TimeAxis.formatCrosshair(time, "second", "UTC")).toBe(
        "2025-02-15 14:30:45",
      );
    });

    it("shows date only for day unit", () => {
      const time = Date.UTC(2025, 1, 15) / 1000;
      expect(TimeAxis.formatCrosshair(time, "day", "UTC")).toBe("2025-02-15");
    });

    it("shows year-month only for month unit", () => {
      const time = Date.UTC(2025, 1, 1) / 1000;
      expect(TimeAxis.formatCrosshair(time, "month", "UTC")).toBe("2025-02");
    });

    it("shows year only for year unit", () => {
      const time = Date.UTC(2025, 0, 1) / 1000;
      expect(TimeAxis.formatCrosshair(time, "year", "UTC")).toBe("2025");
    });

    it("passes through strings", () => {
      expect(TimeAxis.formatCrosshair("custom", "day", "UTC")).toBe("custom");
    });

    it("formats a US daily period in its canonical New York date", () => {
      const time = Date.parse("2026-06-24T04:00:00Z") / 1000;

      expect(TimeAxis.formatCrosshair(time, "day", "America/New_York")).toBe(
        "2026-06-24",
      );
      expect(TimeAxis.formatCrosshair(time, "day", "America/Los_Angeles")).toBe(
        "2026-06-23",
      );
    });

    it("formats named IANA timezones across the UTC date boundary", () => {
      const time = Date.parse("2025-12-31T15:00:00Z") / 1000;

      expect(TimeAxis.formatCrosshair(time, "day", "Asia/Tokyo")).toBe(
        "2026-01-01",
      );
    });

    it("honors daylight-saving offsets in named IANA timezones", () => {
      const winter = Date.parse("2026-01-15T14:30:00Z") / 1000;
      const summer = Date.parse("2026-06-15T13:30:00Z") / 1000;

      expect(
        TimeAxis.formatCrosshair(winter, "minute", "America/New_York"),
      ).toBe("2026-01-15 09:30");
      expect(
        TimeAxis.formatCrosshair(summer, "minute", "America/New_York"),
      ).toBe("2026-06-15 09:30");
    });
  });

  describe("generateMarks", () => {
    it("generates marks for visible range", () => {
      const times = [1000, 2000, 3000, 4000, 5000];
      const xPositions = [0, 100, 200, 300, 400];
      const range = { from: 0, to: 5 };

      const marks = TimeAxis.generateMarks(times, xPositions, range, 800);

      expect(marks.length).toBeGreaterThan(0);
    });

    it("respects minimum label spacing — no labels overlap", () => {
      const times = Array.from({ length: 100 }, (_, i) => i * 86400);
      const xPositions = Array.from({ length: 100 }, (_, i) => i * 8);
      const range = { from: 0, to: 100 };

      const marks = TimeAxis.generateMarks(times, xPositions, range, 800);

      // No two consecutive labels should have overlapping bounding boxes
      for (let i = 1; i < marks.length; i++) {
        const prev = marks[i - 1]!;
        const curr = marks[i]!;
        const prevRight = prev.x + TimeAxis.estimateLabelWidth(prev.label) / 2;
        const currLeft = curr.x - TimeAxis.estimateLabelWidth(curr.label) / 2;
        expect(currLeft).toBeGreaterThanOrEqual(prevRight);
      }
    });

    it("returns empty array for empty range", () => {
      const marks = TimeAxis.generateMarks([], [], { from: 0, to: 0 }, 800);
      expect(marks).toHaveLength(0);
    });

    it("adapts to chart width", () => {
      const times = Array.from({ length: 50 }, (_, i) => i * 86400);
      const xPositions = Array.from({ length: 50 }, (_, i) => i * 20);
      const range = { from: 0, to: 50 };

      const wideMarks = TimeAxis.generateMarks(times, xPositions, range, 1000);
      const narrowMarks = TimeAxis.generateMarks(times, xPositions, range, 400);

      expect(wideMarks.length).toBeGreaterThanOrEqual(narrowMarks.length);
    });

    it("routes 15-min bars to intraday branch even when spanning 2 days", () => {
      // 15-min bars across 2 trading days (~192 bars)
      const base = 1700000000; // some epoch
      const times: number[] = [];
      for (let i = 0; i < 192; i++) times.push(base + i * 900);
      const xPositions = Array.from({ length: times.length }, (_, i) => i * 5);
      const range = { from: 0, to: times.length };

      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        range,
        1000,
        "UTC",
      );

      // Should produce HH:MM-style labels (intraday), not just day numbers
      const timeLabels = marks.filter((m) => m.weight === 0);
      expect(timeLabels.length).toBeGreaterThan(3);
      // Should have at least one day boundary marker
      const boundaryLabels = marks.filter((m) => m.weight === 1);
      expect(boundaryLabels.length).toBeGreaterThan(0);
    });

    it("routes 50-min bars to intraday branch even when spanning months", () => {
      // 50-min bars across ~90 days (~2592 bars in market hours)
      const base = 1700000000;
      const times: number[] = [];
      for (let i = 0; i < 2000; i++) times.push(base + i * 3000);
      const xPositions = Array.from(
        { length: times.length },
        (_, i) => i * 0.5,
      );
      const range = { from: 0, to: times.length };

      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        range,
        1000,
        "UTC",
      );

      // Should produce intraday labels, not month labels
      expect(marks.length).toBeGreaterThan(2);
    });

    it("routes weekly bars to periodic branch with month-name labels", () => {
      const base = 1700000000;
      const times = Array.from({ length: 104 }, (_, i) => base + i * 604800);
      const xPositions = Array.from({ length: 104 }, (_, i) => i * 10);
      const range = { from: 0, to: 104 };
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        range,
        1000,
        "UTC",
      );
      // Regular labels should be month names, not day numbers
      const regularLabels = marks.filter((m) => m.weight === 0);
      for (const m of regularLabels) {
        expect(m.label).toMatch(/^[A-Z][a-z]{2}$/);
      }
      // Should have year boundaries (weight 2)
      const yearLabels = marks.filter((m) => m.weight === 2);
      expect(yearLabels.length).toBeGreaterThan(0);
    });

    it("still routes daily bars to day/week branch", () => {
      // Daily bars across 60 days
      const base = 1700000000;
      const times = Array.from({ length: 60 }, (_, i) => base + i * 86400);
      const xPositions = Array.from({ length: 60 }, (_, i) => i * 15);
      const range = { from: 0, to: 60 };

      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        range,
        1000,
        "UTC",
      );

      // Day labels should be numeric day-of-month (day/week branch)
      const dayLabels = marks.filter((m) => m.weight === 0);
      for (const m of dayLabels) {
        expect(m.label).toMatch(/^\d+$/); // just day number like "15"
      }
    });

    it("generates daily marks from the canonical calendar timezone", () => {
      const times = [
        Date.parse("2026-06-24T04:00:00Z") / 1000,
        Date.parse("2026-06-25T04:00:00Z") / 1000,
      ];
      const marks = TimeAxis.generateMarks(
        times,
        [100, 300],
        { from: 0, to: 2 },
        500,
        "America/New_York",
      );

      expect(marks.map((mark) => mark.label)).toEqual(["24", "25"]);
    });

    it("keeps daily mark routing across a New York DST transition", () => {
      const times = [
        Date.parse("2026-03-07T05:00:00Z") / 1000,
        Date.parse("2026-03-08T05:00:00Z") / 1000,
        Date.parse("2026-03-09T04:00:00Z") / 1000,
      ];
      const marks = TimeAxis.generateMarks(
        times,
        [100, 300, 500],
        { from: 0, to: 3 },
        700,
        "America/New_York",
      );

      expect(marks.map((mark) => mark.label)).toEqual(["7", "8", "9"]);
    });

    it("still routes monthly bars to month/year branch", () => {
      // Monthly bars using date objects
      const times = Array.from({ length: 36 }, (_, i) => {
        const year = 2020 + Math.floor(i / 12);
        const month = (i % 12) + 1;
        return Date.UTC(year, month - 1, 1) / 1000;
      });
      const xPositions = Array.from({ length: 36 }, (_, i) => i * 30);
      const range = { from: 0, to: 36 };

      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        range,
        1000,
        "UTC",
      );

      // Should have year boundary labels (weight 2)
      const yearLabels = marks.filter((m) => m.weight === 2);
      expect(yearLabels.length).toBeGreaterThan(0);
      for (const yl of yearLabels) {
        expect(yl.label).toMatch(/^\d{4}$/); // year like "2021"
      }
    });
  });

  describe("cullOverlaps", () => {
    it("removes regular marks that overlap", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 50, label: "Jan", weight: 0 },
        { index: 1, x: 60, label: "Feb", weight: 0 }, // overlaps Jan
        { index: 2, x: 200, label: "Mar", weight: 0 },
      ];
      const result = TimeAxis.cullOverlaps(marks);
      expect(result.map((m) => m.label)).toEqual(["Jan", "Mar"]);
    });

    it("bold marks evict previous regular marks when too close", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 50, label: "Dec", weight: 0 },
        { index: 1, x: 70, label: "2024", weight: 1 }, // bold, too close to Dec
      ];
      const result = TimeAxis.cullOverlaps(marks);
      // Dec should be evicted, 2024 should remain
      expect(result.map((m) => m.label)).toEqual(["2024"]);
    });

    it("keeps all marks when sufficiently spaced", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 50, label: "Jan", weight: 0 },
        { index: 1, x: 200, label: "Apr", weight: 0 },
        { index: 2, x: 350, label: "Jul", weight: 0 },
      ];
      const result = TimeAxis.cullOverlaps(marks);
      expect(result).toHaveLength(3);
    });

    it("returns empty array for empty input", () => {
      expect(TimeAxis.cullOverlaps([])).toEqual([]);
    });

    it("returns single mark unchanged", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 100, label: "Jan", weight: 0 },
      ];
      expect(TimeAxis.cullOverlaps(marks)).toHaveLength(1);
    });

    it("year mark (weight 2) evicts month mark (weight 1) when overlapping", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 50, label: "Dec", weight: 1 },
        { index: 1, x: 70, label: "2024", weight: 2 }, // year, higher weight
      ];
      const result = TimeAxis.cullOverlaps(marks);
      expect(result.map((m) => m.label)).toEqual(["2024"]);
    });

    it("same-weight marks do not evict each other", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 50, label: "Nov", weight: 1 },
        { index: 1, x: 70, label: "Dec", weight: 1 }, // same weight, overlaps
      ];
      const result = TimeAxis.cullOverlaps(marks);
      // Dec cannot evict Nov — only Nov survives
      expect(result.map((m) => m.label)).toEqual(["Nov"]);
    });

    it("weight hierarchy cascades: year > month > regular", () => {
      const marks: TimeAxis.TickMark[] = [
        { index: 0, x: 50, label: "15", weight: 0 }, // day
        { index: 1, x: 65, label: "Dec", weight: 1 }, // month, evicts day
        { index: 2, x: 80, label: "2024", weight: 2 }, // year, evicts month
      ];
      const result = TimeAxis.cullOverlaps(marks);
      expect(result.map((m) => m.label)).toEqual(["2024"]);
    });
  });

  describe("no overlap guarantee across zoom levels", () => {
    function assertNoOverlap(marks: TimeAxis.TickMark[]) {
      for (let i = 1; i < marks.length; i++) {
        const prev = marks[i - 1]!;
        const curr = marks[i]!;
        const prevRight = prev.x + TimeAxis.estimateLabelWidth(prev.label) / 2;
        const currLeft = curr.x - TimeAxis.estimateLabelWidth(curr.label) / 2;
        expect(currLeft).toBeGreaterThanOrEqual(
          prevRight,
          `"${prev.label}" at x=${prev.x} overlaps "${curr.label}" at x=${curr.x}`,
        );
      }
    }

    it("monthly bars, zoomed out — 3 years in 1000px", () => {
      const times = Array.from({ length: 36 }, (_, i) => {
        const year = 2022 + Math.floor(i / 12);
        const month = (i % 12) + 1;
        return Date.UTC(year, month - 1, 1) / 1000;
      });
      const xPositions = Array.from({ length: 36 }, (_, i) => i * (1000 / 36));
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: 36 },
        1000,
        "UTC",
      );
      assertNoOverlap(marks);
      expect(marks.length).toBeGreaterThan(0);
    });

    it("weekly bars, zoomed out — 3 years (156 weeks) in 1000px", () => {
      const base = Date.UTC(2022, 0, 3) / 1000; // Mon Jan 3 2022
      const times = Array.from({ length: 156 }, (_, i) => base + i * 604800);
      const xPositions = Array.from(
        { length: 156 },
        (_, i) => i * (1000 / 156),
      );
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: 156 },
        1000,
        "UTC",
      );
      assertNoOverlap(marks);
      expect(marks.length).toBeGreaterThan(0);
    });

    it("daily bars, extreme zoom-out — 3 years (~750 days) in 1200px", () => {
      const base = Date.UTC(2022, 0, 1) / 1000;
      const count = 750;
      const times = Array.from({ length: count }, (_, i) => base + i * 86400);
      const xPositions = Array.from(
        { length: count },
        (_, i) => i * (1200 / count),
      );
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: count },
        1200,
        "UTC",
      );
      assertNoOverlap(marks);
      expect(marks.length).toBeGreaterThan(0);
    });

    it("daily bars, narrow chart — 60 days in 300px", () => {
      const base = Date.UTC(2025, 0, 1) / 1000;
      const times = Array.from({ length: 60 }, (_, i) => base + i * 86400);
      const xPositions = Array.from({ length: 60 }, (_, i) => i * 5);
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: 60 },
        300,
        "UTC",
      );
      assertNoOverlap(marks);
    });

    it("intraday 1-min bars, full day in 1000px", () => {
      const base = Date.UTC(2025, 1, 15, 9, 30) / 1000;
      const count = 390; // 6.5 hours of 1-min bars
      const times = Array.from({ length: count }, (_, i) => base + i * 60);
      const xPositions = Array.from(
        { length: count },
        (_, i) => i * (1000 / count),
      );
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: count },
        1000,
        "UTC",
      );
      assertNoOverlap(marks);
    });

    it("daily bars, ~6 years in 1500px — year marks always present, no stray day numbers", () => {
      // The user's exact scenario: daily resolution zoomed out to ~6 years
      const base = Date.UTC(2020, 0, 1) / 1000;
      const count = 2200; // ~6 years of daily bars
      const times = Array.from({ length: count }, (_, i) => base + i * 86400);
      const xPositions = Array.from(
        { length: count },
        (_, i) => i * (1500 / count),
      );
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: count },
        1500,
        "UTC",
      );

      assertNoOverlap(marks);

      // Must have year marks (weight 2)
      const yearMarks = marks.filter((m) => m.weight === 2);
      expect(yearMarks.length).toBeGreaterThanOrEqual(3);
      for (const ym of yearMarks) {
        expect(ym.label).toMatch(/^\d{4}$/);
      }

      // No stray day-of-month numbers (weight 0 day labels should be suppressed)
      const dayMarks = marks.filter(
        (m) => m.weight === 0 && /^\d{1,2}$/.test(m.label),
      );
      expect(dayMarks).toHaveLength(0);
    });

    it("daily bars, ~10 years in 1500px — only year marks survive", () => {
      const base = Date.UTC(2016, 0, 1) / 1000;
      const count = 3650; // ~10 years
      const times = Array.from({ length: count }, (_, i) => base + i * 86400);
      const xPositions = Array.from(
        { length: count },
        (_, i) => i * (1500 / count),
      );
      const marks = TimeAxis.generateMarks(
        times,
        xPositions,
        { from: 0, to: count },
        1500,
        "UTC",
      );

      assertNoOverlap(marks);

      // All surviving marks should be years (weight 2) or months (weight 1)
      // No day-of-month labels at this density
      const dayLabels = marks.filter((m) => /^\d{1,2}$/.test(m.label));
      expect(dayLabels).toHaveLength(0);

      // Should have year marks
      const yearMarks = marks.filter((m) => m.weight === 2);
      expect(yearMarks.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("pan stability — label strategy does not flip-flop", () => {
    // Helper: classify mark as "year" (bold 4-digit), "month" (3-letter), or "other"
    function labelKind(m: TimeAxis.TickMark): string {
      if (/^\d{4}$/.test(m.label)) return "year";
      if (/^[A-Z][a-z]{2}$/.test(m.label)) return "month";
      if (/^\d{1,2}$/.test(m.label)) return "day";
      return "other";
    }

    function kindSet(marks: TimeAxis.TickMark[]): Set<string> {
      return new Set(marks.map(labelKind));
    }

    it("monthly bars — panning by one month keeps the same label kinds", () => {
      // 48 monthly bars, pan window: 24 months at a time, shift by 1
      const allTimes = Array.from({ length: 48 }, (_, i) => {
        const year = 2022 + Math.floor(i / 12);
        const month = (i % 12) + 1;
        return Date.UTC(year, month - 1, 1) / 1000;
      });
      const windowSize = 24;
      const allXPositions = Array.from(
        { length: 48 },
        (_, i) => i * (1000 / windowSize),
      );

      const baseMarks = TimeAxis.generateMarks(
        allTimes,
        allXPositions,
        { from: 0, to: windowSize },
        1000,
        "UTC",
      );
      const baseKinds = kindSet(baseMarks);

      // Pan forward by 1 month at a time for 12 steps — label kinds should stay the same
      for (let offset = 1; offset <= 12; offset++) {
        const shiftedX = allXPositions.map(
          (x) => x - offset * (1000 / windowSize),
        );
        const marks = TimeAxis.generateMarks(
          allTimes,
          shiftedX,
          { from: offset, to: offset + windowSize },
          1000,
          "UTC",
        );
        const kinds = kindSet(marks);
        expect(kinds).toEqual(
          baseKinds,
          `Label strategy changed after panning ${offset} months: ${[...kinds]} vs ${[...baseKinds]}`,
        );
      }
    });

    it("daily bars — panning by one day keeps the same label kinds", () => {
      const base = Date.UTC(2024, 0, 1) / 1000;
      const totalDays = 120;
      const windowSize = 60;
      const allTimes = Array.from(
        { length: totalDays },
        (_, i) => base + i * 86400,
      );
      const allXPositions = Array.from(
        { length: totalDays },
        (_, i) => i * (1000 / windowSize),
      );

      const baseMarks = TimeAxis.generateMarks(
        allTimes,
        allXPositions,
        { from: 0, to: windowSize },
        1000,
        "UTC",
      );
      const baseKinds = kindSet(baseMarks);

      for (let offset = 1; offset <= 30; offset++) {
        const shiftedX = allXPositions.map(
          (x) => x - offset * (1000 / windowSize),
        );
        const marks = TimeAxis.generateMarks(
          allTimes,
          shiftedX,
          { from: offset, to: offset + windowSize },
          1000,
          "UTC",
        );
        const kinds = kindSet(marks);
        expect(kinds).toEqual(
          baseKinds,
          `Label strategy changed after panning ${offset} days: ${[...kinds]} vs ${[...baseKinds]}`,
        );
      }
    });

    it("weekly bars — panning by one week keeps the same label kinds", () => {
      const base = Date.UTC(2022, 0, 3) / 1000; // Mon Jan 3 2022
      const totalWeeks = 200;
      const windowSize = 104;
      const allTimes = Array.from(
        { length: totalWeeks },
        (_, i) => base + i * 604800,
      );
      const allXPositions = Array.from(
        { length: totalWeeks },
        (_, i) => i * (1000 / windowSize),
      );

      const baseMarks = TimeAxis.generateMarks(
        allTimes,
        allXPositions,
        { from: 0, to: windowSize },
        1000,
        "UTC",
      );
      const baseKinds = kindSet(baseMarks);

      for (let offset = 1; offset <= 26; offset++) {
        const shiftedX = allXPositions.map(
          (x) => x - offset * (1000 / windowSize),
        );
        const marks = TimeAxis.generateMarks(
          allTimes,
          shiftedX,
          { from: offset, to: offset + windowSize },
          1000,
          "UTC",
        );
        const kinds = kindSet(marks);
        expect(kinds).toEqual(
          baseKinds,
          `Label strategy changed after panning ${offset} weeks: ${[...kinds]} vs ${[...baseKinds]}`,
        );
      }
    });
  });

  describe("render", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders time labels", () => {
      const ticks: TimeAxis.TickMark[] = [
        { index: 0, x: 100, label: "Jan 15", weight: 1 },
        { index: 1, x: 200, label: "Jan 16", weight: 1 },
      ];

      TimeAxis.render(
        mockCtx,
        ticks,
        {
          height: 30,
          visible: true,
          textColor: "#191919",
          font: "12px sans-serif",
        },
        { x: 0, y: 400, width: 800, height: 30 },
      );

      expect(mockCtx.fillText).toHaveBeenCalled();
    });

    it("skips rendering when not visible", () => {
      const ticks: TimeAxis.TickMark[] = [
        { index: 0, x: 100, label: "Jan 15", weight: 1 },
      ];

      TimeAxis.render(
        mockCtx,
        ticks,
        {
          height: 30,
          visible: false,
          textColor: "#191919",
          font: "12px sans-serif",
        },
        { x: 0, y: 400, width: 800, height: 30 },
      );

      expect(mockCtx.fillText).not.toHaveBeenCalled();
    });
  });
});
