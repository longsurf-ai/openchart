// Purpose: Price and time axis rendering — tick generation, canvas painting, and label formatting
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { CoordSys } from "@openchart/chart-core/coord";
import { Data } from "@openchart/chart-core/data/schema";
import * as Tz from "@openchart/chart-core/tz/types";

export namespace PriceAxis {
  // Axis configuration
  export const Config = z.object({
    visible: z.boolean().default(true),
    width: z.number().default(60),
    side: z.enum(["left", "right"]),
    textColor: z.string().default("#191919"),
    font: z.string().default("12px sans-serif"),
    tickCount: z.number().default(5),
    precision: z.number().default(2),
    borderVisible: z.boolean().default(false),
    borderColor: z.string().default("#2B2B43"),
    ticksVisible: z.boolean().default(false),
  });
  export type Config = z.infer<typeof Config>;

  // Tick mark on the axis
  export type TickMark = {
    value: number;
    y: number;
    label: string;
  };

  // Generate tick marks for a price scale
  export function generateTicks(
    extent: [number, number],
    height: number,
    count = 5,
    precision = 2,
    formatter?: (value: number) => string,
  ): TickMark[] {
    const [min, max] = extent;
    const range = max - min;

    if (range === 0 || !isFinite(range)) {
      return [
        {
          value: min,
          y: height / 2,
          label: formatter ? formatter(min) : min.toFixed(precision),
        },
      ];
    }

    const step = niceStep(range / count);
    const start = Math.ceil(min / step) * step;
    const marks: TickMark[] = [];

    for (let value = start; value <= max; value += step) {
      const t = (value - min) / range;
      const y = height - t * height; // Invert Y (0 at top)
      const label = formatter
        ? formatter(value)
        : formatValue(value, step, precision);

      marks.push({ value, y, label });
    }

    return marks;
  }

  // Generate ticks from a coordinate scale (covers data extent only)
  export function fromScale(
    scale: CoordSys.Scale,
    count = 5,
    precision = 2,
    formatter?: (value: number) => string,
  ): TickMark[] {
    const [min, max] = scale.extent;
    const range = max - min;

    if (range === 0 || !isFinite(range)) {
      const y = CoordSys.toPixel(min, scale);
      return [
        {
          value: min,
          y,
          label: formatter ? formatter(min) : min.toFixed(precision),
        },
      ];
    }

    const step = niceStep(range / count);
    const start = Math.ceil(min / step) * step;
    const marks: TickMark[] = [];

    for (let value = start; value <= max; value += step) {
      const y = CoordSys.toPixel(value, scale);
      const label = formatter
        ? formatter(value)
        : formatValue(value, step, precision);

      marks.push({ value, y, label });
    }

    return marks;
  }

  export function fromVisualRange(
    scale: CoordSys.Scale,
    height: number,
    targetSpacing = 50,
    precision = 2,
    formatter?: (value: number) => string,
  ): TickMark[] {
    const topValue = CoordSys.toValue(0, scale);
    const bottomValue = CoordSys.toValue(height, scale);
    const visualMin = Math.min(topValue, bottomValue);
    const visualMax = Math.max(topValue, bottomValue);
    const range = visualMax - visualMin;

    if (range === 0 || !isFinite(range)) {
      return [
        {
          value: visualMin,
          y: height / 2,
          label: formatter
            ? formatter(visualMin)
            : visualMin.toFixed(precision),
        },
      ];
    }

    const tickCount = Math.max(3, Math.floor(height / targetSpacing));
    const step = niceStep(range / tickCount);
    const start = Math.floor(visualMin / step) * step;
    const marks: TickMark[] = [];

    for (let value = start; value <= visualMax + step; value += step) {
      const y = CoordSys.toPixel(value, scale);
      if (y >= -5 && y <= height + 5) {
        const label = formatter
          ? formatter(value)
          : formatValue(value, step, precision);
        marks.push({ value, y, label });
      }
    }

    return marks;
  }

  // Render price axis to canvas
  export function render(
    ctx: CanvasRenderingContext2D,
    marks: TickMark[],
    config: Config,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    if (!config.visible) return;

    ctx.save();
    ctx.font = config.font;
    ctx.fillStyle = config.textColor;

    const isLeft = config.side === "left";
    const textX = isLeft ? bounds.x + bounds.width - 12 : bounds.x + 12;
    ctx.textAlign = isLeft ? "right" : "left";
    ctx.textBaseline = "middle";
    const fontSize = Number(config.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 12);
    const labelInset = Math.min(bounds.height / 2, fontSize / 2 + 1);

    // Draw axis border line
    if (config.borderVisible) {
      ctx.strokeStyle = config.borderColor;
      ctx.lineWidth = 1;
      const lineX = isLeft ? bounds.x + bounds.width - 0.5 : bounds.x + 0.5;
      ctx.beginPath();
      ctx.moveTo(lineX, bounds.y);
      ctx.lineTo(lineX, bounds.y + bounds.height);
      ctx.stroke();
    }

    // Draw ticks and labels
    for (const mark of marks) {
      const y = mark.y;

      // Skip labels that would bleed across pane boundaries or separators.
      if (
        y < bounds.y + labelInset ||
        y > bounds.y + bounds.height - labelInset
      )
        continue;

      // Tick mark
      if (config.ticksVisible) {
        ctx.strokeStyle = config.borderColor;
        ctx.lineWidth = 1;
        const tickStart = isLeft ? bounds.x + bounds.width - 5 : bounds.x;
        const tickEnd = isLeft ? bounds.x + bounds.width : bounds.x + 5;
        ctx.beginPath();
        ctx.moveTo(tickStart, Math.round(y) + 0.5);
        ctx.lineTo(tickEnd, Math.round(y) + 0.5);
        ctx.stroke();
      }

      // Label
      ctx.fillText(mark.label, textX, y);
    }

    ctx.restore();
  }

  // Calculate axis width based on largest label
  export function measureWidth(
    ctx: CanvasRenderingContext2D,
    marks: TickMark[],
    font: string,
    padding = 16,
  ): number {
    ctx.save();
    ctx.font = font;

    let maxWidth = 0;
    for (const mark of marks) {
      const width = ctx.measureText(mark.label).width;
      if (width > maxWidth) maxWidth = width;
    }

    ctx.restore();
    return Math.ceil(maxWidth + padding);
  }

  // Calculate nice step value
  function niceStep(rawStep: number): number {
    if (!isFinite(rawStep) || rawStep === 0) return 1;

    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
    const normalized = rawStep / magnitude;

    let nice: number;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 5) nice = 5;
    else nice = 10;

    return nice * magnitude;
  }

  // Format value with appropriate precision
  function formatValue(
    value: number,
    step: number,
    maxPrecision: number,
  ): string {
    const stepDecimals = Math.max(0, -Math.floor(Math.log10(step)));
    const decimals = Math.min(stepDecimals, maxPrecision);
    return value.toFixed(decimals);
  }
}

export namespace TimeAxis {
  // Axis configuration
  export const Config = z.object({
    visible: z.boolean().default(true),
    height: z.number().default(30),
    textColor: z.string().default("#191919"),
    font: z.string().default("12px sans-serif"),
    borderVisible: z.boolean().default(false),
    borderColor: z.string().default("#2B2B43"),
    ticksVisible: z.boolean().default(false),
    timeVisible: z.boolean().default(false),
    secondsVisible: z.boolean().default(true),
    targetLabelSpacing: z.number().default(120),
  });
  export type Config = z.infer<typeof Config>;

  // Tick mark on the time axis
  export type TickMark = {
    index: number;
    x: number;
    label: string;
    weight: number;
  };

  // Time unit hierarchy for adaptive display
  type TimeUnit =
    "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

  type NumericDateParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };

  const numericDateTimeFormatters = new Map<Tz.Name, Intl.DateTimeFormat>();
  const namedDatePartsCache = new Map<string, NumericDateParts>();
  const NAMED_DATE_PARTS_CACHE_LIMIT = 4096;

  function numericDateTimeFormatter(tz: Tz.Name): Intl.DateTimeFormat {
    const cached = numericDateTimeFormatters.get(tz);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: tz === Tz.LOCAL ? undefined : tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    numericDateTimeFormatters.set(tz, formatter);
    return formatter;
  }

  function requiredNumericPart(
    parts: Intl.DateTimeFormatPart[],
    type: Intl.DateTimeFormatPartTypes,
  ): number {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) {
      throw new Error(`Intl.DateTimeFormat omitted required ${type} part`);
    }
    return Number(value);
  }

  function numericDateParts(time: number, tz: Tz.Name): NumericDateParts {
    const date = new Date(time * 1000);
    if (tz === Tz.LOCAL) {
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
      };
    }
    if (tz === Tz.UTC) {
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
      };
    }
    const cacheKey = `${tz}:${time}`;
    const cached = namedDatePartsCache.get(cacheKey);
    if (cached) return cached;
    const parts = numericDateTimeFormatter(tz).formatToParts(date);
    const result = {
      year: requiredNumericPart(parts, "year"),
      month: requiredNumericPart(parts, "month"),
      day: requiredNumericPart(parts, "day"),
      hour: requiredNumericPart(parts, "hour"),
      minute: requiredNumericPart(parts, "minute"),
      second: requiredNumericPart(parts, "second"),
    };
    if (namedDatePartsCache.size >= NAMED_DATE_PARTS_CACHE_LIMIT) {
      const oldestKey = namedDatePartsCache.keys().next().value;
      if (oldestKey !== undefined) namedDatePartsCache.delete(oldestKey);
    }
    namedDatePartsCache.set(cacheKey, result);
    return result;
  }

  // Extract year and month from a time value
  function getYearMonth(
    time: unknown,
    tz: Tz.Name = Tz.UTC,
  ): { year: number; month: number } | null {
    if (typeof time === "number") {
      const parts = numericDateParts(time, tz);
      return { year: parts.year, month: parts.month };
    }
    return null;
  }

  // Extract full date components from a time value
  type DateInfo = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };

  function getDateInfo(time: unknown, tz: Tz.Name = Tz.UTC): DateInfo | null {
    if (typeof time === "number") {
      return numericDateParts(time, tz);
    }
    return null;
  }

  // Weight hierarchy for label priority.  Higher-weight marks evict lower
  // in cullOverlaps, guaranteeing that year marks always survive when space
  // allows, even if month marks arrived first.
  const WEIGHT_YEAR = 2;
  const WEIGHT_MONTH = 1;
  const WEIGHT_REGULAR = 0;

  // Label strategy routing (TimeUnit → branch):
  //   periodic:  week, month, year  → month-name labels, year boundaries, adaptive month stepping
  //   daily:     day                → day-of-month labels, month/year boundaries
  //   intraday:  hour, minute, second → HH:MM labels, day/month/year boundaries, adaptive bar stepping

  // Generate time axis marks from data - adaptive to zoom level
  export function generateMarks(
    times: unknown[],
    xPositions: number[],
    range: { from: number; to: number },
    chartWidth: number = 800,
    tz: Tz.Name = Tz.UTC,
    config?: Partial<Config>,
  ): TickMark[] {
    const marks: TickMark[] = [];
    const visibleCount = range.to - range.from;
    if (visibleCount <= 0 || times.length === 0) return marks;

    const targetLabelSpacing = config?.targetLabelSpacing ?? 120;

    const firstTime = times[range.from];
    const lastTime = times[Math.min(range.to - 1, times.length - 1)];
    const barInterval = inferBarInterval(times, range);
    const timeUnit =
      barInterval !== null
        ? barIntervalToUnit(barInterval)
        : detectTimeUnit(firstTime, lastTime);

    if (timeUnit === "month" || timeUnit === "year" || timeUnit === "week") {
      // Stable density selection based on pixels-per-month (zoom-dependent,
      // pan-independent). Count unique months to compute density, then pick
      // a fixed step that doesn't flip-flop when the user pans.
      let totalMonths = 0;
      let prev: { year: number; month: number } | null = null;
      for (let i = range.from; i < range.to && i < times.length; i++) {
        const ym = getYearMonth(times[i], tz);
        if (ym === null) continue;
        if (prev === null || ym.year !== prev.year || ym.month !== prev.month)
          totalMonths++;
        prev = ym;
      }

      const pxPerMonth =
        totalMonths > 0 ? chartWidth / totalMonths : chartWidth;
      // Step thresholds based on how much space each month gets:
      //   ≥80px → every month,  ≥40px → quarters,  ≥20px → half-year,  <20px → years only
      let monthStep: number;
      if (pxPerMonth >= 80) monthStep = 1;
      else if (pxPerMonth >= 40) monthStep = 3;
      else if (pxPerMonth >= 20) monthStep = 6;
      else monthStep = 12; // year-only mode

      prev = null;
      for (let i = range.from; i < range.to && i < times.length; i++) {
        const x = xPositions[i];
        if (x === undefined) continue;

        const ym = getYearMonth(times[i], tz);
        if (ym === null) continue;

        // Skip data points within the same month
        if (prev !== null && ym.year === prev.year && ym.month === prev.month)
          continue;

        if (prev !== null && ym.year !== prev.year) {
          // Year boundary: always emit bold year label
          marks.push({ index: i, x, label: `${ym.year}`, weight: WEIGHT_YEAR });
        } else if (monthStep < 12 && (ym.month - 1) % monthStep === 0) {
          // Month label at the selected step interval (skipped in year-only mode)
          marks.push({
            index: i,
            x,
            label: monthName(ym.month),
            weight: WEIGHT_REGULAR,
          });
        }

        prev = ym;
      }
    } else if (timeUnit === "day") {
      // Day branch: stable density based on pixels-per-day.
      // Count unique days to determine density.
      let totalDays = 0;
      let prevDay: DateInfo | null = null;
      for (let i = range.from; i < range.to && i < times.length; i++) {
        const info = getDateInfo(times[i], tz);
        if (!info) continue;
        if (
          !prevDay ||
          info.year !== prevDay.year ||
          info.month !== prevDay.month ||
          info.day !== prevDay.day
        )
          totalDays++;
        prevDay = info;
      }

      const pxPerDay = totalDays > 0 ? chartWidth / totalDays : chartWidth;
      // At very low density, skip day-of-month labels entirely — only
      // boundaries (months/years) matter.  This prevents stray day numbers
      // like "16" from appearing at extreme zoom-out.
      const showDayLabels = pxPerDay >= 2;
      let dayStep = 1;
      if (pxPerDay < 4) dayStep = 10;
      else if (pxPerDay < 20) dayStep = 5;

      let prev: DateInfo | null = null;
      let dayCounter = 0;
      for (let i = range.from; i < range.to && i < times.length; i++) {
        const x = xPositions[i];
        if (x === undefined) continue;

        const info = getDateInfo(times[i], tz);
        if (!info) continue;

        // Deduplicate same-day entries
        if (
          prev &&
          info.year === prev.year &&
          info.month === prev.month &&
          info.day === prev.day
        )
          continue;
        dayCounter++;

        if (prev && (info.year !== prev.year || info.month !== prev.month)) {
          // Year vs month boundary — year gets higher weight so it
          // always survives cullOverlaps even when adjacent to a month mark.
          const isYear = info.year !== prev!.year;
          const label = isYear ? `${info.year}` : monthName(info.month);
          marks.push({
            index: i,
            x,
            label,
            weight: isYear ? WEIGHT_YEAR : WEIGHT_MONTH,
          });
          dayCounter = 0; // reset step counter after boundary
        } else if (showDayLabels && dayCounter % dayStep === 0) {
          marks.push({
            index: i,
            x,
            label: `${info.day}`,
            weight: WEIGHT_REGULAR,
          });
        }

        prev = info;
      }
    } else {
      // Intraday units (hour, minute, second): show time labels with bold day/month boundaries
      const maxLabels = Math.max(
        2,
        Math.floor(chartWidth / targetLabelSpacing),
      );
      const step = Math.max(1, Math.ceil(visibleCount / maxLabels));
      let prev: DateInfo | null = null;

      for (let i = range.from; i < range.to && i < times.length; i += step) {
        const x = xPositions[i];
        if (x === undefined) continue;

        const info = getDateInfo(times[i], tz);
        if (!info) {
          marks.push({
            index: i,
            x,
            label: formatTimeByUnit(times[i], timeUnit, tz),
            weight: 0,
          });
          continue;
        }

        // Detect boundaries BEFORE updating prev
        const yearChanged = prev !== null && info.year !== prev.year;
        const monthChanged = prev !== null && info.month !== prev.month;
        const dayChanged = prev !== null && info.day !== prev.day;

        // Always update prev so boundary detection stays current
        prev = info;

        if (yearChanged) {
          marks.push({
            index: i,
            x,
            label: `${info.year}`,
            weight: WEIGHT_YEAR,
          });
        } else if (monthChanged) {
          marks.push({
            index: i,
            x,
            label: monthName(info.month),
            weight: WEIGHT_MONTH,
          });
        } else if (dayChanged) {
          marks.push({
            index: i,
            x,
            label: `${monthName(info.month)} ${info.day}`,
            weight: WEIGHT_MONTH,
          });
        } else {
          marks.push({
            index: i,
            x,
            label: formatTimeByUnit(times[i], timeUnit, tz),
            weight: WEIGHT_REGULAR,
          });
        }
      }
    }

    return cullOverlaps(marks);
  }

  // Average glyph width for 12px sans-serif, ~7px per character.
  // Conservative: real glyphs vary 5–9px but 7 is a safe median.
  const AVG_GLYPH_PX = 7;
  // Minimum gap between the right edge of one label and the left edge of the next.
  const LABEL_GAP_PX = 12;

  /** Estimate the rendered width of a label in pixels. */
  export function estimateLabelWidth(label: string): number {
    return label.length * AVG_GLYPH_PX;
  }

  /**
   * Remove overlapping marks. Labels are center-aligned at mark.x, so each
   * label occupies [x - width/2, x + width/2]. Walk left-to-right, keeping
   * a mark only if its left edge clears the previous mark's right edge by
   * LABEL_GAP_PX.
   *
   * Weight hierarchy: a mark with strictly higher weight evicts the previous
   * mark of lower weight.  This guarantees that year marks (weight 2) always
   * survive over month marks (weight 1), which survive over day/time marks
   * (weight 0).
   */
  export function cullOverlaps(marks: TickMark[]): TickMark[] {
    if (marks.length <= 1) return marks;
    const result: TickMark[] = [];
    // rightEdge tracks the x-coordinate of the right edge of the last kept label
    let rightEdge = -Infinity;

    for (const mark of marks) {
      const halfW = estimateLabelWidth(mark.label) / 2;
      const leftEdge = mark.x - halfW;

      if (leftEdge >= rightEdge + LABEL_GAP_PX) {
        // No overlap — keep it
        result.push(mark);
        rightEdge = mark.x + halfW;
      } else if (
        result.length > 0 &&
        mark.weight > result[result.length - 1]!.weight
      ) {
        // Higher-weight mark evicts the previous lower-weight mark
        result.pop();
        // Recalculate rightEdge from the new last element
        if (result.length > 0) {
          const prev = result[result.length - 1]!;
          rightEdge = prev.x + estimateLabelWidth(prev.label) / 2;
        } else {
          rightEdge = -Infinity;
        }
        // Re-check if mark fits after eviction
        if (leftEdge >= rightEdge + LABEL_GAP_PX) {
          result.push(mark);
          rightEdge = mark.x + halfW;
        }
      }
      // else: same or lower weight overlaps — skip it
    }

    return result;
  }

  // Detect appropriate time unit based on visible range
  function detectTimeUnit(firstTime: unknown, lastTime: unknown): TimeUnit {
    const first = Data.readTime(firstTime);
    const last = Data.readTime(lastTime);

    if (first === undefined || last === undefined) return "day";

    const rangeSeconds = Math.abs(last - first);

    // Choose unit based on range
    if (rangeSeconds < 300) return "second"; // < 5 minutes
    if (rangeSeconds < 7200) return "minute"; // < 2 hours
    if (rangeSeconds < 172800) return "hour"; // < 2 days
    if (rangeSeconds < 1209600) return "day"; // < 2 weeks
    if (rangeSeconds < 5184000) return "week"; // < 2 months
    if (rangeSeconds < 63072000) return "month"; // < 2 years
    return "year";
  }

  // Infer bar interval from the minimum positive delta between consecutive bars.
  // Intraday closure gaps are larger than the cadence. Calendar-period deltas
  // may vary around DST; barIntervalToUnit deliberately tolerates that drift.
  export function inferBarInterval(
    times: unknown[],
    range: { from: number; to: number },
  ): number | null {
    let minDelta = Infinity;
    const limit = Math.min(range.from + 50, range.to, times.length);
    for (let i = range.from + 1; i < limit; i++) {
      const a = Data.readTime(times[i - 1]);
      const b = Data.readTime(times[i]);
      if (a === undefined || b === undefined) continue;
      const delta = Math.abs(b - a);
      if (delta > 0 && delta < minDelta) minDelta = delta;
    }
    return isFinite(minDelta) ? minDelta : null;
  }

  // Map a bar interval (seconds) to the appropriate TimeUnit for label routing.
  // The week→month threshold uses 2,160,000s (~25 days) to correctly handle
  // February (28d = 2,419,200s) as monthly rather than weekly.
  export function barIntervalToUnit(intervalSeconds: number): TimeUnit {
    if (intervalSeconds < 60) return "second";
    if (intervalSeconds < 3600) return "minute"; // 1m, 5m, 15m, 50m
    if (intervalSeconds < 20 * 3600) return "hour"; // 1h, 4h
    // Calendar-period UTC deltas vary around DST. Boundaries midway between
    // supported 4h/1d, 1d/1W, and 1W/1M cadences keep routing stable.
    if (intervalSeconds < 5 * 86400) return "day"; // 1D (23h/25h included)
    if (intervalSeconds < 25 * 86400) return "week"; // 1W (167h/169h included)
    return "month"; // 1M+
  }

  // Format crosshair label with resolution-appropriate detail (numeric, no month names).
  // Intraday: "2025-02-15 14:30", daily: "2025-02-15", monthly: "2025-02", yearly: "2025"
  export function formatCrosshair(
    time: unknown,
    unit: TimeUnit,
    tz: Tz.Name = Tz.UTC,
  ): string {
    if (typeof time === "number") {
      const parts = numericDateParts(time, tz);
      const y = parts.year;
      const mo = String(parts.month).padStart(2, "0");
      const da = String(parts.day).padStart(2, "0");
      const hh = String(parts.hour).padStart(2, "0");
      const mi = String(parts.minute).padStart(2, "0");
      const ss = String(parts.second).padStart(2, "0");

      switch (unit) {
        case "second":
          return `${y}-${mo}-${da} ${hh}:${mi}:${ss}`;
        case "minute":
        case "hour":
          return `${y}-${mo}-${da} ${hh}:${mi}`;
        case "day":
        case "week":
          return `${y}-${mo}-${da}`;
        case "month":
          return `${y}-${mo}`;
        case "year":
          return `${y}`;
      }
    }
    return String(time);
  }

  // Format time based on detected unit
  function formatTimeByUnit(
    time: unknown,
    unit: TimeUnit,
    tz: Tz.Name = Tz.UTC,
  ): string {
    if (typeof time === "number") {
      const d = new Date(time * 1000);
      const opts: Intl.DateTimeFormatOptions = {
        timeZone: tz === Tz.LOCAL ? undefined : tz,
      };

      switch (unit) {
        case "second":
          return d.toLocaleTimeString(undefined, {
            ...opts,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        case "minute":
          return d.toLocaleTimeString(undefined, {
            ...opts,
            hour: "2-digit",
            minute: "2-digit",
          });
        case "hour":
          return d.toLocaleTimeString(undefined, {
            ...opts,
            hour: "2-digit",
            minute: "2-digit",
          });
        case "day":
          return d.toLocaleDateString(undefined, {
            ...opts,
            month: "short",
            day: "numeric",
          });
        case "week":
          return d.toLocaleDateString(undefined, {
            ...opts,
            month: "short",
            day: "numeric",
          });
        case "month":
          return d.toLocaleDateString(undefined, { ...opts, month: "short" });
        case "year":
          return String(numericDateParts(time, tz).year);
      }
    }
    return String(time);
  }

  function monthName(month: number): string {
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return names[month - 1] ?? `${month}`;
  }

  // Render time axis to canvas
  export function render(
    ctx: CanvasRenderingContext2D,
    marks: TickMark[],
    config: Partial<Config>,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const c = Config.parse(config);
    if (!c.visible) return;

    ctx.save();
    ctx.font = c.font;
    ctx.fillStyle = c.textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // Draw axis border line
    if (c.borderVisible) {
      ctx.strokeStyle = c.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bounds.x, bounds.y + 0.5);
      ctx.lineTo(bounds.x + bounds.width, bounds.y + 0.5);
      ctx.stroke();
    }

    // Draw ticks and labels
    for (const mark of marks) {
      const x = mark.x;

      // Skip if out of bounds
      if (x < bounds.x || x > bounds.x + bounds.width) continue;

      // Tick mark
      if (c.ticksVisible) {
        ctx.strokeStyle = c.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, bounds.y);
        ctx.lineTo(Math.round(x) + 0.5, bounds.y + 5);
        ctx.stroke();
      }

      // Label - use bold font for year separators (weight > 0)
      ctx.font = c.font;
      if (mark.weight > 0) {
        ctx.font = c.font.replace(/(\d+px)/, "bold $1");
      }
      ctx.fillText(mark.label, x, bounds.y + 8);
    }

    ctx.restore();
  }
}
