// Purpose: Tests for Resolution namespace (toSeconds, getBarStart, isNewPeriod, getBarEnd)
// Module:  @openchart/chart-core / tests/unit

import { describe, it, expect } from "vitest";
import { Resolution } from "@openchart/chart-core/live/resolution";

describe("Resolution", () => {
  describe("toSeconds", () => {
    it("parses second resolutions", () => {
      expect(Resolution.toSeconds("1s")).toBe(1);
    });

    it("parses minute resolutions", () => {
      expect(Resolution.toSeconds("1m")).toBe(60);
      expect(Resolution.toSeconds("5m")).toBe(300);
      expect(Resolution.toSeconds("15m")).toBe(900);
      expect(Resolution.toSeconds("30m")).toBe(1800);
    });

    it("parses hourly resolutions", () => {
      expect(Resolution.toSeconds("1h")).toBe(3600);
      expect(Resolution.toSeconds("4h")).toBe(14400);
    });

    it("parses daily resolutions", () => {
      expect(Resolution.toSeconds("1d")).toBe(86400);
    });

    it("parses weekly resolutions", () => {
      expect(Resolution.toSeconds("1W")).toBe(604800);
    });

    it("parses monthly resolutions", () => {
      expect(Resolution.toSeconds("1M")).toBe(2592000);
    });

    it("rejects unsupported resolutions instead of silently defaulting", () => {
      expect(() => Resolution.toSeconds("invalid")).toThrow(
        "unsupported bar cadence invalid",
      );
      expect(() => Resolution.toSeconds("1w")).toThrow(
        "unsupported bar cadence 1w",
      );
      expect(() => Resolution.toSeconds("")).toThrow("unsupported bar cadence");
      expect(() => Resolution.toSeconds("tick")).toThrow(
        "unsupported bar cadence tick",
      );
    });
  });

  describe("getBarStart", () => {
    it("floors to minute boundary for 1m", () => {
      // 2024-01-15 10:30:45 UTC -> 10:30:00
      const time = 1705315845; // 10:30:45
      const barStart = Resolution.getBarStart(time, "1m");
      expect(barStart).toBe(1705315800); // 10:30:00
    });

    it("floors to 5-minute boundary for 5m", () => {
      // 2024-01-15 10:33:45 UTC -> 10:30:00
      const time = 1705316025; // 10:33:45
      const barStart = Resolution.getBarStart(time, "5m");
      expect(barStart).toBe(1705315800); // 10:30:00
    });

    it("floors to hour boundary for 1h", () => {
      // 2024-01-15 10:33:45 UTC -> 10:00:00
      const time = 1705316025; // 10:33:45
      const barStart = Resolution.getBarStart(time, "1h");
      expect(barStart).toBe(1705312800); // 10:00:00
    });

    it("floors to 4-hour boundary for 4h", () => {
      // 2024-01-15 10:33:45 UTC -> 08:00:00
      const time = 1705316025; // 10:33:45
      const barStart = Resolution.getBarStart(time, "4h");
      expect(barStart).toBe(1705305600); // 08:00:00
    });

    it("floors to day boundary for 1d", () => {
      // 2024-01-15 10:33:45 UTC -> 2024-01-15 00:00:00
      const time = 1705316025; // 10:33:45
      const barStart = Resolution.getBarStart(time, "1d");
      expect(barStart).toBe(1705276800); // 2024-01-15 00:00:00 UTC
    });

    it("floors to week boundary for 1W (Monday)", () => {
      // 2024-01-17 (Wednesday) -> 2024-01-15 (Monday)
      const time = 1705500000; // Wednesday 2024-01-17
      const barStart = Resolution.getBarStart(time, "1W");
      // Should floor to Monday 2024-01-15 00:00:00 UTC
      expect(barStart).toBe(1705276800);
    });

    it("floors to month boundary for 1M", () => {
      // 2024-01-15 10:33:45 UTC -> 2024-01-01 00:00:00
      const time = 1705316025;
      const barStart = Resolution.getBarStart(time, "1M");
      expect(barStart).toBe(1704067200); // 2024-01-01 00:00:00 UTC
    });
  });

  describe("isNewPeriod", () => {
    it("returns true when crossing minute boundary", () => {
      const prevTime = 1705315859; // 10:30:59
      const newTime = 1705315860; // 10:31:00
      expect(Resolution.isNewPeriod(prevTime, newTime, "1m")).toBe(true);
    });

    it("returns false within same minute", () => {
      const prevTime = 1705315800; // 10:30:00
      const newTime = 1705315830; // 10:30:30
      expect(Resolution.isNewPeriod(prevTime, newTime, "1m")).toBe(false);
    });

    it("returns true when crossing hour boundary", () => {
      const prevTime = 1705316399; // 10:59:59
      const newTime = 1705316400; // 11:00:00
      expect(Resolution.isNewPeriod(prevTime, newTime, "1h")).toBe(true);
    });

    it("returns false within same hour", () => {
      const prevTime = 1705312800; // 10:00:00
      const newTime = 1705316399; // 10:59:59
      expect(Resolution.isNewPeriod(prevTime, newTime, "1h")).toBe(false);
    });

    it("returns true when crossing day boundary", () => {
      const prevTime = 1705363199; // 2024-01-15 23:59:59 UTC
      const newTime = 1705363200; // 2024-01-16 00:00:00 UTC
      expect(Resolution.isNewPeriod(prevTime, newTime, "1d")).toBe(true);
    });

    it("returns false within same day", () => {
      const prevTime = 1705276800; // 2024-01-15 00:00:00 UTC
      const newTime = 1705363199; // 2024-01-15 23:59:59 UTC
      expect(Resolution.isNewPeriod(prevTime, newTime, "1d")).toBe(false);
    });
  });

  describe("getBarEnd", () => {
    it("returns start + resolution for minute bars", () => {
      const barStart = 1705315800; // 10:30:00
      const barEnd = Resolution.getBarEnd(barStart, "1m");
      expect(barEnd).toBe(1705315860); // 10:31:00
    });

    it("returns start + resolution for hourly bars", () => {
      const barStart = 1705312800; // 10:00:00
      const barEnd = Resolution.getBarEnd(barStart, "1h");
      expect(barEnd).toBe(1705316400); // 11:00:00
    });

    it("returns start + resolution for daily bars", () => {
      const barStart = 1705276800; // 2024-01-15 00:00:00 UTC
      const barEnd = Resolution.getBarEnd(barStart, "1d");
      expect(barEnd).toBe(1705363200); // 2024-01-16 00:00:00 UTC
    });
  });
});
