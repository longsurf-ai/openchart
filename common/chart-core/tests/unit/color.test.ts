// Purpose: Tests for Color utility functions (parsing, luminance, contrast, darken/lighten, withAlpha)
// Module:  @openchart/chart-core / tests / unit

import { describe, it, expect } from "vitest";
import { Color } from "@openchart/chart-core/util/color";

describe("Color", () => {
  describe("luminance", () => {
    it("returns 0 for black", () => {
      expect(Color.luminance("#000000")).toBe(0);
    });

    it("returns 1 for white", () => {
      expect(Color.luminance("#ffffff")).toBeCloseTo(1, 5);
    });

    it("returns ~0.5 for mid-gray", () => {
      const lum = Color.luminance("#808080");
      expect(lum).toBeGreaterThan(0.4);
      expect(lum).toBeLessThan(0.6);
    });

    it("handles shorthand hex (#RGB)", () => {
      expect(Color.luminance("#000")).toBe(0);
      expect(Color.luminance("#fff")).toBeCloseTo(1, 5);
    });

    it("red has lower luminance than green", () => {
      const redLum = Color.luminance("#ff0000");
      const greenLum = Color.luminance("#00ff00");
      expect(greenLum).toBeGreaterThan(redLum);
    });

    it("calculates luminance for dark background", () => {
      const lum = Color.luminance("#1c2128");
      expect(lum).toBeLessThan(0.2);
    });
  });

  describe("contrast", () => {
    it("returns light color for dark background", () => {
      expect(Color.contrast("#000000")).toBe("#d1d5db");
      expect(Color.contrast("#1c2128")).toBe("#d1d5db");
      expect(Color.contrast("#222222")).toBe("#d1d5db");
    });

    it("returns dark color for light background", () => {
      expect(Color.contrast("#ffffff")).toBe("#191919");
      expect(Color.contrast("#f0f0f0")).toBe("#191919");
      expect(Color.contrast("#e0e0e0")).toBe("#191919");
    });

    it("handles mid-gray backgrounds", () => {
      // Mid-gray should return one or the other consistently
      const result = Color.contrast("#808080");
      expect(["#d1d5db", "#191919"]).toContain(result);
    });
  });

  describe("isHex", () => {
    it("returns true for valid 6-digit hex", () => {
      expect(Color.isHex("#ffffff")).toBe(true);
      expect(Color.isHex("#000000")).toBe(true);
      expect(Color.isHex("#1c2128")).toBe(true);
      expect(Color.isHex("#AABBCC")).toBe(true);
    });

    it("returns true for valid 3-digit hex", () => {
      expect(Color.isHex("#fff")).toBe(true);
      expect(Color.isHex("#000")).toBe(true);
      expect(Color.isHex("#abc")).toBe(true);
      expect(Color.isHex("#ABC")).toBe(true);
    });

    it("returns false for invalid formats", () => {
      expect(Color.isHex("ffffff")).toBe(false); // missing #
      expect(Color.isHex("#fff00")).toBe(false); // 5 digits
      expect(Color.isHex("#fffffff")).toBe(false); // 7 digits
      expect(Color.isHex("#gggggg")).toBe(false); // invalid chars
      expect(Color.isHex("rgb(255,255,255)")).toBe(false);
      expect(Color.isHex("")).toBe(false);
    });
  });

  describe("toRGB", () => {
    it("parses 6-digit hex correctly", () => {
      expect(Color.toRGB("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(Color.toRGB("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(Color.toRGB("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(Color.toRGB("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
      expect(Color.toRGB("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    });

    it("parses 3-digit hex correctly", () => {
      expect(Color.toRGB("#fff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(Color.toRGB("#000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(Color.toRGB("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    });

    it("parses hsl() format", () => {
      // hsl(0 100% 50%) = pure red
      expect(Color.toRGB("hsl(0 100% 50%)")).toEqual({ r: 255, g: 0, b: 0 });
      // hsl(120 100% 50%) = pure green
      expect(Color.toRGB("hsl(120 100% 50%)")).toEqual({ r: 0, g: 255, b: 0 });
      // hsl(240 100% 50%) = pure blue
      expect(Color.toRGB("hsl(240 100% 50%)")).toEqual({ r: 0, g: 0, b: 255 });
      // hsl(0 0% 0%) = black
      expect(Color.toRGB("hsl(0 0% 0%)")).toEqual({ r: 0, g: 0, b: 0 });
      // hsl(0 0% 100%) = white
      expect(Color.toRGB("hsl(0 0% 100%)")).toEqual({ r: 255, g: 255, b: 255 });
    });

    it("parses hsl() with alpha", () => {
      const { r, g, b } = Color.toRGB("hsl(142 40% 36% / 0.72)");
      // Alpha is ignored for RGB extraction; verify hue/sat/light parsed correctly
      expect(r).toBeGreaterThan(30);
      expect(g).toBeGreaterThan(80);
      expect(b).toBeGreaterThan(30);
    });

    it("parses rgba() format", () => {
      expect(Color.toRGB("rgba(255, 0, 0, 0.5)")).toEqual({
        r: 255,
        g: 0,
        b: 0,
      });
      expect(Color.toRGB("rgba(128, 64, 32, 1)")).toEqual({
        r: 128,
        g: 64,
        b: 32,
      });
    });

    it("parses rgb() format", () => {
      expect(Color.toRGB("rgb(0, 255, 0)")).toEqual({ r: 0, g: 255, b: 0 });
    });
  });

  describe("toHex", () => {
    it("converts RGB to hex correctly", () => {
      expect(Color.toHex(255, 255, 255)).toBe("#ffffff");
      expect(Color.toHex(0, 0, 0)).toBe("#000000");
      expect(Color.toHex(255, 0, 0)).toBe("#ff0000");
      expect(Color.toHex(0, 255, 0)).toBe("#00ff00");
    });

    it("clamps values to 0-255 range", () => {
      expect(Color.toHex(300, -50, 128)).toBe("#ff0080");
    });
  });

  describe("darken", () => {
    it("returns black for factor of 1", () => {
      expect(Color.darken("#ffffff", 1)).toBe("#000000");
    });

    it("returns same color for factor of 0", () => {
      expect(Color.darken("#ffffff", 0)).toBe("#ffffff");
    });

    it("darkens color by percentage", () => {
      const result = Color.darken("#ffffff", 0.5);
      expect(result).toBe("#808080");
    });
  });

  describe("lighten", () => {
    it("returns white for factor of 1", () => {
      expect(Color.lighten("#000000", 1)).toBe("#ffffff");
    });

    it("returns same color for factor of 0", () => {
      expect(Color.lighten("#000000", 0)).toBe("#000000");
    });

    it("lightens color by percentage", () => {
      const result = Color.lighten("#000000", 0.5);
      expect(result).toBe("#808080");
    });
  });

  describe("withAlpha", () => {
    it("handles hex colors", () => {
      expect(Color.withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
      expect(Color.withAlpha("#000", 0.3)).toBe("rgba(0, 0, 0, 0.3)");
    });

    it("handles hsl without existing alpha", () => {
      expect(Color.withAlpha("hsl(160 42% 42%)", 0.5)).toBe(
        "hsl(160 42% 42% / 0.5)",
      );
      expect(Color.withAlpha("hsl(142 40% 36%)", 0)).toBe(
        "hsl(142 40% 36% / 0)",
      );
    });

    it("handles hsl with existing alpha — replaces it", () => {
      expect(Color.withAlpha("hsl(160 42% 42% / 0.72)", 0)).toBe(
        "hsl(160 42% 42% / 0)",
      );
      expect(Color.withAlpha("hsl(160 42% 42% / 0.72)", 0.5)).toBe(
        "hsl(160 42% 42% / 0.5)",
      );
      expect(Color.withAlpha("hsl(0 60% 45% / 1)", 0.3)).toBe(
        "hsl(0 60% 45% / 0.3)",
      );
    });

    it("handles hsla format", () => {
      expect(Color.withAlpha("hsla(160 42% 42% / 0.5)", 0.8)).toBe(
        "hsl(160 42% 42% / 0.8)",
      );
    });

    it("handles rgba — replaces existing alpha", () => {
      expect(Color.withAlpha("rgba(255, 0, 0, 0.5)", 0.8)).toBe(
        "rgba(255, 0, 0, 0.8)",
      );
    });

    it("handles rgb — adds alpha", () => {
      expect(Color.withAlpha("rgb(255, 0, 0)", 0.5)).toBe(
        "rgba(255, 0, 0, 0.5)",
      );
    });

    it("clamps alpha to 0-1 range", () => {
      expect(Color.withAlpha("#ff0000", -0.5)).toBe("rgba(255, 0, 0, 0)");
      expect(Color.withAlpha("#ff0000", 1.5)).toBe("rgba(255, 0, 0, 1)");
    });

    it("returns unrecognized formats unchanged", () => {
      expect(Color.withAlpha("not-a-color", 0.5)).toBe("not-a-color");
    });
  });

  describe("salient", () => {
    it("darkens light colors", () => {
      const result = Color.salient("#ffffff");
      const resultLum = Color.luminance(result);
      expect(resultLum).toBeLessThan(Color.luminance("#ffffff"));
    });

    it("lightens dark colors", () => {
      const result = Color.salient("#000000");
      const resultLum = Color.luminance(result);
      expect(resultLum).toBeGreaterThan(Color.luminance("#000000"));
    });

    it("works with hsl input", () => {
      const result = Color.salient("hsl(142 40% 36%)");
      expect(Color.isHex(result)).toBe(true);
    });

    it("works with rgba input", () => {
      const result = Color.salient("rgba(55, 129, 78, 0.72)");
      expect(Color.isHex(result)).toBe(true);
    });
  });

  describe("luminance with non-hex formats", () => {
    it("computes luminance from hsl", () => {
      // Pure red hsl(0 100% 50%) should match #ff0000
      expect(Color.luminance("hsl(0 100% 50%)")).toBeCloseTo(
        Color.luminance("#ff0000"),
        2,
      );
    });

    it("computes luminance from rgba", () => {
      expect(Color.luminance("rgba(255, 255, 255, 1)")).toBeCloseTo(1, 5);
    });
  });
});
