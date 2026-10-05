// Purpose: Decode Tea's nominal visual descriptions at the rendering boundary.
import { z } from "zod";

export const visualNumber = z.union([z.number(), z.nan()]).nullable();
// Tea int fields are Arrow Float64; its bigint DataStream clock is separate.
// Preserve na, but never silently round unsafe epoch-millisecond coordinates.
const timestamp = z.union([z.number().int(), z.nan()]).nullable();
export const visualColor = z
  .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() })
  .nullable();
/** Tea channels are bytes, including alpha. @example visualCssColor({r:255,g:0,b:0,a:128}) */
export function visualCssColor(
  color: z.infer<typeof visualColor>,
): string | undefined {
  return color === null
    ? undefined
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}
const display = { display: z.string().default("all") };
const color = { color: visualColor };
const label = { title: z.string().default(""), text: z.string().default("") };
const offset = {
  offset: z.number().int().default(0),
  show_last: z.number().int().nonnegative().default(0),
};
const shape = z.object({
  series: z.boolean().nullable(),
  ...label,
  ...color,
  ...offset,
  ...display,
  location: z.enum(["abovebar", "belowbar", "top", "bottom", "absolute"]),
  textcolor: visualColor.default(null),
  size: z
    .enum(["auto", "tiny", "small", "normal", "large", "huge"])
    .default("auto"),
  force_overlay: z.boolean().default(false),
});
export const indicatorVisualSchemas = {
  fill: z.object({
    first: z.string(),
    second: z.string(),
    ...color,
    ...display,
    title: z.string().default(""),
  }),
  shape: shape.extend({
    style: z.enum([
      "circle",
      "square",
      "diamond",
      "triangleup",
      "triangledown",
      "arrowup",
      "arrowdown",
      "cross",
      "xcross",
      "flag",
      "labelup",
      "labeldown",
    ]),
  }),
  character: shape.extend({ char: z.string() }),
  background: z.object({
    ...color,
    ...offset,
    ...display,
    title: z.string().default(""),
  }),
  "bar-color": z.object({
    ...color,
    ...offset,
    ...display,
    title: z.string().default(""),
  }),
  segment: z.object({
    id: z.string(),
    start_time: timestamp,
    start_value: visualNumber,
    end_time: timestamp,
    end_value: visualNumber,
    ...color,
    linewidth: z.number().nonnegative(),
    text: z.string(),
    force_overlay: z.boolean(),
  }),
  zone: z.object({
    id: z.string(),
    start_time: timestamp,
    end_time: timestamp,
    top: visualNumber,
    bottom: visualNumber,
    ...color,
    text: z.string(),
    force_overlay: z.boolean(),
  }),
  candles: z.object({
    id: z.string(),
    open: visualNumber,
    high: visualNumber,
    low: visualNumber,
    close: visualNumber,
    title: z.string(),
    ...color,
    wickcolor: visualColor,
    bordercolor: visualColor,
  }),
} as const;
export type IndicatorVisualKind = keyof typeof indicatorVisualSchemas;
export type IndicatorVisual = {
  [K in IndicatorVisualKind]: { kind: K } & z.infer<
    (typeof indicatorVisualSchemas)[K]
  >;
}[IndicatorVisualKind];
/** Decode by declared nominal kind, never by object resemblance. Absence clears that row.
 * @example const marker = decodeIndicatorVisual(row.signal, "shape");
 */
export function decodeIndicatorVisual<K extends IndicatorVisualKind>(
  value: unknown,
  kind: K,
): Extract<IndicatorVisual, { kind: K }> | null {
  if (value == null) return null;
  const decoded = {
    kind,
    ...indicatorVisualSchemas[kind].parse(value),
  } as IndicatorVisual;
  if (
    (decoded.kind === "shape" || decoded.kind === "character") &&
    decoded.series === true &&
    decoded.location === "absolute"
  )
    throw new Error(
      "Tea shape location.absolute requires a numeric anchor; boolean plotshape has none.",
    );
  return decoded as Extract<IndicatorVisual, { kind: K }>;
}
