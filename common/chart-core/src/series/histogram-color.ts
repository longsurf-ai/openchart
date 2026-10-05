// Purpose: Shared color resolution for histogram bars and their chart chrome
// Module:  @openchart/chart-core / series

import { Series } from "./def";

export function resolveHistogramBarColor(input: {
  options: Series.HistogramOptions;
  value: number;
  previousValue?: number;
  explicitColor?: unknown;
}): string {
  if (typeof input.explicitColor === "string") return input.explicitColor;

  const { options, value, previousValue } = input;
  if (Number.isFinite(value)) {
    if (value >= 0 && options.positiveColor) {
      return previousValue !== undefined &&
        value < previousValue &&
        options.positiveFadedColor
        ? options.positiveFadedColor
        : options.positiveColor;
    }

    if (value < 0 && options.negativeColor) {
      return previousValue !== undefined &&
        value > previousValue &&
        options.negativeFadedColor
        ? options.negativeFadedColor
        : options.negativeColor;
    }
  }

  return options.color;
}
