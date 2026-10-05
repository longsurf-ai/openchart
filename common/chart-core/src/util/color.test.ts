// Purpose: Tests for Color utility conversions
// Module:  @openchart/chart-core / util

import { describe, expect, it } from "vitest";
import { Color } from "./color";

describe("Color.rgbToHsl", () => {
  it("converts primary red", () => {
    expect(Color.rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
  });

  it("converts achromatic colors with zero saturation", () => {
    expect(Color.rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 100 });
    expect(Color.rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
    const gray = Color.rgbToHsl(128, 128, 128);
    expect(gray.s).toBe(0);
    expect(gray.l).toBeCloseTo(50.2, 1);
  });

  it("normalizes hues from the wrap-around red-magenta segment", () => {
    const { h } = Color.rgbToHsl(255, 0, 128);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(360);
    expect(h).toBeCloseTo(329.9, 1);
  });

  it("round-trips through Color.toRGB for hsl colors", () => {
    const { r, g, b } = Color.toRGB("hsl(174 86% 62%)");
    const { h, s, l } = Color.rgbToHsl(r, g, b);
    expect(h).toBeCloseTo(174, 0);
    expect(s).toBeCloseTo(86, 0);
    expect(l).toBeCloseTo(62, 0);
  });
});
