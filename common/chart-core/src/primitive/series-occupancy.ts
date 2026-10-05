// Purpose: Reuse painted series geometry to keep transient text off chart ink.
import type { CoordSys } from "@openchart/chart-core/coord";
import type { Render } from "@openchart/chart-core/render";
import { visibleFiniteSegment } from "@openchart/chart-core/drawing/geometry";
import {
  createOccupancyBitmap,
  createRasterScale,
  lineMask,
  rectMask,
} from "@openchart/chart-core/annotation/placement-raster";

type Rect = CoordSys.Bounds;
type Point = { x: number; y: number };
const finite = (...values: number[]) => values.every(Number.isFinite);
const transparent = (color: string | undefined) =>
  color === "transparent" ||
  (color?.startsWith("rgba(") &&
    Number(/,\s*([\d.]+)\s*\)$/.exec(color)?.[1] ?? 1) === 0);
function intersection(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width),
    bottom = Math.min(a.y + a.height, b.y + b.height);
  return right >= x && bottom >= y
    ? { x, y, width: right - x, height: bottom - y }
    : undefined;
}

/** A geometry paint owns one bitmap; cursor paints reuse its retained query.
 * Consume already-transformed items, so pane scales and plot offsets stay exact.
 * Grid, cloud/background tint and area interiors never contribute.
 * @example const ink = createSeriesOccupancy(plotArea); ink.add(type, items, options, pane); ink.intersects(label);
 */
export function createSeriesOccupancy(area: Rect) {
  const scale = createRasterScale(area);
  const bitmap = createOccupancyBitmap(scale);
  // lineMask expands X spans; query padding supplies matching Y clearance.
  let strokeRadius = 0;
  return {
    intersects(rect: Rect, pane: Rect = area): boolean {
      const padding = Math.max(2, strokeRadius + 1);
      const clip = intersection(area, pane);
      const clipped =
        clip &&
        intersection(clip, {
          x: rect.x - padding,
          y: rect.y - padding,
          width: rect.width + 2 * padding,
          height: rect.height + 2 * padding,
        });
      return !!clipped && bitmap.hasAny(rectMask(scale, clipped));
    },
    add(
      type: string,
      items: readonly unknown[],
      options: Readonly<Record<string, unknown>>,
      pane: Rect,
    ): void {
      if (options.visible === false) return;
      const clip = intersection(area, pane);
      if (!clip) return;
      // Clip before constructing spans: a log scale or offscreen buffered point
      // can have huge finite coordinates that must never become raster loops.
      const rectangle = (rect: Rect) => {
        if (!finite(rect.x, rect.y, rect.width, rect.height)) return;
        const clipped = intersection(clip, rect);
        if (clipped) bitmap.set(rectMask(scale, clipped));
      };
      const line = (a: Point, b: Point, radius = 1) => {
        if (!finite(a.x, a.y, b.x, b.y)) return;
        const visible = visibleFiniteSegment(a, b, {
          x: clip.x - radius,
          y: clip.y - radius,
          width: clip.width + radius * 2,
          height: clip.height + radius * 2,
        });
        if (visible) {
          strokeRadius = Math.max(strokeRadius, radius);
          const clamp = (point: Point): Point => ({
            x: Math.max(clip.x, Math.min(point.x, clip.x + clip.width)),
            y: Math.max(clip.y, Math.min(point.y, clip.y + clip.height)),
          });
          bitmap.set(
            lineMask({
              scale,
              from: clamp(visible.start),
              to: clamp(visible.end),
              radius,
            }),
          );
        }
      };
      if (type === "Histogram") {
        for (const bar of items as readonly Render.Histogram[]) {
          if (
            !finite(bar.x, bar.y, bar.baseY, bar.width) ||
            transparent(bar.color)
          )
            continue;
          const top = Math.round(Math.min(bar.y, bar.baseY)),
            bottom = Math.round(Math.max(bar.y, bar.baseY));
          rectangle({
            x: Math.round(bar.x - bar.width / 2),
            y: top,
            width: Math.max(1, Math.round(bar.width)),
            height: Math.max(1, bottom - top),
          });
        }
      } else if (type === "Candlestick" || type === "Bar") {
        for (const bar of items as readonly Render.Candlestick[]) {
          if (
            !finite(
              bar.x,
              bar.openY,
              bar.highY,
              bar.lowY,
              bar.closeY,
              bar.width,
            )
          )
            continue;
          const x = Math.round(bar.x),
            half = bar.width / 2;
          if (!transparent(type === "Candlestick" ? bar.wickColor : bar.color))
            line({ x, y: bar.highY }, { x, y: bar.lowY });
          if (type === "Candlestick") {
            if (transparent(bar.color) && transparent(bar.borderColor))
              continue;
            rectangle({
              x: Math.round(bar.x - half),
              y: Math.min(bar.openY, bar.closeY),
              width: Math.max(1, bar.width),
              height: Math.max(1, Math.abs(bar.closeY - bar.openY)),
            });
          } else {
            if (transparent(bar.color)) continue;
            line({ x: x - half, y: bar.openY }, { x, y: bar.openY });
            line({ x, y: bar.closeY }, { x: x + half, y: bar.closeY });
          }
        }
      } else if (["Line", "Area", "Baseline", "Liveline"].includes(type)) {
        const radius = Math.min(
          Math.max(clip.width, clip.height),
          Math.max(1, Number(options.lineWidth ?? 1) / 2),
        );
        let previous: Render.Point | undefined;
        for (const point of items as readonly Render.Point[]) {
          if (!finite(point.x, point.y)) {
            previous = undefined;
            continue;
          }
          if (options.lineType === "circles" || options.lineType === "cross") {
            if (transparent(point.color)) continue;
            const size = Math.max(2, Number(options.lineWidth ?? 1) + 1);
            rectangle({
              x: point.x - size,
              y: point.y - size,
              width: size * 2,
              height: size * 2,
            });
          } else if (previous && !transparent(previous.color)) {
            if (options.lineType === "step") {
              const corner = { x: point.x, y: previous.y };
              line(previous, corner, radius);
              line(corner, point, radius);
            } else line(previous, point, radius);
          }
          previous = point;
        }
      }
    },
  };
}
