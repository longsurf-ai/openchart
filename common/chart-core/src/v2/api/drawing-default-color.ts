// Purpose: Resolve theme-aware default colors for newly created chart drawings
// Module:  @openchart/chart-core / v2 / api

import { Color } from "@openchart/chart-core/util";

const DARK_BACKGROUND_LUMINANCE_THRESHOLD = 0.5;

type DrawingColorConfig = {
  layout: {
    background: string;
    textColor: string;
  };
};

function channelLuminance(channel: number): number {
  const value = channel / 255;
  if (value <= 0.03928) return value / 12.92;
  return Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(color: string): number {
  const rgb = Color.toRGB(color);
  return (
    channelLuminance(rgb.r) * 0.2126 +
    channelLuminance(rgb.g) * 0.7152 +
    channelLuminance(rgb.b) * 0.0722
  );
}

function resolveBackground(config: DrawingColorConfig): string {
  const background = Color.resolve(config.layout.background);
  if (!background.startsWith("var(")) return background;
  return Color.resolve("var(--chart-bg, #ffffff)");
}

export function resolveDrawingDefaultColor(config: DrawingColorConfig): string {
  const background = resolveBackground(config);
  return relativeLuminance(background) < DARK_BACKGROUND_LUMINANCE_THRESHOLD
    ? "#ffffff"
    : "#000000";
}
