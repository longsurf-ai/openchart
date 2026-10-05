// Purpose: Scale mode transforms — percentage, indexed, logarithmic conversions for data and extents
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace ScaleMode {
  // All supported scale modes
  export const Mode = z.enum([
    "normal",
    "logarithmic",
    "percentage",
    "indexed",
  ]);
  export type Mode = z.infer<typeof Mode>;

  // Convert value to percentage change from first value
  export function toPercent(price: number, first: number): number {
    if (first === 0) return 0;
    return ((price - first) / first) * 100;
  }

  // Convert percentage back to price
  export function fromPercent(percent: number, first: number): number {
    return first * (1 + percent / 100);
  }

  // Convert value to indexed (base 100)
  export function toIndexed(price: number, first: number): number {
    if (first === 0) return 100;
    return (price / first) * 100;
  }

  // Convert indexed value back to price
  export function fromIndexed(indexed: number, first: number): number {
    return first * (indexed / 100);
  }

  // Transform data array to mode-specific values
  export function transformData<T extends { value?: number; close?: number }>(
    data: T[],
    mode: Mode,
  ): { transformed: T[]; firstValue: number | null } {
    if (data.length === 0) return { transformed: [], firstValue: null };

    const first = data[0];
    const firstValue = first?.close ?? first?.value ?? 0;

    if (mode === "normal" || mode === "logarithmic") {
      return { transformed: data, firstValue };
    }

    const transformed = data.map((item) => {
      const value = item.close ?? item.value;
      if (value === undefined) return item;

      const newValue =
        mode === "percentage"
          ? toPercent(value, firstValue)
          : toIndexed(value, firstValue);

      return {
        ...item,
        value: newValue,
        close: item.close !== undefined ? newValue : undefined,
      };
    }) as T[];

    return { transformed, firstValue };
  }

  // Transform extent values for a given mode
  export function transformExtent(
    extent: { min: number; max: number },
    mode: Mode,
    firstValue: number,
  ): { min: number; max: number } {
    if (mode === "normal" || mode === "logarithmic") {
      return extent;
    }

    const transform = mode === "percentage" ? toPercent : toIndexed;
    return {
      min: transform(extent.min, firstValue),
      max: transform(extent.max, firstValue),
    };
  }

  // Get format function for mode
  export function formatter(
    mode: Mode,
    precision = 2,
  ): (value: number) => string {
    switch (mode) {
      case "percentage":
        return (v) => `${v >= 0 ? "+" : ""}${v.toFixed(precision)}%`;
      case "indexed":
        return (v) => v.toFixed(precision);
      default:
        return (v) => v.toFixed(precision);
    }
  }

  // Map chart options mode to CoordSys mode
  export function toCoordMode(mode: Mode): "linear" | "log" {
    return mode === "logarithmic" ? "log" : "linear";
  }
}
