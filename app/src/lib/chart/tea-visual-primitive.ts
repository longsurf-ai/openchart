// Purpose: Render Tea visual descriptions as transient, replaceable series primitives.
import { CoordSys } from "@openchart/chart-core/coord";
import { Primitive } from "@openchart/chart-core/primitive/def";
import type { HitTest } from "@openchart/chart-core/hit";
import { Color } from "@openchart/chart-core/util";
import { visualCssColor, type IndicatorVisual } from "./tea-visual-value";

export type IndicatorDecoration = Exclude<IndicatorVisual, { kind: "candles" }>;
export type IndicatorVisualRow = {
  time: number;
  value: IndicatorDecoration | null;
};
export type IndicatorFillOutputs = Readonly<
  Record<
    string,
    readonly { time: number; value: number | null; offset?: number }[]
  >
>;
export type IndicatorVisualHit = {
  text: string;
  time: number;
  targetTime: number;
} & (
  | {
      kind: "segment" | "zone";
      range: { from: number; to: number };
      values: { from: number; to: number };
    }
  | {
      kind: Exclude<IndicatorDecoration["kind"], "segment" | "zone">;
      range?: never;
      values?: never;
    }
);
type Point = { x: number; y: number };
type Painted = {
  label?: true;
  draw: (ctx: CanvasRenderingContext2D) => void;
  hit?: (x: number, y: number) => number;
  info?: IndicatorVisualHit;
};
const finite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

/** Immutable descriptors become one owned contribution. Replace this primitive when the
 * frame changes; no historical draw commands or mutable Tea handles are replayed.
 * Times in rows/outputs are core seconds; Segment/Zone payloads carry Tea milliseconds.
 * @example createIndicatorPrimitive({id:"rsi:signals",kind:"shape",rows:signals});
 */
export function createIndicatorPrimitive({
  id,
  kind,
  rows,
  outputs = {},
  labelLimit = 4,
  background,
}: {
  id: string;
  kind: IndicatorDecoration["kind"];
  rows: readonly IndicatorVisualRow[];
  outputs?: IndicatorFillOutputs;
  labelLimit?: number;
  /** Canonical chart background, used only for readable annotation text. */
  background?: string;
}): Primitive.SeriesPrimitive {
  let painted: Painted[] = [];
  const zOrder =
    kind === "fill" || kind === "background" || kind === "zone"
      ? "background"
      : "top";
  return {
    id,
    zOrder,
    detached() {
      painted = [];
    },
    updateAllViews(context, data) {
      painted = [];
      const scale = context.coord.scales.y[context.coord.defaultYScale];
      if (!scale || !data.data.length) return;
      const points = data.data as {
        time: number;
        high?: number;
        low?: number;
        close?: number;
        value?: number;
        open?: number;
      }[];
      const byTime = new Map(points.map((point, index) => [point.time, index]));
      const bounds = context.coord.bounds;
      const labelPlacements = context.labelPlacements ?? [];
      const y = (value: number) => CoordSys.toPixel(value, scale);
      const xAtIndex = (index: number): number | undefined => {
        if (context.xPositionAt) return context.xPositionAt(index);
        const exact = context.xPositions[index];
        if (exact !== undefined) return exact;
        if (points.length < 2) return undefined;
        const edge = index < 0 ? 0 : points.length - 1;
        const adjacent = index < 0 ? 1 : edge - 1;
        const a = context.xPositions[edge],
          b = context.xPositions[adjacent];
        return a === undefined || b === undefined
          ? undefined
          : a + ((index - edge) * (a - b)) / (edge - adjacent);
      };
      const xAtTime = (time: number): number | undefined => {
        const exact = byTime.get(time);
        if (exact !== undefined) return xAtIndex(exact);
        // Continuous time anchors use their adjacent loaded bars, including an edge
        // extrapolation; this describes geometry and never fabricates input bars.
        if (points.length < 2) return undefined;
        let lo = 0,
          hi = points.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (points[mid]!.time < time) lo = mid + 1;
          else hi = mid;
        }
        const next = Math.min(points.length - 1, Math.max(1, lo));
        const prev = next - 1;
        const left = xAtIndex(prev),
          right = xAtIndex(next);
        const span = points[next]!.time - points[prev]!.time;
        return left === undefined || right === undefined || span === 0
          ? undefined
          : left + ((right - left) * (time - points[prev]!.time)) / span;
      };
      const outputValues = new Map(
        Object.entries(outputs).map(([name, values]) => [
          name,
          new Map(
            values.flatMap((value) => {
              const index = byTime.get(value.time);
              return index === undefined
                ? []
                : [[index + (value.offset ?? 0), value.value] as const];
            }),
          ),
        ]),
      );
      const outputOffsets = new Map(
        Object.entries(outputs).map(([name, values]) => [
          name,
          values.find((value) => value.offset !== undefined)?.offset ?? 0,
        ]),
      );
      const textCandidates: {
        point: Point;
        text: string;
        color: string;
        above: boolean;
        clearance: number;
        info?: IndicatorVisualHit;
      }[] = [];
      const addLabel = (
        point: Point,
        text: string,
        color: string,
        above = true,
        clearance = 0,
      ) => {
        if (text)
          textCandidates.push({
            point,
            text,
            color,
            above,
            clearance,
            info: painted.at(-1)?.info,
          });
      };
      // A zone output names itself once, like a last-value tag: its latest
      // visible zone's text, at the pane's right edge on that zone's level.
      let zoneTag:
        | {
            text: string;
            color: string;
            middle: number;
            info?: IndicatorVisualHit;
          }
        | undefined;
      const uniqueGeometry = new Map<string, IndicatorVisualRow>();
      for (const row of rows) {
        const value = row.value;
        if (value?.kind !== "zone" && value?.kind !== "segment") continue;
        const key =
          value.kind === "zone"
            ? `${value.id}:${value.start_time}`
            : `${value.id}:${value.start_time}:${value.start_value}:${value.end_time}:${value.end_value}`;
        const first = uniqueGeometry.get(key);
        uniqueGeometry.set(key, { time: first?.time ?? row.time, value });
      }
      const drawRows =
        kind === "zone" || kind === "segment"
          ? [...uniqueGeometry.values()]
          : rows;
      for (let rowIndex = 0; rowIndex < drawRows.length; rowIndex++) {
        const row = drawRows[rowIndex]!;
        const value = row.value;
        if (
          !value ||
          value.kind !== kind ||
          ("display" in value && value.display === "none")
        )
          continue;
        if (value.color?.a === 0) continue;
        const hostColor = background ? Color.contrast(background) : undefined;
        const defaultColor =
          value.kind === "zone" && hostColor
            ? Color.withAlpha(hostColor, 0.14)
            : value.kind === "shape" ||
                value.kind === "character" ||
                value.kind === "segment"
              ? hostColor
              : undefined;
        const color = visualCssColor(value.color) ?? defaultColor;
        // Conditional fill/bgcolor/barcolor na clears that contribution. Markers
        // and geometry may instead use the host's canonical background contrast.
        if (!color) continue;
        if (
          "show_last" in value &&
          value.show_last > 0 &&
          rowIndex < drawRows.length - value.show_last
        )
          continue;
        const index = byTime.get(row.time);
        const target =
          index === undefined
            ? undefined
            : index +
              (value.kind === "fill"
                ? (outputOffsets.get(value.first) ?? 0)
                : "offset" in value
                  ? value.offset
                  : 0);
        const x = target === undefined ? undefined : xAtIndex(target);
        const bar = target === undefined ? undefined : points[target];
        if (value.kind === "segment" || value.kind === "zone") {
          const start = value.start_time,
            end = value.end_time;
          if (!finite(start) || !finite(end)) continue;
          const x1 = xAtTime(start / 1000),
            x2 = xAtTime(end / 1000);
          if (
            x1 === undefined ||
            x2 === undefined ||
            Math.max(x1, x2) < bounds.x ||
            Math.min(x1, x2) > bounds.x + bounds.width
          )
            continue;
          if (value.kind === "segment") {
            if (!finite(value.start_value) || !finite(value.end_value))
              continue;
            const a = { x: x1, y: y(value.start_value) },
              b = { x: x2, y: y(value.end_value) };
            if (![a.y, b.y].every(Number.isFinite)) continue;
            painted.push({
              draw(ctx) {
                ctx.strokeStyle = color;
                ctx.lineWidth = value.linewidth;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.setLineDash([]);
              },
              hit: (px, py) => segmentDistance({ x: px, y: py }, a, b),
              info: {
                kind: value.kind,
                text: value.text,
                time: row.time,
                targetTime: end / 1000,
                range: { from: start / 1000, to: end / 1000 },
                values: { from: value.start_value, to: value.end_value },
              },
            });
            addLabel(b, value.text, color);
          } else {
            if (!finite(value.top) || !finite(value.bottom)) continue;
            const top = y(value.top),
              bottom = y(value.bottom);
            if (![top, bottom].every(Number.isFinite)) continue;
            const left = Math.min(x1, x2),
              width = Math.abs(x2 - x1),
              upper = Math.min(top, bottom),
              height = Math.abs(bottom - top);
            painted.push({
              draw(ctx) {
                ctx.fillStyle = color;
                ctx.fillRect(left, upper, width, height);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(left, upper, width, height);
              },
              hit: (px, py) =>
                px >= left &&
                px <= left + width &&
                py >= upper &&
                py <= upper + height
                  ? 0
                  : Infinity,
              info: {
                kind: value.kind,
                text: value.text,
                time: row.time,
                targetTime: end / 1000,
                range: { from: start / 1000, to: end / 1000 },
                values: { from: value.top, to: value.bottom },
              },
            });
            zoneTag = {
              text: value.text,
              color: value.color
                ? visualCssColor({ ...value.color, a: 255 })!
                : hostColor!,
              middle: upper + height / 2,
              info: painted.at(-1)!.info,
            };
          }
          continue;
        }
        if (
          x === undefined ||
          target === undefined ||
          x < bounds.x - context.barWidth ||
          x > bounds.x + bounds.width + context.barWidth
        )
          continue;
        if (value.kind === "fill") {
          const first = outputValues.get(value.first),
            second = outputValues.get(value.second);
          if (!first || !second) continue;
          const next = drawRows[rowIndex + 1];
          if (!next || next.value?.kind !== "fill") continue;
          const nextIndex = byTime.get(next.time);
          const nextTarget =
            nextIndex === undefined
              ? undefined
              : nextIndex + (outputOffsets.get(value.first) ?? 0);
          const nextX =
            nextTarget === undefined ? undefined : xAtIndex(nextTarget);
          const a = first.get(target),
            b = second.get(target),
            c = nextTarget === undefined ? undefined : first.get(nextTarget),
            d = nextTarget === undefined ? undefined : second.get(nextTarget);
          if (
            nextX === undefined ||
            !finite(a ?? null) ||
            !finite(b ?? null) ||
            !finite(c ?? null) ||
            !finite(d ?? null)
          )
            continue;
          const vertices = [
            { x, y: y(a!) },
            { x: nextX, y: y(c!) },
            { x: nextX, y: y(d!) },
            { x, y: y(b!) },
          ];
          if (!vertices.every((p) => Number.isFinite(p.y))) continue;
          painted.push({
            draw(ctx) {
              ctx.fillStyle = color;
              ctx.beginPath();
              vertices.forEach((p, i) =>
                i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
              );
              ctx.closePath();
              ctx.fill();
            },
          });
        } else if (value.kind === "background") {
          painted.push({
            draw(ctx) {
              ctx.fillStyle = color;
              ctx.fillRect(
                x - context.barWidth / 2,
                bounds.y,
                context.barWidth,
                bounds.height,
              );
            },
          });
        } else if (value.kind === "bar-color") {
          if (!bar) continue;
          if (
            ![bar.open, bar.high, bar.low, bar.close].every(
              (v) => typeof v === "number" && Number.isFinite(v),
            )
          )
            continue;
          painted.push({
            draw(ctx) {
              const top = y(Math.max(bar.open!, bar.close!)),
                bottom = y(Math.min(bar.open!, bar.close!));
              const width = Math.max(1, context.barWidth * 0.7);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x, y(bar.high!));
              ctx.lineTo(x, y(bar.low!));
              ctx.stroke();
              ctx.fillStyle = color;
              ctx.fillRect(
                x - width / 2,
                top,
                width,
                Math.max(1, bottom - top),
              );
            },
          });
        } else if (value.kind === "shape" || value.kind === "character") {
          if (!bar) continue;
          if (value.series !== true) continue;
          if (value.location === "absolute")
            throw new Error(
              "Tea shape location.absolute requires a numeric anchor; boolean plotshape has none.",
            );
          const above =
            value.location === "abovebar" || value.location === "top";
          const size = {
            auto: 6,
            tiny: 4,
            small: 5,
            normal: 6,
            large: 8,
            huge: 10,
          }[value.size];
          const anchor = above
            ? (bar.high ?? bar.value ?? bar.close)
            : (bar.low ?? bar.value ?? bar.close);
          const py =
            value.location === "top"
              ? bounds.y + size + 4
              : value.location === "bottom"
                ? bounds.y + bounds.height - size - 4
                : typeof anchor === "number"
                  ? y(anchor) + (above ? -1 : 1) * (size + 5)
                  : NaN;
          if (!Number.isFinite(py)) continue;
          const text = value.text || value.title;
          painted.push({
            draw(ctx) {
              ctx.fillStyle = color;
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5;
              if (value.kind === "character") {
                ctx.font = `${size * 2}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(value.char, x, py);
              } else drawShape(ctx, value.style, x, py, size);
            },
            hit: (px, my) => Math.max(0, Math.hypot(px - x, my - py) - size),
            info: {
              kind: value.kind,
              text,
              time: row.time,
              targetTime: bar.time,
            },
          });
          if (value.textcolor?.a !== 0)
            addLabel(
              { x, y: py },
              text,
              visualCssColor(value.textcolor) ?? color,
              above,
              size,
            );
        }
      }
      if (zoneTag?.text && labelLimit > 0) {
        const { text, color, middle, info } = zoneTag;
        let tag: CoordSys.Bounds | undefined;
        painted.push({
          label: true,
          info,
          hit: (x, y) =>
            tag &&
            x >= tag.x &&
            x <= tag.x + tag.width &&
            y >= tag.y &&
            y <= tag.y + tag.height
              ? 0
              : Infinity,
          draw(ctx) {
            ctx.font = "10px sans-serif";
            const width =
                (ctx.measureText?.(text).width ?? text.length * 6) + 8,
              height = 16;
            tag = {
              x: bounds.x + bounds.width - width,
              y: Math.max(
                bounds.y,
                Math.min(
                  middle - height / 2,
                  bounds.y + bounds.height - height,
                ),
              ),
              width,
              height,
            };
            ctx.fillStyle = color;
            ctx.fillRect(tag.x, tag.y, width, height);
            ctx.fillStyle = Color.contrast(color);
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(text, tag.x + 4, tag.y + height / 2);
          },
        });
      }
      for (const label of labelLimit > 0
        ? textCandidates.slice(-labelLimit)
        : []) {
        const { point, text, color, above, clearance, info } = label;
        if (
          point.x < bounds.x ||
          point.x > bounds.x + bounds.width ||
          point.y < bounds.y ||
          point.y > bounds.y + bounds.height
        )
          continue;
        let placement: CoordSys.Bounds | undefined;
        painted.push({
          label: true,
          info,
          hit: (x, y) => {
            return placement &&
              x >= placement.x &&
              x <= placement.x + placement.width &&
              y >= placement.y &&
              y <= placement.y + placement.height
              ? 0
              : Infinity;
          },
          draw(ctx) {
            placement = undefined;
            if (labelPlacements.length >= labelLimit) return;
            ctx.font = "10px sans-serif";
            const textWidth = ctx.measureText?.(text).width ?? text.length * 6;
            const width = textWidth + 8,
              height = 16;
            if (width > bounds.width - 4) return;
            const left = Math.max(
              bounds.x + 2,
              Math.min(
                point.x - width / 2,
                bounds.x + bounds.width - width - 2,
              ),
            );
            const candidates = [3, 11, 19].flatMap((gap) =>
              [above, !above].map((placeAbove) => ({
                x: left,
                y:
                  point.y +
                  (placeAbove ? -height - gap - clearance : gap + clearance),
                width,
                height,
              })),
            );
            placement = candidates.find(
              (candidate) =>
                candidate.y >= bounds.y + 2 &&
                candidate.y + height <= bounds.y + bounds.height - 2 &&
                !context.labelIntersectsSeries?.(candidate) &&
                !labelPlacements.some(
                  (other) =>
                    candidate.x < other.x + other.width + 3 &&
                    candidate.x + width + 3 > other.x &&
                    candidate.y < other.y + other.height + 3 &&
                    candidate.y + height + 3 > other.y,
                ),
            );
            if (!placement) return;
            labelPlacements.push(placement);
            ctx.fillStyle = background
              ? readableLabelColor(color, background)
              : color;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(text, placement.x + 4, placement.y + 3);
          },
        });
      }
    },
    paneViews() {
      return [false, true].flatMap((label) => {
        const items = painted.filter((item) => Boolean(item.label) === label);
        return items.length
          ? [
              Primitive.view(label ? "top" : zOrder, {
                draw(ctx) {
                  ctx.save();
                  for (const item of items) item.draw(ctx);
                  ctx.restore();
                },
              }),
            ]
          : [];
      });
    },
    hitTest(x, y): HitTest.Result | null {
      let match: { item: Painted; distance: number } | undefined;
      for (const item of painted) {
        if (!item.info?.text || !item.hit) continue;
        const distance = item.hit(x, y);
        if (distance <= 6 && (!match || distance < match.distance))
          match = { item, distance };
      }
      return match
        ? {
            type: "primitive",
            id,
            distance: match.distance,
            zOrder: Primitive.zOrderValue[match.item.label ? "top" : zOrder],
            data: match.item.info,
          }
        : null;
    },
  };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length),
        );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function drawShape(
  ctx: CanvasRenderingContext2D,
  style: Extract<IndicatorVisual, { kind: "shape" }>["style"],
  x: number,
  y: number,
  size: number,
) {
  ctx.beginPath();
  if (style === "circle") {
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === "cross" || style === "xcross") {
    const diagonal = style === "xcross";
    ctx.moveTo(x - size, y - (diagonal ? size : 0));
    ctx.lineTo(x + size, y + (diagonal ? size : 0));
    ctx.moveTo(x - (diagonal ? size : 0), y + size);
    ctx.lineTo(x + (diagonal ? size : 0), y - size);
    ctx.stroke();
  } else if (
    style === "square" ||
    style === "flag" ||
    style === "labelup" ||
    style === "labeldown"
  ) {
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  } else if (style === "diamond") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
  } else {
    const direction = style === "triangleup" || style === "arrowup" ? -1 : 1;
    ctx.moveTo(x, y + direction * size);
    ctx.lineTo(x + size, y - direction * size);
    ctx.lineTo(x - size, y - direction * size);
    ctx.closePath();
    ctx.fill();
  }
}

/** Preserve authored hues when legible; adapt only text, never signal colors. */
function readableLabelColor(color: string, background: string): string {
  const backgroundLuminance = Color.luminance(background);
  const contrast = (candidate: string) => {
    const alpha = Number(
      /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(candidate)?.[1] ?? 1,
    );
    const foreground = Color.toRGB(candidate),
      backdrop = Color.toRGB(background);
    const visible = Color.toHex(
      foreground.r * alpha + backdrop.r * (1 - alpha),
      foreground.g * alpha + backdrop.g * (1 - alpha),
      foreground.b * alpha + backdrop.b * (1 - alpha),
    );
    const luminance = Color.luminance(visible);
    return (
      (Math.max(luminance, backgroundLuminance) + 0.05) /
      (Math.min(luminance, backgroundLuminance) + 0.05)
    );
  };
  if (contrast(color) >= 4.5) return color;
  for (const adjustment of [0.2, 0.4, 0.6, 0.8]) {
    const candidate =
      backgroundLuminance > 0.4
        ? Color.darken(color, adjustment)
        : Color.lighten(color, adjustment);
    if (contrast(candidate) >= 4.5) return candidate;
  }
  return Color.contrast(background);
}
