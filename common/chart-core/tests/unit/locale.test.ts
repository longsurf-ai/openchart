import { describe, it, expect, beforeEach } from "vitest";
import { Locale } from "@openchart/chart-core/format";

describe("Locale", () => {
  beforeEach(() => {
    // Reset to default locale with all options cleared
    Locale.set({
      locale: "en-US",
      priceFormatter: undefined,
      dateFormat: undefined,
    });
  });

  describe("set and get", () => {
    it("sets locale options", () => {
      Locale.set({ locale: "de-DE" });
      const opts = Locale.get();
      expect(opts.locale).toBe("de-DE");
    });

    it("preserves other options when setting", () => {
      Locale.set({ locale: "en-US", dateFormat: "custom" });
      Locale.set({ locale: "fr-FR" });
      const opts = Locale.get();
      expect(opts.dateFormat).toBe("custom");
    });
  });

  describe("price", () => {
    it("formats price with default precision", () => {
      const result = Locale.price(1234.567);
      expect(result).toBe("1,234.57");
    });

    it("formats price with custom precision", () => {
      const result = Locale.price(1234.5, 4);
      expect(result).toBe("1,234.5000");
    });

    it("handles large numbers", () => {
      const result = Locale.price(1234567.89);
      expect(result).toContain("1,234,567.89");
    });

    it("uses custom formatter if provided", () => {
      Locale.set({ priceFormatter: (v: number) => `$${v.toFixed(0)}` });
      const result = Locale.price(100.5);
      expect(result).toBe("$101");
    });
  });

  describe("percent", () => {
    it("formats positive percent with plus sign", () => {
      const result = Locale.percent(5.25);
      expect(result).toBe("+5.25%");
    });

    it("formats negative percent", () => {
      const result = Locale.percent(-3.5);
      expect(result).toBe("-3.50%");
    });

    it("formats with custom precision", () => {
      const result = Locale.percent(12.345, 1);
      expect(result).toBe("+12.3%");
    });
  });

  describe("volume", () => {
    it("formats millions", () => {
      const result = Locale.volume(1500000);
      expect(result).toBe("1.5M");
    });

    it("formats billions", () => {
      const result = Locale.volume(2500000000);
      expect(result).toBe("2.5B");
    });

    it("formats thousands", () => {
      const result = Locale.volume(5500);
      expect(result).toBe("5.5K");
    });

    it("formats small numbers", () => {
      const result = Locale.volume(123);
      expect(result).toBe("123");
    });
  });

  describe("date", () => {
    it("formats date from Date object", () => {
      const date = new Date(2025, 0, 15);
      const result = Locale.date(date);
      expect(result).toContain("Jan");
      expect(result).toContain("15");
      expect(result).toContain("2025");
    });

    it("formats date from timestamp", () => {
      const ts = new Date(2025, 0, 15).getTime() / 1000;
      const result = Locale.date(ts);
      expect(result).toContain("2025");
    });
  });

  describe("time", () => {
    it("formats time from Date object", () => {
      const date = new Date(2025, 0, 15, 14, 30, 45);
      const result = Locale.time(date);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("datetime", () => {
    it("formats datetime", () => {
      const date = new Date(2025, 0, 15, 14, 30);
      const result = Locale.datetime(date);
      expect(result).toContain("Jan");
      expect(result).toContain("15");
      expect(result).toContain("2025");
    });
  });

  describe("different locales", () => {
    it("formats German style", () => {
      Locale.set({ locale: "de-DE" });
      const result = Locale.price(1234.56);
      // German uses comma for decimal and period for thousands
      expect(result).toMatch(/1\.234,56|1.234,56/);
    });

    it("formats Japanese dates", () => {
      Locale.set({ locale: "ja-JP" });
      const date = new Date(2025, 0, 15);
      const result = Locale.date(date);
      expect(result).toContain("2025");
    });
  });
});
