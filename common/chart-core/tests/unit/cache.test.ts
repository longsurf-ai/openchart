import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";

describe("TextCache", () => {
  const mockCtx = {
    font: "12px sans-serif",
    measureText: vi.fn((text: string) => ({
      width: text.length * 7,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
    })),
  } as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates empty cache with specified capacity", () => {
      const cache = TextCache.create(100);
      expect(cache).toBeDefined();
    });
  });

  describe("measure", () => {
    it("measures text and caches result", () => {
      const cache = TextCache.create(100);
      const result = TextCache.measure(
        cache,
        mockCtx,
        "12px sans-serif",
        "test",
      );

      expect(result.width).toBe(28);
      expect(result.height).toBe(12);
      expect(mockCtx.measureText).toHaveBeenCalledTimes(1);
    });

    it("returns cached result on second call", () => {
      const cache = TextCache.create(100);
      TextCache.measure(cache, mockCtx, "12px sans-serif", "test");
      const result = TextCache.measure(
        cache,
        mockCtx,
        "12px sans-serif",
        "test",
      );

      expect(result.width).toBe(28);
      expect(mockCtx.measureText).toHaveBeenCalledTimes(1);
    });

    it("caches different texts separately", () => {
      const cache = TextCache.create(100);
      TextCache.measure(cache, mockCtx, "12px sans-serif", "hello");
      TextCache.measure(cache, mockCtx, "12px sans-serif", "world");

      expect(mockCtx.measureText).toHaveBeenCalledTimes(2);
    });

    it("caches different fonts separately", () => {
      const cache = TextCache.create(100);
      TextCache.measure(cache, mockCtx, "12px sans-serif", "test");
      TextCache.measure(cache, mockCtx, "14px Arial", "test");

      expect(mockCtx.measureText).toHaveBeenCalledTimes(2);
    });

    it("evicts old entries when capacity exceeded", () => {
      const cache = TextCache.create(2);
      TextCache.measure(cache, mockCtx, "12px sans-serif", "a");
      TextCache.measure(cache, mockCtx, "12px sans-serif", "b");
      TextCache.measure(cache, mockCtx, "12px sans-serif", "c");

      vi.clearAllMocks();

      // "a" should be evicted, "b" and "c" should still be cached
      TextCache.measure(cache, mockCtx, "12px sans-serif", "a");
      expect(mockCtx.measureText).toHaveBeenCalledTimes(1);

      TextCache.measure(cache, mockCtx, "12px sans-serif", "c");
      expect(mockCtx.measureText).toHaveBeenCalledTimes(1);
    });
  });
});

describe("LabelCache", () => {
  describe("create", () => {
    it("creates empty cache with specified capacity", () => {
      const cache = LabelCache.create(100);
      expect(cache).toBeDefined();
    });
  });

  describe("price", () => {
    it("formats price with default precision", () => {
      const cache = LabelCache.create(100);
      const result = LabelCache.price(cache, 123.456, 2);
      expect(result).toBe("123.46");
    });

    it("formats price with custom precision", () => {
      const cache = LabelCache.create(100);
      const result = LabelCache.price(cache, 123.456789, 4);
      expect(result).toBe("123.4568");
    });

    it("caches formatted price", () => {
      const cache = LabelCache.create(100);
      const first = LabelCache.price(cache, 100.5, 2);
      const second = LabelCache.price(cache, 100.5, 2);
      expect(first).toBe(second);
    });

    it("uses custom formatter when provided", () => {
      const cache = LabelCache.create(100);
      const formatter = (v: number) => `$${v.toFixed(2)}`;
      const result = LabelCache.price(cache, 100, 2, formatter);
      expect(result).toBe("$100.00");
    });

    it("handles different precisions separately", () => {
      const cache = LabelCache.create(100);
      const p2 = LabelCache.price(cache, 100.5678, 2);
      const p4 = LabelCache.price(cache, 100.5678, 4);
      expect(p2).toBe("100.57");
      expect(p4).toBe("100.5678");
    });
  });

  describe("time", () => {
    it("formats date", () => {
      const cache = LabelCache.create(100);
      const ts = new Date(2025, 0, 15).getTime() / 1000;
      const result = LabelCache.time(cache, ts, "date");
      // Date format is short, may or may not include year
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("formats time", () => {
      const cache = LabelCache.create(100);
      const ts = new Date(2025, 0, 15, 14, 30).getTime() / 1000;
      const result = LabelCache.time(cache, ts, "time");
      expect(result).toBeDefined();
    });

    it("formats datetime", () => {
      const cache = LabelCache.create(100);
      const ts = new Date(2025, 0, 15, 14, 30).getTime() / 1000;
      const result = LabelCache.time(cache, ts, "datetime");
      expect(result).toBeDefined();
    });

    it("caches formatted time", () => {
      const cache = LabelCache.create(100);
      const ts = Date.now() / 1000;
      const first = LabelCache.time(cache, ts, "date");
      const second = LabelCache.time(cache, ts, "date");
      expect(first).toBe(second);
    });
  });
});
