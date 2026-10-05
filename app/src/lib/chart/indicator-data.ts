// Purpose: Map recognized Tea numeric outputs and vertical profiles to faithful core series options and profiles.
import { VerticalProfile } from "@openchart/chart-core/vertical-profile";
import { z } from "zod";
import { visualColor, visualCssColor, visualNumber } from "./tea-visual-value";

const presentation = z.object({
  title: z.string(),
  color: visualColor,
  linewidth: z.number(),
  display: z.string().default("all"),
});
const plot = presentation.extend({
  series: visualNumber,
  style: z.enum([
    "line",
    "histogram",
    "columns",
    "area",
    "areabr",
    "linebr",
    "stepline",
    "circles",
    "cross",
  ]),
  offset: z.number().int(),
  histbase: z.number().default(0),
  show_last: z.number().int().nonnegative().default(0),
});
const hline = presentation.extend({
  price: visualNumber,
  linestyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
});

export interface IndicatorPoint {
  value: number | null;
  title: string;
  type: "Line" | "Histogram" | "Area";
  color: string | undefined;
  lineWidth: number;
  offset: number;
  showLast: number;
  visible: boolean;
  base: number;
  lineStyle: "solid" | "dashed" | "dotted";
  lineType: "linear" | "step" | "circles" | "cross";
}
/** Decode by declared kind, retaining gaps, offsets and numerical fill bases.
 * @example const point = indicatorPoint(row.macd, "series");
 */
export function indicatorPoint(
  value: unknown,
  kind: "numeric" | "series" | "horizontal-line",
): IndicatorPoint {
  const defaults: IndicatorPoint = {
    value: null,
    title: "",
    type: "Line",
    color: undefined,
    lineWidth: 1.5,
    offset: 0,
    showLast: 0,
    visible: true,
    base: 0,
    lineStyle: "solid",
    lineType: "linear",
  };
  if (value == null || kind === "numeric")
    return { ...defaults, value: visualNumber.parse(value ?? null) };
  if (kind === "horizontal-line") {
    const point = hline.parse(value);
    return {
      ...defaults,
      value: point.price,
      title: point.title,
      color: visualCssColor(point.color),
      lineWidth: point.linewidth,
      lineStyle: point.linestyle,
      visible: point.display !== "none",
    };
  }
  const point = plot.parse(value);
  return {
    ...defaults,
    value: point.series,
    title: point.title,
    color: visualCssColor(point.color),
    lineWidth: point.linewidth,
    type:
      point.style === "histogram" || point.style === "columns"
        ? "Histogram"
        : point.style === "area" || point.style === "areabr"
          ? "Area"
          : "Line",
    offset: point.offset,
    showLast: point.show_last,
    visible: point.display !== "none",
    base: point.histbase,
    lineType:
      point.style === "stepline"
        ? "step"
        : point.style === "circles"
          ? "circles"
          : point.style === "cross"
            ? "cross"
            : "linear",
  };
}

// A part or level written with an `na` color still needs a visible color.
const unsetColor = "rgba(120, 123, 134, 0.5)";
const part = { color: visualColor, title: z.string() };
const profile = z.object({
  from: z.number(),
  to: z.number(),
  display: z.string(),
  rows: z.array(
    z.object({
      low: z.number(),
      high: z.number(),
      segments: z.array(z.object({ value: z.number(), ...part })),
    }),
  ),
  levels: z.array(z.object({ y: z.number(), ...part })),
});

/**
 * Decode a vertical-profile output column into the profiles to draw, in the
 * colors the script wrote. Only the last description written for each box
 * start is drawn, and only those are decoded. Tea's millisecond times become
 * chart seconds; `display = "none"` hides a profile. Parts keep their titles,
 * which {@link restyleProfiles} and the Style settings read.
 *
 * @throws When a drawn description is malformed or breaks
 * {@link VerticalProfile.State}, such as overlapping rows or an empty box.
 * @example const profiles = indicatorProfiles(frame.column("profile"));
 */
export function indicatorProfiles(
  values: readonly unknown[],
): VerticalProfile.State[] {
  const last = new Map<unknown, unknown>();
  for (const value of values)
    if (value !== null) last.set((value as { from?: unknown }).from, value);
  return [...last.values()].map((value) => {
    const { from, to, display, rows, levels } = profile.parse(value);
    return VerticalProfile.State.parse({
      box: { kind: "time", from: from / 1000, to: to / 1000 },
      rows: rows.map((row) => ({
        low: row.low,
        high: row.high,
        segments: row.segments.map((segment) => ({
          value: segment.value,
          color: visualCssColor(segment.color) ?? unsetColor,
          title: segment.title,
        })),
      })),
      levels: levels.map((level) => ({
        y: level.y,
        color: visualCssColor(level.color) ?? unsetColor,
        title: level.title,
      })),
      visible: display !== "none",
    });
  });
}

/**
 * Apply saved part colors, keyed by part title, to decoded profiles; parts
 * without a title keep the script's color. Returns `profiles` itself when
 * nothing is saved, so restyling never decodes again.
 * @example const drawn = restyleProfiles(profiles, prefs.series[id]?.partColors);
 */
export function restyleProfiles(
  profiles: readonly VerticalProfile.State[],
  colors: Readonly<Record<string, string>> | undefined,
): readonly VerticalProfile.State[] {
  if (!colors || Object.keys(colors).length === 0) return profiles;
  const color = <P extends { color: string; title?: string }>(part: P): P =>
    part.title && colors[part.title]
      ? { ...part, color: colors[part.title]! }
      : part;
  return profiles.map((drawn) => ({
    ...drawn,
    rows: drawn.rows.map((row) => ({
      ...row,
      segments: row.segments.map(color),
    })),
    levels: drawn.levels.map(color),
  }));
}
