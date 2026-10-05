// Purpose: CoordSys type definitions (Zod schemas) and transform math (linear, log, inverse)
// Module:  @openchart/chart-core / coord

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace CoordSys {
  export const ScaleMode = z.enum(["linear", "log"]).default("linear");
  export type ScaleMode = z.infer<typeof ScaleMode>;

  export const Scale = z.object({
    extent: z.tuple([z.number(), z.number()]),
    range: z.tuple([z.number(), z.number()]),
    mode: ScaleMode,
  });
  export type Scale = z.infer<typeof Scale>;

  export const ScaleConfig = z.object({
    from: z.number().default(0),
    to: z.number().default(1),
    mode: ScaleMode,
  });
  export type ScaleConfig = z.infer<typeof ScaleConfig>;

  export const Bounds = z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  });
  export type Bounds = z.infer<typeof Bounds>;

  export const State = z.object({
    type: z.string(),
    bounds: Bounds,
    scales: z.object({
      x: Scale,
      y: z.record(z.string(), Scale),
    }),
    defaultYScale: z.string(),
  });
  export type State = z.infer<typeof State>;

  export const Extents = z.object({
    x: z.object({ min: z.number(), max: z.number() }),
    y: z.record(z.string(), z.object({ min: z.number(), max: z.number() })),
  });
  export type Extents = z.infer<typeof Extents>;

  export function linear(
    value: number,
    extent: [number, number],
    range: [number, number],
  ): number {
    const [dMin, dMax] = extent;
    const [pMin, pMax] = range;
    const r = dMax - dMin;
    if (r === 0) return (pMin + pMax) / 2;
    return pMin + ((value - dMin) / r) * (pMax - pMin);
  }

  export function log(
    value: number,
    extent: [number, number],
    range: [number, number],
  ): number {
    const [dMin, dMax] = extent;
    const [pMin, pMax] = range;
    const safeMin = Math.max(dMin, 1e-10);
    const safeMax = Math.max(dMax, 1e-10);
    const safeVal = Math.max(value, 1e-10);
    const logMin = Math.log(safeMin);
    const logMax = Math.log(safeMax);
    const logVal = Math.log(safeVal);
    const r = logMax - logMin;
    if (r === 0) return (pMin + pMax) / 2;
    return pMin + ((logVal - logMin) / r) * (pMax - pMin);
  }

  export function inverse(
    pixel: number,
    extent: [number, number],
    range: [number, number],
  ): number {
    const [dMin, dMax] = extent;
    const [pMin, pMax] = range;
    const r = pMax - pMin;
    if (r === 0) return (dMin + dMax) / 2;
    return dMin + ((pixel - pMin) / r) * (dMax - dMin);
  }

  export function inverseLog(
    pixel: number,
    extent: [number, number],
    range: [number, number],
  ): number {
    const [dMin, dMax] = extent;
    const [pMin, pMax] = range;
    const safeMin = Math.max(dMin, 1e-10);
    const safeMax = Math.max(dMax, 1e-10);
    const logMin = Math.log(safeMin);
    const logMax = Math.log(safeMax);
    const r = pMax - pMin;
    if (r === 0) return (safeMin + safeMax) / 2;
    const logVal = logMin + ((pixel - pMin) / r) * (logMax - logMin);
    return Math.exp(logVal);
  }

  export function toPixel(value: number, scale: Scale): number {
    return scale.mode === "log"
      ? log(value, scale.extent, scale.range)
      : linear(value, scale.extent, scale.range);
  }

  export function toValue(pixel: number, scale: Scale): number {
    return scale.mode === "log"
      ? inverseLog(pixel, scale.extent, scale.range)
      : inverse(pixel, scale.extent, scale.range);
  }

  export function dataToPoint(
    state: State,
    data: number[],
    scaleIds?: Record<string, string>,
  ): [number, number] {
    const yId = scaleIds?.y ?? state.defaultYScale;
    const yScale = state.scales.y[yId] ?? Object.values(state.scales.y)[0];
    if (!yScale) return [0, 0];
    return [toPixel(data[0]!, state.scales.x), toPixel(data[1]!, yScale)];
  }

  export function pointToData(
    state: State,
    point: number[],
    scaleIds?: Record<string, string>,
  ): [number, number] {
    const yId = scaleIds?.y ?? state.defaultYScale;
    const yScale = state.scales.y[yId] ?? Object.values(state.scales.y)[0];
    if (!yScale) return [0, 0];
    return [toValue(point[0]!, state.scales.x), toValue(point[1]!, yScale)];
  }

  export function contains(state: State, point: number[]): boolean {
    const b = state.bounds;
    return (
      point[0]! >= b.x &&
      point[0]! <= b.x + b.width &&
      point[1]! >= b.y &&
      point[1]! <= b.y + b.height
    );
  }
}
