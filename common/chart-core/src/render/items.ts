// Purpose: Zod-validated render item schemas and data-to-render-item transform functions for each series type
// Module:  @openchart/chart-core / render

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Data } from "@openchart/chart-core/data";
import { YScale } from "@openchart/chart-core/scale";

export namespace Render {
  // Base render item - all items have position
  export const Base = z.object({
    x: z.number(),
    index: z.number(),
  });
  export type Base = z.infer<typeof Base>;

  // Line point
  export const Point = Base.extend({
    y: z.number(),
    color: z.string(),
  });
  export type Point = z.infer<typeof Point>;

  // Area point with gradient bounds
  export const Area = Point.extend({
    topY: z.number(),
    bottomY: z.number(),
    topColor: z.string(),
    bottomColor: z.string(),
  });
  export type Area = z.infer<typeof Area>;

  // Histogram bar
  export const Histogram = Base.extend({
    y: z.number(),
    baseY: z.number(),
    width: z.number(),
    color: z.string(),
  });
  export type Histogram = z.infer<typeof Histogram>;

  // OHLC bar
  export const Bar = Base.extend({
    openY: z.number(),
    highY: z.number(),
    lowY: z.number(),
    closeY: z.number(),
    width: z.number(),
    color: z.string(),
  });
  export type Bar = z.infer<typeof Bar>;

  // Candlestick
  export const Candlestick = Bar.extend({
    borderColor: z.string(),
    wickColor: z.string(),
  });
  export type Candlestick = z.infer<typeof Candlestick>;

  // Visible range
  export const Range = z.object({
    from: z.number(),
    to: z.number(),
  });
  export type Range = z.infer<typeof Range>;

  // Transform data to render items
  export function toPoints(
    data: Data.Value[],
    scale: YScale.State,
    xPositions: number[],
    defaultColor: string,
  ): Point[] {
    const result: Point[] = [];

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = xPositions[i];
      if (d === undefined || x === undefined) continue;

      result.push({
        x,
        index: i,
        y: YScale.toY(scale, d.value) as number,
        color: d.color ?? defaultColor,
      });
    }

    return result;
  }

  export function toCandlesticks(
    data: Data.Candlestick[],
    scale: YScale.State,
    xPositions: number[],
    width: number,
    defaultColors: { up: string; down: string; border: string; wick: string },
  ): Candlestick[] {
    const result: Candlestick[] = [];

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = xPositions[i];
      if (d === undefined || x === undefined) continue;

      const isUp = d.close >= d.open;
      const color = d.color ?? (isUp ? defaultColors.up : defaultColors.down);

      result.push({
        x,
        index: i,
        openY: YScale.toY(scale, d.open) as number,
        highY: YScale.toY(scale, d.high) as number,
        lowY: YScale.toY(scale, d.low) as number,
        closeY: YScale.toY(scale, d.close) as number,
        width,
        color,
        borderColor: d.borderColor ?? defaultColors.border,
        wickColor: d.wickColor ?? defaultColors.wick,
      });
    }

    return result;
  }

  export function toBars(
    data: Data.Bar[],
    scale: YScale.State,
    xPositions: number[],
    width: number,
    defaultColors: { up: string; down: string },
  ): Bar[] {
    const result: Bar[] = [];

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = xPositions[i];
      if (d === undefined || x === undefined) continue;

      const isUp = d.close >= d.open;
      const color = d.color ?? (isUp ? defaultColors.up : defaultColors.down);

      result.push({
        x,
        index: i,
        openY: YScale.toY(scale, d.open) as number,
        highY: YScale.toY(scale, d.high) as number,
        lowY: YScale.toY(scale, d.low) as number,
        closeY: YScale.toY(scale, d.close) as number,
        width,
        color,
      });
    }

    return result;
  }

  export function toHistogram(
    data: Data.Histogram[],
    scale: YScale.State,
    xPositions: number[],
    width: number,
    base: number,
    defaultColor: string,
  ): Histogram[] {
    const result: Histogram[] = [];
    const baseY = YScale.toY(scale, base) as number;

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = xPositions[i];
      if (d === undefined || x === undefined) continue;

      result.push({
        x,
        index: i,
        y: YScale.toY(scale, d.value) as number,
        baseY,
        width,
        color: d.color ?? defaultColor,
      });
    }

    return result;
  }
}
