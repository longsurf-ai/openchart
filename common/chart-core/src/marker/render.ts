// Purpose: Canvas rendering for in-plot Marker pins and transient guide lines
// Module:  @openchart/chart-core / marker

import { Color } from "@openchart/chart-core/util";
import { Marker } from "./types";
import type { RenderContext } from "@openchart/chart-core/drawing";
import { SpanRenderUtils, type Rect } from "@openchart/chart-core/span";

export type MarkerRenderInput = {
  ctx: CanvasRenderingContext2D;
  render: RenderContext;
  stripArea: Rect;
  markers: Marker.Record[];
  hoveredMarkerId?: string | null;
  activeMarkerId?: string | null;
};

export type MarkerGeometry = {
  id: string;
  x: number;
  y: number;
  size: number;
  row: number;
  stackIndex: number;
  stackSize: number;
  stacked: boolean;
  expanded: boolean;
};

type MarkerPaintColors = {
  marker: string;
  contrast: string;
};

const ICON_SIZE = 16;
const ICON_STACK_X_GAP = 24;
const ICON_STACK_PEEK = 5;
const ICON_EXPANDED_GAP = 22;
const ICON_CLIP_PADDING = 8;
const DEFAULT_MARKER_COLOR = "var(--glow-active, 35 80% 52%)";

function cachedColor(cache: Map<string, string>, color: string): string {
  const cached = cache.get(color);
  if (cached) return cached;
  const resolved = Color.resolve(color);
  cache.set(color, resolved);
  return resolved;
}

function resolvePaintColors(
  marker: Marker.Record,
  colorCache: Map<string, string>,
): MarkerPaintColors {
  const markerColor = cachedColor(
    colorCache,
    marker.colorOverride ?? DEFAULT_MARKER_COLOR,
  );
  const contrastKey = `contrast:${markerColor}`;
  const contrast = colorCache.get(contrastKey) ?? Color.contrast(markerColor);
  colorCache.set(contrastKey, contrast);
  return {
    marker: markerColor,
    contrast,
  };
}

function paintEarningsSymbol(
  ctx: CanvasRenderingContext2D,
  geometry: MarkerGeometry,
  colors: MarkerPaintColors,
  emphasized: boolean,
): void {
  ctx.fillStyle = Color.withAlpha(colors.contrast, emphasized ? 0.98 : 0.9);
  ctx.font = `700 ${emphasized ? 12 : 11}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("E", geometry.x, geometry.y + 0.4);
}

function paintMarkerSymbol(
  ctx: CanvasRenderingContext2D,
  geometry: MarkerGeometry,
  colors: MarkerPaintColors,
  emphasized: boolean,
): void {
  paintEarningsSymbol(ctx, geometry, colors, emphasized);
}

function paintMarkerBackground(
  ctx: CanvasRenderingContext2D,
  geometry: MarkerGeometry,
  colors: MarkerPaintColors,
): void {
  const left = geometry.x - geometry.size / 2;
  const top = geometry.y - geometry.size / 2;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = colors.marker;
  ctx.beginPath();
  ctx.roundRect(left, top, geometry.size, geometry.size, 5);
  ctx.fill();
}

export function markerGeometry(
  render: RenderContext,
  stripArea: Rect,
  marker: Marker.Record,
): MarkerGeometry | null {
  return layoutMarkerIcons(render, stripArea, [marker])[0] ?? null;
}

function layoutMarkerIcons(
  render: RenderContext,
  laneArea: Rect,
  markers: Marker.Record[],
  expandedMarkerId?: string | null,
): MarkerGeometry[] {
  const size = ICON_SIZE;
  const projected = markers
    .map((marker) => {
      const x = SpanRenderUtils.projectTimeToX(
        render,
        Date.parse(marker.at) / 1000,
      );
      return x === null ? null : { marker, x };
    })
    .filter((item): item is { marker: Marker.Record; x: number } => {
      if (!item) return false;
      return (
        item.x >= laneArea.x - size &&
        item.x <= laneArea.x + laneArea.width + size
      );
    })
    .sort((a, b) => a.x - b.x);

  const clusters: Array<Array<{ marker: Marker.Record; x: number }>> = [];
  for (const item of projected) {
    const cluster = clusters[clusters.length - 1];
    const last = cluster?.[cluster.length - 1];
    if (cluster && last && item.x - last.x <= ICON_STACK_X_GAP) {
      cluster.push(item);
    } else {
      clusters.push([item]);
    }
  }

  const bottomY = laneArea.y + laneArea.height - size / 2;
  return clusters.flatMap((cluster): MarkerGeometry[] => {
    const stacked = cluster.length > 1;
    const expanded =
      stacked &&
      !!expandedMarkerId &&
      cluster.some((item) => item.marker.id === expandedMarkerId);
    const center =
      cluster.reduce((total, item) => total + item.x, 0) / cluster.length;

    if (expanded) {
      const maxStep =
        cluster.length > 1
          ? Math.max(ICON_STACK_PEEK, (laneArea.width - size) / cluster.length)
          : ICON_EXPANDED_GAP;
      const step = Math.min(ICON_EXPANDED_GAP, maxStep);
      const width = (cluster.length - 1) * step;
      const clampedCenter = Math.max(
        laneArea.x + size / 2 + width / 2,
        Math.min(center, laneArea.x + laneArea.width - size / 2 - width / 2),
      );
      return cluster.map((item, index) => ({
        id: item.marker.id,
        x: clampedCenter + (index - (cluster.length - 1) / 2) * step,
        y: bottomY,
        size,
        row: 0,
        stackIndex: index,
        stackSize: cluster.length,
        stacked,
        expanded,
      }));
    }

    return cluster.map((item, index) => {
      const offset =
        stacked && cluster.length > 1
          ? (index - (cluster.length - 1) / 2) * ICON_STACK_PEEK
          : 0;
      return {
        id: item.marker.id,
        x: stacked ? center + offset : item.x,
        y: bottomY,
        size,
        row: 0,
        stackIndex: index,
        stackSize: cluster.length,
        stacked,
        expanded,
      };
    });
  });
}

function paintGuide(
  ctx: CanvasRenderingContext2D,
  render: RenderContext,
  marker: Marker.Record,
): void {
  const x = SpanRenderUtils.projectTimeToX(
    render,
    Date.parse(marker.at) / 1000,
  );
  if (x === null) return;
  ctx.save();
  ctx.strokeStyle = Color.withAlpha(
    Color.resolve(marker.colorOverride ?? DEFAULT_MARKER_COLOR),
    0.74,
  );
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, render.area.y);
  ctx.lineTo(x, render.area.y + render.area.height);
  ctx.stroke();
  ctx.restore();
}

export function renderMarkers(input: MarkerRenderInput): void {
  const activeId = input.activeMarkerId ?? input.hoveredMarkerId ?? null;
  const active = activeId
    ? input.markers.find((marker) => marker.id === activeId)
    : undefined;
  if (active) paintGuide(input.ctx, input.render, active);

  input.ctx.save();
  input.ctx.beginPath();
  input.ctx.rect(
    input.stripArea.x - ICON_CLIP_PADDING,
    input.stripArea.y - ICON_CLIP_PADDING,
    input.stripArea.width + ICON_CLIP_PADDING * 2,
    input.stripArea.height + ICON_CLIP_PADDING * 2,
  );
  input.ctx.clip();

  const markerById = new Map(
    input.markers.map((marker) => [marker.id, marker]),
  );
  const colorCache = new Map<string, string>();
  for (const geometry of layoutMarkerIcons(
    input.render,
    input.stripArea,
    input.markers,
    activeId,
  )) {
    const marker = markerById.get(geometry.id);
    if (!marker) continue;
    const colors = resolvePaintColors(marker, colorCache);
    const emphasized = marker.id === activeId;
    input.ctx.save();
    paintMarkerBackground(input.ctx, geometry, colors);
    input.ctx.shadowBlur = 0;
    paintMarkerSymbol(input.ctx, geometry, colors, emphasized);
    input.ctx.restore();
  }

  input.ctx.restore();
}

export const MarkerRenderUtils = {
  markerGeometry,
  layoutMarkerIcons,
};
