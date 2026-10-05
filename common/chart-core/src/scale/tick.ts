// Purpose: Tick mark generation for time and price axes, including nice-step rounding
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
// Tick mark generation for axes
import { z } from "zod";
import { Schema } from "effect";
import { Data } from "@openchart/chart-core/data";
import { YScale, TimeScale } from "@openchart/chart-core/scale";

export namespace Tick {
  // Time tick mark
  export const TimeMark = z.object({
    index: z.number(),
    time: z.custom<Data.Time>(Schema.is(Data.Time)),
    x: z.number(),
    label: z.string(),
    weight: z.number().default(0),
  });
  export type TimeMark = z.infer<typeof TimeMark>;

  // Price tick mark
  export const PriceMark = z.object({
    price: z.number(),
    y: z.number(),
    label: z.string(),
  });
  export type PriceMark = z.infer<typeof PriceMark>;

  // Generate time axis tick marks
  export function generateTimeMarks(
    timeScale: TimeScale.State,
    times: Data.Time[],
    dataLength: number,
    formatFn?: (time: Data.Time) => string,
  ): TimeMark[] {
    const marks: TimeMark[] = [];
    const { valid: range } = TimeScale.visibleRange(timeScale, dataLength);

    if (range.to <= range.from) return marks;

    // Calculate appropriate step based on bar spacing
    const visibleBars = range.to - range.from;
    const targetMarks = Math.max(
      3,
      Math.min(10, Math.floor(timeScale.width / 80)),
    );
    const step = Math.ceil(visibleBars / targetMarks);

    for (let i = range.from; i < range.to; i += step) {
      const time = times[i];
      if (time === undefined) continue;

      const x = TimeScale.indexToX(timeScale, i, dataLength);
      const label = formatFn ? formatFn(time) : TimeScale.format(time);

      marks.push({
        index: i,
        time,
        x,
        label,
        weight: 0,
      });
    }

    return marks;
  }

  // Generate price axis tick marks
  export function generatePriceMarks(
    scale: YScale.State,
    formatFn?: (price: number) => string,
  ): PriceMark[] {
    const marks: PriceMark[] = [];
    const range = scale.max - scale.min;

    if (range === 0) return marks;

    // Calculate nice step
    const targetMarks = Math.max(3, Math.min(8, Math.floor(scale.height / 50)));
    const rawStep = range / targetMarks;
    const step = niceStep(rawStep);

    // Start from a nice round number
    const start = Math.ceil(scale.min / step) * step;

    for (let price = start; price <= scale.max; price += step) {
      const y = YScale.toY(scale, price);
      const label = formatFn ? formatFn(price) : formatPrice(price, step);

      marks.push({
        price,
        y,
        label,
      });
    }

    return marks;
  }

  // Calculate a "nice" step value
  function niceStep(rawStep: number): number {
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;

    let nice: number;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 5) nice = 5;
    else nice = 10;

    return nice * magnitude;
  }

  // Format price with appropriate precision
  function formatPrice(price: number, step: number): string {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return price.toFixed(Math.min(decimals, 8));
  }
}
