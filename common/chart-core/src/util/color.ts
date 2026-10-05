// Purpose: Color manipulation utilities (hex parsing, darken/lighten, luminance, contrast, alpha blending)
// Module:  @openchart/chart-core / util

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
// Color utilities for contrast calculation and color manipulation

export namespace Color {
  const CSS_VAR_RE = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/;

  function asCssColor(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (/^(#|rgb|hsl|oklch|lab|lch|color\()/i.test(trimmed)) return trimmed;
    if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*[\d.]+)?$/.test(trimmed)) {
      return `hsl(${trimmed})`;
    }
    return trimmed;
  }

  export function resolve(color: string): string {
    let current = color.trim();
    if (!current) return current;

    for (let depth = 0; depth < 4; depth++) {
      const match = current.match(CSS_VAR_RE);
      if (!match) return asCssColor(current);

      const [, variable, fallback] = match;
      if (typeof document === "undefined") {
        current = fallback?.trim() || current;
        continue;
      }

      const resolved = getComputedStyle(document.documentElement)
        .getPropertyValue(variable!)
        .trim();
      current = resolved || fallback?.trim() || current;
    }

    return asCssColor(current);
  }

  function hslToRgb(
    h: number,
    s: number,
    l: number,
  ): { r: number; g: number; b: number } {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0,
      g = 0,
      b = 0;
    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  /**
   * Convert RGB components (0-255) to HSL components
   * (h: 0-360 degrees, s/l: 0-100 percent).
   */
  export function rgbToHsl(
    r: number,
    g: number,
    b: number,
  ): { h: number; s: number; l: number } {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const l = (max + min) / 2;
    let h = 0;
    if (delta !== 0) {
      if (max === rn) h = ((gn - bn) / delta) % 6;
      else if (max === gn) h = (bn - rn) / delta + 2;
      else h = (rn - gn) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return { h, s: s * 100, l: l * 100 };
  }

  /**
   * Parse a CSS color string to RGB components (0-255).
   * Supports: #RGB, #RRGGBB, hsl(H S% L%), hsl(H S% L% / A), rgb(R,G,B), rgba(R,G,B,A)
   */
  export function toRGB(color: string): { r: number; g: number; b: number } {
    const s = resolve(color);

    // hsl(H S% L%) or hsl(H S% L% / A)
    const hslMatch = s.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    if (hslMatch) {
      return hslToRgb(
        parseFloat(hslMatch[1]!),
        parseFloat(hslMatch[2]!),
        parseFloat(hslMatch[3]!),
      );
    }

    // rgba(R, G, B, A) or rgb(R, G, B)
    const rgbaMatch = s.match(
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/,
    );
    if (rgbaMatch) {
      return {
        r: Math.round(parseFloat(rgbaMatch[1]!)),
        g: Math.round(parseFloat(rgbaMatch[2]!)),
        b: Math.round(parseFloat(rgbaMatch[3]!)),
      };
    }

    // Hex: #RGB or #RRGGBB
    let hex = s.replace("#", "");
    if (hex.length === 3) {
      const [r, g, b] = hex;
      hex =
        (r ?? "") + (r ?? "") + (g ?? "") + (g ?? "") + (b ?? "") + (b ?? "");
    }
    const rgb = parseInt(hex, 16);
    return {
      r: (rgb >> 16) & 0xff,
      g: (rgb >> 8) & 0xff,
      b: rgb & 0xff,
    };
  }

  /**
   * Convert RGB components to hex color
   */
  export function toHex(r: number, g: number, b: number): string {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    return (
      "#" +
      [clamp(r), clamp(g), clamp(b)]
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  /**
   * Darken a hex color by a factor (0-1)
   */
  export function darken(hex: string, factor: number): string {
    const { r, g, b } = toRGB(hex);
    const f = 1 - factor;
    return toHex(r * f, g * f, b * f);
  }

  /**
   * Lighten a hex color by a factor (0-1)
   */
  export function lighten(hex: string, factor: number): string {
    const { r, g, b } = toRGB(hex);
    return toHex(
      r + (255 - r) * factor,
      g + (255 - g) * factor,
      b + (255 - b) * factor,
    );
  }

  /**
   * Generate a salient (distinguishable) color from a base color
   * Darkens light colors, lightens dark colors for visibility on axes
   */
  export function salient(hex: string): string {
    const lum = luminance(hex);
    return lum > 0.5 ? darken(hex, 0.3) : lighten(hex, 0.3);
  }
  /**
   * Calculate relative luminance (0-1) from a CSS color string.
   * Uses simplified luminance formula: 0.299*R + 0.587*G + 0.114*B
   */
  export function luminance(color: string): number {
    const { r, g, b } = toRGB(color);
    return 0.299 * (r / 255) + 0.587 * (g / 255) + 0.114 * (b / 255);
  }

  /**
   * Return a contrasting text color for a given background
   * Returns light gray for dark backgrounds, dark gray for light backgrounds
   */
  export function contrast(bg: string): string {
    return luminance(bg) < 0.5 ? "#d1d5db" : "#191919";
  }

  /**
   * Check if a color string is valid hex format
   */
  export function isHex(color: string): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
  }

  export function withAlpha(color: string, alpha: number): string {
    const resolved = resolve(color);
    const a = Math.max(0, Math.min(1, alpha));
    if (isHex(resolved)) {
      const { r, g, b } = toRGB(resolved);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    // hsl/hsla — strip existing alpha before appending new one
    const hslMatch = resolved.match(/^hsla?\((.+)\)$/i);
    if (hslMatch) {
      const inner = hslMatch[1]!.replace(/\s*\/\s*[\d.]+\s*$/, "");
      return `hsl(${inner} / ${a})`;
    }
    // rgb/rgba — extract first 3 channels, replace alpha
    const rgbaMatch = resolved.match(
      /^rgba?\(\s*([^,]+),\s*([^,]+),\s*([^,)]+)/i,
    );
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${a})`;
    }
    return resolved;
  }
}
